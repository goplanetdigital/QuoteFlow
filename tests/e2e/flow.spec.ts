import { test, expect } from "@playwright/test";
import Stripe from "stripe";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import writeXlsxFile from "write-excel-file/node";
import { readSheet } from "read-excel-file/node";
const origin = "http://localhost:3100";
const rfq =
  "code,description,quantity,unit\nCBL-2C-1.5,2 Core Cable 1.5mm,120,m\nSW20,20 amp double pole wall switch,12,pcs\nDB-12W,Distribution board 12 way,3,pcs";
const catalogue =
  "code,description,unit,price\nCBL-2C-1.5,2 Core Cable 1.5mm,m,0.82\nSW-20A,20A Double Pole Switch,pcs,12.4\nDB-12W,12 Way Distribution Board,pcs,";
const meta = {
  supplierName: "Supplier",
  customerName: "Customer",
  quoteNumber: "QF-TEST",
  currency: "USD",
  validDays: "30",
  notes: "",
};
test("malicious spreadsheet preview and paid-job submission reject cached formula prices without saving jobs", async ({ request, page }) => {
  const malicious = await writeXlsxFile([
    ["code", "description", "unit", "price"],
    ["CBL-2C-1.5", "Cable", "m", { type: "Formula", value: "1+1" }],
  ]).toBuffer();
  const db = new Pool({ connectionString: process.env.QF_TEST_DATABASE_URL });
  try {
    const before = Number((await db.query("SELECT count(*) FROM qf_jobs")).rows[0].count);
    const file = { name: "malicious.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: malicious };
    const preview = await request.post("/api/extract-spreadsheet", { headers: { Origin: origin }, multipart: { kind: "catalogue", file } });
    expect(preview.status()).toBe(422);
    expect((await preview.json()).error).toContain("values-only");
    const job = await request.post("/api/jobs", { headers: { Origin: origin }, multipart: {
      rfq: { name: "rfq.csv", mimeType: "text/csv", buffer: Buffer.from(rfq) },
      catalogue: file, matches: "{}", meta: JSON.stringify(meta), approved: "true",
    } });
    expect(job.status()).toBe(422);
    expect(Number((await db.query("SELECT count(*) FROM qf_jobs")).rows[0].count)).toBe(before);
    await page.goto("/");
    await page.locator("input[type=file]").nth(0).setInputFiles(file);
    await expect(page.getByText(/Invalid or unsafe spreadsheet/)).toBeVisible();
    expect((await request.post("/api/extract-spreadsheet", { headers: { Origin: "https://attacker.invalid" }, multipart: { kind: "catalogue", file } })).status()).toBe(403);
    expect((await request.post("/api/extract-spreadsheet", { headers: { Origin: origin }, multipart: { kind: "catalogue", file: { ...file, name: "broken.xlsx", buffer: Buffer.from("broken zip") } } })).status()).toBe(422);
  } finally { await db.end(); }
});
async function makeJob(
  api: import("@playwright/test").APIRequestContext,
  quantity = 120,
) {
  const r = await api.post("/api/jobs", {
    headers: { Origin: origin },
    multipart: {
      rfq: {
        name: "rfq.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(rfq.replace("120,m", `${quantity},m`)),
      },
      catalogue: {
        name: "catalogue.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(catalogue),
      },
      matches: "{}",
      meta: JSON.stringify(meta),
      approved: "true",
      amount: "1",
      currency: "eur",
    },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).id as string;
}
async function sendEvent(
  api: import("@playwright/test").APIRequestContext,
  session: Record<string, unknown>,
  type = "checkout.session.completed",
  id = `evt_${crypto.randomUUID()}`,
  secret = "whsec_local_testing_only",
) {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    livemode: false,
    data: { object: session },
  });
  const stripe = new Stripe("sk_test_local_testing_only");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  return api.post("/api/webhooks/stripe", {
    data: payload,
    headers: {
      "stripe-signature": signature,
      "Content-Type": "application/json",
    },
  });
}
async function savedSession(id: string) {
  const db = new Pool({ connectionString: process.env.QF_TEST_DATABASE_URL });
  try {
    const job = (await db.query("SELECT * FROM qf_jobs WHERE id=$1", [id]))
      .rows[0];
    return {
      id: job.session_id,
      object: "checkout.session",
      mode: "payment",
      livemode: false,
      payment_status: "paid",
      amount_total: job.amount,
      currency: job.currency,
      client_reference_id: id,
      metadata: { job_id: id, product: "QuoteFlow" },
    };
  } finally {
    await db.end();
  }
}
test("private original files and owner hashes stay isolated; expired jobs and guessed upload URLs are inaccessible", async ({ context, request }) => {
  const id = await makeJob(context.request, 2);
  const db = new Pool({ connectionString: process.env.QF_TEST_DATABASE_URL });
  try {
    const files = (await db.query("SELECT kind,content FROM qf_uploads WHERE job_id=$1 ORDER BY kind", [id])).rows;
    expect(files).toHaveLength(2);
    expect(files.find(f => f.kind === "rfq").content.toString()).toBe(rfq.replace("120,m", "2,m"));
    expect(files.find(f => f.kind === "catalogue").content.toString()).toBe(catalogue);
    const cookie = (await context.request.storageState()).cookies.find(c => c.name === `qf_job_${id}`)!;
    const owner = (await db.query("SELECT owner_hash FROM qf_jobs WHERE id=$1", [id])).rows[0].owner_hash;
    expect(owner).toBe(createHash("sha256").update(cookie.value).digest("hex"));
    expect(owner).not.toBe(cookie.value);
    const visible = await context.request.get(`/api/jobs/${id}`);
    expect(visible.headers()["cache-control"]).toBe("private, no-store");
    expect(await visible.text()).not.toContain(owner);
    expect((await request.get(`/api/jobs/${id}`)).status()).toBe(404);
    expect((await context.request.get(`/api/jobs/${id}/uploads/rfq`)).status()).toBe(404);
    await db.query("UPDATE qf_jobs SET created_at=now()-interval '8 days' WHERE id=$1", [id]);
    expect((await context.request.get(`/api/jobs/${id}`)).status()).toBe(404);
    expect((await context.request.get(`/api/jobs/${id}/result?format=xlsx`)).status()).toBe(404);
    await db.query("DELETE FROM qf_jobs WHERE id=$1", [id]);
    expect(Number((await db.query("SELECT count(*) FROM qf_uploads WHERE job_id=$1", [id])).rows[0].count)).toBe(0);
  } finally { await db.end(); }
});
test("browser upload → approve → frozen job → Checkout → signed payment → correct Excel and printable delivery", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .nth(0)
    .setInputFiles({
      name: "catalogue.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await writeXlsxFile(catalogue.split("\n").map(row => row.split(","))).toBuffer(),
    });
  await expect(page.getByText(/Loaded 3 catalogue items/)).toBeVisible();
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "rfq.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await writeXlsxFile(rfq.split("\n").map(row => row.split(","))).toBuffer(),
    });
  await expect(page.getByText(/Loaded 3 RFQ lines/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve suggested" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve suggested" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Review saved quotation/ }).click();
  await expect(page).toHaveURL(/\/jobs\//);
  const id = page.url().split("/").pop()!;
  await expect(page.getByText(/Quotation subtotal: USD 247.20/)).toBeVisible();
  expect(
    (await context.request.get(`/api/jobs/${id}/result?format=xlsx`)).status(),
  ).toBe(402);
  await page.getByRole("button", { name: /Pay .* in test mode/ }).click();
  await expect(page).toHaveURL(/localhost:3101\/checkout/, { timeout: 20000 });
  await page.getByRole("link", { name: "Complete test payment" }).click();
  await expect(
    page.getByRole("link", { name: "Download Excel" }),
  ).toBeVisible();
  const r = await context.request.get(`/api/jobs/${id}/result?format=xlsx`);
  expect(r.status()).toBe(200);
  const excel = await r.body();
  const rows = await readSheet(excel, "Quotation");
  expect(
    rows.some((row) => row[0] === "Approved subtotal" && row[1] === 247.2),
  ).toBeTruthy();
  expect((await readSheet(excel, "Review audit")).length).toBe(4);
  const html = await context.request.get(`/api/jobs/${id}/result?format=html`);
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain("247.20");
  const privateCookie = (await context.cookies()).find(
    (c) => c.name === `qf_job_${id}`,
  )!;
  expect(privateCookie.httpOnly).toBeTruthy();
  expect(errors).toEqual([]);
  await mkdir("test-results/artifacts", { recursive: true });
  await page.screenshot({
    path: "test-results/artifacts/quoteflow-delivered.png",
    fullPage: true,
  });
});
test("success URL cannot unlock exports; cancellation preserves the saved job", async ({
  page,
  context,
}) => {
  const id = await makeJob(context.request);
  await page.goto(`/checkout/success?job=${id}&paid=1`);
  await expect(page.getByText(/Waiting for verified payment/)).toBeVisible();
  expect(
    (await context.request.get(`/api/jobs/${id}/result?format=xlsx`)).status(),
  ).toBe(402);
  await page.getByRole("button", { name: /Pay .* in test mode/ }).click();
  await page.getByRole("link", { name: "Cancel payment" }).click();
  await expect(page.getByText(/Checkout was cancelled/)).toBeVisible();
  expect((await context.request.get(`/api/jobs/${id}`)).status()).toBe(200);
});
test("two concurrent customers cannot read or pay for each other’s jobs; client fee tampering is ignored", async ({
  playwright,
}) => {
  const a = await playwright.request.newContext({ baseURL: origin }),
    b = await playwright.request.newContext({ baseURL: origin });
  try {
    const [aid, bid] = await Promise.all([makeJob(a, 2), makeJob(b, 7)]);
    const own = await a.get(`/api/jobs/${aid}`);
    expect((await own.json()).amount).toBe(2900);
    expect((await own.json()).subtotal).toBe(1.64);
    expect((await a.get(`/api/jobs/${bid}`)).status()).toBe(404);
    expect((await b.get(`/api/jobs/${aid}/result?format=xlsx`)).status()).toBe(
      404,
    );
    expect(
      (
        await b.post(`/api/jobs/${aid}/checkout`, {
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(404);
    const calls = await Promise.all([
      a.post(`/api/jobs/${aid}/checkout`, { headers: { Origin: origin } }),
      a.post(`/api/jobs/${aid}/checkout`, { headers: { Origin: origin } }),
    ]);
    expect(calls[0].status()).toBe(200);
    expect(await calls[0].json()).toEqual(await calls[1].json());
    await sendEvent(a, await savedSession(aid));
    expect((await a.get(`/api/jobs/${aid}/result?format=xlsx`)).status()).toBe(
      200,
    );
    expect((await b.get(`/api/jobs/${aid}/result?format=xlsx`)).status()).toBe(
      404,
    );
    expect((await b.get(`/api/jobs/${bid}/result?format=xlsx`)).status()).toBe(
      402,
    );
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
test("invalid/stale signatures, mismatched fees, failed payments, async success, duplicate delivery and restart durability", async ({
  request,
}) => {
  const id = await makeJob(request);
  expect(
    (
      await request.post(`/api/jobs/${id}/checkout`, {
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(200);
  const s = await savedSession(id);
  expect(
    (await sendEvent(request, s, undefined, undefined, "whsec_wrong")).status(),
  ).toBe(400);
  expect((await sendEvent(request, { ...s, amount_total: 1 })).status()).toBe(
    400,
  );
  const payload = JSON.stringify({
    id: "evt_stale",
    type: "checkout.session.completed",
    data: { object: s },
  });
  const stripe = new Stripe("sk_test_local_testing_only");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_local_testing_only",
    timestamp: 1,
  });
  expect(
    (
      await request.post("/api/webhooks/stripe", {
        data: payload,
        headers: { "stripe-signature": signature },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await sendEvent(request, { ...s, payment_status: "unpaid" })).status(),
  ).toBe(200);
  expect(
    (await request.get(`/api/jobs/${id}/result?format=xlsx`)).status(),
  ).toBe(402);
  expect(
    (
      await sendEvent(
        request,
        { ...s, payment_status: "unpaid" },
        "checkout.session.async_payment_failed",
      )
    ).status(),
  ).toBe(200);
  expect((await (await request.get(`/api/jobs/${id}`)).json()).state).toBe(
    "payment_failed",
  );
  expect(
    (
      await sendEvent(
        request,
        s,
        "checkout.session.async_payment_succeeded",
        "evt_repeat",
      )
    ).status(),
  ).toBe(200);
  const first = await (
    await request.get(`/api/jobs/${id}/result?format=xlsx`)
  ).body();
  const repeated = await Promise.all([
    sendEvent(
      request,
      s,
      "checkout.session.async_payment_succeeded",
      "evt_repeat",
    ),
    sendEvent(
      request,
      s,
      "checkout.session.async_payment_succeeded",
      "evt_repeat",
    ),
  ]);
  expect(repeated.map((r) => r.status())).toEqual([200, 200]);
  expect(
    await (await request.get(`/api/jobs/${id}/result?format=xlsx`)).body(),
  ).toEqual(first);
  expect((await request.post("http://localhost:3101/restart")).status()).toBe(
    200,
  );
  expect(
    await (await request.get(`/api/jobs/${id}/result?format=xlsx`)).body(),
  ).toEqual(first);
  const db = new Pool({ connectionString: process.env.QF_TEST_DATABASE_URL });
  try {
    expect(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM qf_stripe_events WHERE event_id=$1",
            ["evt_repeat"],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    expect(
      (await db.query("SELECT excel FROM qf_jobs WHERE id=$1", [id])).rows[0]
        .excel,
    ).toEqual(first);
    expect(
      Number(
        (
          await db.query("SELECT count(*) FROM qf_uploads WHERE job_id=$1", [
            id,
          ])
        ).rows[0].count,
      ),
    ).toBe(2);
  } finally {
    await db.end();
  }
});
test("cross-origin Checkout, oversized files and unresolved quotations fail safely", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/jobs", {
        headers: { Origin: "https://attacker.invalid" },
        data: "x",
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/jobs", {
        headers: { Origin: origin },
        data: Buffer.alloc(3300000),
      })
    ).status(),
  ).toBe(413);
  const invalid = await request.post("/api/jobs", {
    headers: { Origin: origin },
    multipart: {
      rfq: {
        name: "rfq.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "code,description,quantity,unit\nUNKNOWN,Unknown part,1,pcs",
        ),
      },
      catalogue: {
        name: "catalogue.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(catalogue),
      },
      meta: JSON.stringify(meta),
      matches: "{}",
      approved: "true",
    },
  });
  expect(invalid.status()).toBe(422);
});
