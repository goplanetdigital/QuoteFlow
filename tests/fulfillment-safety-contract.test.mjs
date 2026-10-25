import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checkout = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../app/api/stripe-webhook/route.ts", import.meta.url), "utf8");
const recovery = readFileSync(new URL("../app/api/recover-quotation/route.ts", import.meta.url), "utf8");

test("quotation snapshot is persisted before payable Stripe session creation", () => {
  const insert = checkout.indexOf("INSERT INTO quoteflow_quote_snapshots");
  const stripe = checkout.indexOf('fetch("https://api.stripe.com/v1/checkout/sessions"');
  assert.ok(insert >= 0 && stripe > insert, "snapshot must be stored first");
  assert.match(checkout.slice(insert, stripe), /return NextResponse\.json\(\{ error: "Secure quotation storage is temporarily unavailable\. No payment was made\." \}, \{ status: 503 \}\)/);
});

test("recovery rejects missing or expired snapshots instead of inventing quotation data", () => {
  assert.match(recovery, /expires_at > now\(\)/);
  assert.match(recovery, /Quotation snapshot unavailable or expired/);
  assert.match(recovery, /createHash\("sha256"\)\.update\(payload, "utf8"\)/);
});

test("webhook deduplicates events and preserves paid status across late failure", () => {
  assert.match(webhook, /ON CONFLICT \(stripe_event_id\) DO NOTHING/);
  assert.match(webhook, /ON CONFLICT \(stripe_session_id\) DO UPDATE/);
  assert.match(webhook, /WHEN quoteflow_orders\.payment_status = 'paid' THEN 'paid'/);
  assert.match(webhook, /Order storage failed/);
});

test("recovery emails carry fragment-only session credentials and stable resend key", () => {
  assert.match(webhook, /recoveryUrl\.hash = new URLSearchParams/);
  assert.match(webhook, /"quoteflow-receipt-" \+ checkout\.id/);
  assert.doesNotMatch(webhook, /recoveryUrl\.searchParams\.set\("recover_session"/);
});
