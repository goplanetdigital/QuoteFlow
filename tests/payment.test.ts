import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { approveQuote, readMeta, readMatches } from "../lib/server/input";
import { generateDelivery } from "../lib/server/delivery";
import { beginCheckout, processPayment } from "../lib/server/payment";
import { Store, Job, Transaction } from "../lib/server/store";
import {
  buildQuote,
  demoCatalogue,
  demoRfq,
  parseCatalogueCsv,
  parseCsv,
} from "../lib/quoteflow";
import { paymentConfig } from "../lib/server/config";
import { readSheet } from "read-excel-file/node";
const meta = {
  supplierName: "Demo supplier",
  customerName: "Customer A",
  quoteNumber: "DEMO-1",
  currency: "USD",
  validDays: "30",
  notes: "",
};
function makeJob(): Job {
  return {
    id: randomUUID(),
    owner_hash: "owner-a",
    snapshot: approveQuote(demoRfq, demoCatalogue, {}, meta, "demo.csv"),
    amount: 2900,
    currency: "usd",
    state: "awaiting_payment",
    session_id: null,
    checkout_url: null,
    session_expires: null,
    excel: null,
    printable: null,
  };
}
function session(j: Job, overrides: Record<string, unknown> = {}) {
  return {
    id: `cs_test_${j.id}`,
    object: "checkout.session",
    livemode: false,
    mode: "payment",
    payment_status: "paid",
    metadata: { job_id: j.id, product: "QuoteFlow" },
    client_reference_id: j.id,
    amount_total: j.amount,
    currency: j.currency,
    url: "https://checkout.stripe.com/test",
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}
function event(
  s: Stripe.Checkout.Session,
  type = "checkout.session.completed",
  id = randomUUID(),
) {
  return { id, type, livemode: false, data: { object: s } } as Stripe.Event;
}
// Transactional fake for deterministic retry and concurrency tests, not the production adapter.
class MemoryStore implements Store {
  jobs = new Map<string, Job>();
  events = new Set<string>();
  private lock = Promise.resolve();
  constructor(...jobs: Job[]) {
    jobs.forEach((j) => this.jobs.set(j.id, j));
  }
  async get(id: string) {
    return this.jobs.get(id);
  }
  async transaction<T>(
    id: string,
    f: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const before = this.lock;
    let release!: () => void;
    this.lock = new Promise((r) => (release = r));
    await before;
    const original = this.jobs.get(id)!;
    const copy = structuredClone(original);
    const pending: string[] = [];
    try {
      const result = await f({
        job: copy,
        save: async () => {},
        hasEvent: async (e) => this.events.has(e),
        recordEvent: async (e) => {
          pending.push(e);
        },
      });
      Object.assign(original, copy);
      pending.forEach((e) => this.events.add(e));
      return result;
    } finally {
      release();
    }
  }
}
test("possible matches and missing prices are excluded; explicit approval uses only catalogue price", () => {
  const q = buildQuote(demoRfq, demoCatalogue);
  assert.equal(q.readyCount, 1);
  assert.equal(q.reviewCount, 1);
  assert.equal(q.blockedCount, 1);
  assert.equal(q.subtotal, 98.4);
  const s = approveQuote(
    demoRfq,
    demoCatalogue,
    { "2": "SW-20A" },
    meta,
    "demo.csv",
  );
  assert.equal(s.subtotal, 247.2);
  assert.equal(s.excludedCount, 1);
  assert.equal(s.lines[1].approvedUnitPrice, 12.4);
  assert.throws(() =>
    approveQuote(demoRfq, demoCatalogue, { "2": "invented" }, meta, "demo.csv"),
  );
});
test("invalid quantities, duplicate codes, negative prices and unit substitutions cannot pass review", () => {
  assert.throws(() =>
    approveQuote(
      [{ ...demoRfq[0], quantity: Infinity }],
      demoCatalogue,
      {},
      meta,
      "demo.csv",
    ),
  );
  assert.throws(() =>
    approveQuote(
      demoRfq,
      [...demoCatalogue, demoCatalogue[0]],
      {},
      meta,
      "demo.csv",
    ),
  );
  assert.throws(() =>
    approveQuote(
      demoRfq,
      [{ ...demoCatalogue[0], approvedUnitPrice: -1 }],
      {},
      meta,
      "demo.csv",
    ),
  );
  assert.throws(() =>
    approveQuote(
      [{ ...demoRfq[0], unit: "pcs" }],
      demoCatalogue,
      { "1": "CBL-2C-1.5" },
      meta,
      "demo.csv",
    ),
  );
  assert.equal(
    buildQuote([{ ...demoRfq[0], unit: "pcs" }], demoCatalogue).readyCount,
    0,
  );
  assert.equal(
    parseCatalogueCsv("code,description,price\na,Part,USD1foo2")[0]
      .approvedUnitPrice,
    null,
  );
  const invalid = parseCsv("code,description,quantity\na,Part,nonsense");
  assert.throws(() =>
    approveQuote(invalid, demoCatalogue, {}, meta, "demo.csv"),
  );
  assert.throws(() => readMeta("{}"));
  assert.throws(() => readMatches('{"1":42}'));
});
test("browser ownership and concurrent checkout retries create one associated session", async () => {
  const j = makeJob();
  const db = new MemoryStore(j);
  let calls = 0;
  await assert.rejects(
    beginCheckout(j.id, "owner-b", async () => session(j), db),
    /not found/,
  );
  const create = async () => {
    calls++;
    return session(j);
  };
  const urls = await Promise.all([
    beginCheckout(j.id, "owner-a", create, db),
    beginCheckout(j.id, "owner-a", create, db),
  ]);
  assert.equal(calls, 1);
  assert.equal(urls[0], urls[1]);
  assert.equal(j.state, "awaiting_payment");
  assert.equal(j.excel, null);
});
test("success redirect is insufficient; pending completion requires an async paid event", async () => {
  const j = makeJob();
  const db = new MemoryStore(j);
  j.session_id = session(j).id;
  await processPayment(event(session(j, { payment_status: "unpaid" })), db);
  assert.equal(j.state, "processing");
  assert.equal(j.excel, null);
  await processPayment(
    event(session(j), "checkout.session.async_payment_succeeded"),
    db,
  );
  assert.equal(j.state, "ready");
  assert.ok(j.excel);
});
test("duplicate and out-of-order signed payment events never regenerate or revoke delivery", async () => {
  const j = makeJob();
  const db = new MemoryStore(j);
  j.session_id = session(j).id;
  const paid = event(session(j));
  let generations = 0;
  const deliver = (s: typeof j.snapshot) => {
    generations++;
    return generateDelivery(s);
  };
  await Promise.all([
    processPayment(paid, db, deliver),
    processPayment(paid, db, deliver),
  ]);
  await processPayment(
    event(session(j), "checkout.session.async_payment_failed"),
    db,
    deliver,
  );
  assert.equal(generations, 1);
  assert.equal(j.state, "ready");
});
test("failed delivery rolls back the event and safely retries", async () => {
  const j = makeJob();
  const db = new MemoryStore(j);
  j.session_id = session(j).id;
  const paid = event(session(j));
  await assert.rejects(
    processPayment(paid, db, () => {
      throw new Error("Temporary generation failure");
    }),
  );
  assert.equal(j.state, "awaiting_payment");
  assert.equal(db.events.size, 0);
  await processPayment(paid, db);
  assert.equal(j.state, "ready");
  assert.equal(db.events.size, 1);
});
test("live, mismatched amount, currency and foreign sessions are rejected", async () => {
  for (const patch of [
    { amount_total: 1 },
    { currency: "myr" },
    { id: "cs_test_foreign" },
    { livemode: true },
    { client_reference_id: randomUUID() },
    { mode: "subscription" },
  ]) {
    const j = makeJob();
    const db = new MemoryStore(j);
    j.session_id = session(j).id;
    await assert.rejects(processPayment(event(session(j, patch)), db));
    assert.equal(j.state, "awaiting_payment");
    assert.equal(db.events.size, 0);
  }
  const j = makeJob();
  const db = new MemoryStore(j);
  await assert.rejects(
    processPayment({ ...event(session(j)), livemode: true }, db),
  );
});
test("failed and expired events preserve isolation across concurrent jobs", async () => {
  const a = makeJob(),
    b = makeJob();
  b.snapshot = approveQuote(
    [{ ...demoRfq[0], quantity: 1 }],
    demoCatalogue,
    {},
    meta,
    "b.csv",
  );
  const db = new MemoryStore(a, b);
  a.session_id = session(a).id;
  b.session_id = session(b).id;
  await Promise.all([
    processPayment(event(session(a)), db),
    processPayment(
      event(session(b), "checkout.session.async_payment_failed"),
      db,
    ),
  ]);
  assert.equal(a.state, "ready");
  assert.equal(b.state, "payment_failed");
  assert.equal(b.excel, null);
  assert.notEqual(a.snapshot.subtotal, b.snapshot.subtotal);
  await processPayment(event(session(b), "checkout.session.expired"), db);
  assert.equal(b.state, "expired");
});
test("Excel and printable delivery preserve approved values, audit exclusions and neutralize untrusted content", async () => {
  const j = makeJob();
  j.snapshot.meta.supplierName = '=HYPERLINK("https://invalid")';
  j.snapshot.meta.notes = "<script>alert(1)</script>";
  const out = await generateDelivery(j.snapshot);
  const values = await readSheet(out.excel, "Quotation");
  assert.equal(values[1][1], '\'=HYPERLINK("https://invalid")');
  assert.equal(values[8][4], 0.82);
  assert.equal(values[9][1], 98.4);
  assert.equal((await readSheet(out.excel, "Review audit")).length, j.snapshot.lines.length + 1);
  assert.ok(out.printable.toString().includes("&lt;script&gt;"));
  assert.ok(!out.printable.toString().includes("<script>"));
});
test("payment configuration fails closed for missing or live credentials", () => {
  const saved = { ...process.env };
  try {
    process.env.STRIPE_SECRET_KEY = "sk_live_forbidden";
    process.env.QUOTE_EXPORT_AMOUNT = "2900";
    process.env.QUOTE_EXPORT_CURRENCY = "usd";
    assert.throws(paymentConfig);
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.SITE_URL = "http://localhost:3000";
    assert.equal(paymentConfig().amount, 2900);
    process.env.QUOTE_EXPORT_AMOUNT = "NaN";
    assert.throws(paymentConfig);
  } finally {
    process.env = saved;
  }
});

test("quoted multiline CSV text and source quantities survive parsing; malformed quotes fail safely", () => {
  const lines = parseCsv(
    'code,description,quantity,unit\nA,"First line\nsecond line, detail",2,pcs',
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, "First line\nsecond line, detail");
  assert.equal(lines[0].quantity, 2);
  assert.deepEqual(
    parseCsv('code,description,quantity\nA,"unterminated,2'),
    [],
  );
});

test("signed paid webhook repairs a lost Checkout-save association without accepting a different saved session", async () => {
  const j = makeJob();
  const db = new MemoryStore(j);
  await processPayment(event(session(j)), db);
  assert.equal(j.session_id, session(j).id);
  assert.equal(j.state, "ready");
  await assert.rejects(
    processPayment(event(session(j, { id: "cs_test_other" })), db),
  );
});

test("pending/failed/expired jobs cannot start a second charge, and unsaved retries remain inside Stripe's idempotency window", async () => {
  for (const state of ["processing", "ready", "payment_failed", "expired"]) {
    const j=makeJob();j.state=state;j.session_id=session(j).id;j.session_expires=String(Math.floor(Date.now()/1000)+3600);j.checkout_url=session(j).url;
    const db=new MemoryStore(j);let calls=0;await assert.rejects(beginCheckout(j.id,"owner-a",async()=>{calls++;return session(j);},db));assert.equal(calls,0);
  }
  const j=makeJob();j.created_at=new Date(Date.now()-21*60*60*1000);await assert.rejects(beginCheckout(j.id,"owner-a",async()=>session(j),new MemoryStore(j)),/expired/);
});
