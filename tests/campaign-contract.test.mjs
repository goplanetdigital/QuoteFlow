import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checkout = readFileSync(new URL('../app/api/checkout/route.ts', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../app/components/QuoteWorkspace.tsx', import.meta.url), 'utf8');
const webhook = readFileSync(new URL('../app/api/stripe-webhook/route.ts', import.meta.url), 'utf8');

test('campaign tag is format constrained and optional', () => {
  assert.match(checkout, /\^\[a-z0-9_-\]\{1,48\}\$/);
  assert.match(checkout, /metadata\[growthCampaign\]/);
  assert.match(workspace, /get\("campaign"\)/);
  assert.match(workspace, /growthCampaign/);
});

test('checkout retains production price tiers and live test isolation', () => {
  for (const amount of ['800', '1800', '3800', '5900']) {
    assert.ok(checkout.includes(amount), 'Missing price '+amount);
  }
  assert.match(checkout, /QUOTE_LIVE_TEST_ENABLED/);
  assert.match(checkout, /metadata\[liveTest\]/);
});

test('webhook retains signature and payment verification', () => {
  assert.match(webhook, /validStripeSignature\(body, signature, secret\)/);
  assert.match(webhook, /checkout\.payment_status === "paid"/);
  assert.match(webhook, /quoteflow_processed_events/);
  assert.match(webhook, /quoteflow_orders/);
});
