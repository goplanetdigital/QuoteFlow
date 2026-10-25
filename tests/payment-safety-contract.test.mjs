import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checkout = readFileSync(new URL('../app/api/checkout/route.ts', import.meta.url), 'utf8');
const webhook = readFileSync(new URL('../app/api/stripe-webhook/route.ts', import.meta.url), 'utf8');
const verify = readFileSync(new URL('../app/api/verify-payment/route.ts', import.meta.url), 'utf8');

test('checkout and webhook require a production live Stripe key and signature', () => {
  assert.match(checkout, /rk_live_/);
  assert.match(checkout, /sk_live_/);
  assert.match(webhook, /STRIPE_WEBHOOK_SECRET/);
  assert.match(webhook, /timingSafeEqual/);
});

test('paid orders are persisted idempotently before webhook acknowledgement', () => {
  assert.match(webhook, /ON CONFLICT \(stripe_event_id\) DO NOTHING/);
  assert.match(webhook, /ON CONFLICT \(stripe_session_id\) DO UPDATE/);
  assert.match(webhook, /payment_status = 'paid' THEN 'paid'/);
  assert.match(webhook, /Order storage failed/);
});

test('verify-payment rejects unpaid sessions and checks fingerprint', () => {
  assert.match(verify, /session\.payment_status === "paid"/);
  assert.match(verify, /session\.metadata\?\.fingerprint === fingerprint/);
  assert.match(verify, /session\.client_reference_id === fingerprint/);
});

test('production live test payments remain explicitly flagged', () => {
  assert.match(checkout, /metadata\[liveTest\]/);
  assert.match(webhook, /metadata\?\.liveTest === "true"/);
});

test('branded domain survives Stripe checkout and recovery emails use branded URL', () => {
  assert.match(checkout, /allowedHosts = new Set\(\[site\.hostname, "quoteflow\.allsetintl\.com"\]\)/);
  assert.match(checkout, /success_url: origin \+ "\/\?session_id=\{CHECKOUT_SESSION_ID\}"/);
  assert.match(webhook, /const siteUrl = "https:\/\/quoteflow\.allsetintl\.com"/);
  assert.match(webhook, /recoveryUrl\.hash = new URLSearchParams\(\{ recover_session: checkout\.id \}\)\.toString\(\)/);
});
