import assert from 'node:assert/strict';

const base = process.env.QUOTEFLOW_BASE_URL;
assert.ok(base?.startsWith('https://'), 'Production HTTPS URL required');
const request = async (path, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try { return await fetch(new URL(path, base), { ...init, signal: controller.signal, redirect: 'manual' }); }
  finally { clearTimeout(timeout); }
};
const config = await request('/api/checkout-config');
assert.equal(config.status, 200, 'checkout-config should be publicly reachable');
const json = await config.json();
assert.equal(json.testPriceMode, false, 'production test pricing must be disabled');
console.log('PASS production checkout-config; testPriceMode=false');

const verify = await request('/api/verify-payment', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({sessionId:'invalid',fingerprint:'invalid'}) });
assert.equal(verify.status, 400, 'invalid session must be rejected by a configured payment verifier');
const body = await verify.json();
assert.equal(body.paid, false, 'invalid payment cannot unlock files');
console.log('PASS invalid payment rejected; paid=false');

const webhook = await request('/api/stripe-webhook', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
assert.equal(webhook.status, 400, 'unsigned webhook must be rejected by a configured webhook endpoint');
console.log('PASS unsigned webhook rejected');

const readiness = await request('/api/readiness');
const health = await readiness.json();
assert.equal(readiness.status, 200, 'production readiness must return HTTP 200');
assert.equal(health.ready, true, 'production readiness must be true');
assert.equal(health.environment, 'production', 'must verify production environment');
for (const name of ['stripeKey', 'stripeWebhook', 'databaseConfigured', 'databaseReachable', 'orderTablesReady', 'quoteSnapshotsReady']) {
  assert.equal(health.checks?.[name], true, 'production readiness check failed: ' + name);
}
console.log('PASS production Stripe configuration and live Neon connectivity/order tables');

const recovery = await request('/api/recover-quotation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: 'invalid' })
});
assert.equal(recovery.status, 400, 'invalid recovery token must be rejected');
console.log('PASS invalid quotation recovery token rejected');

const homepage = await request('/');
assert.equal(homepage.status, 200, 'production homepage should be publicly reachable');
const html = await homepage.text();
assert.match(html, /QuoteFlow/i, 'production homepage should identify QuoteFlow');
console.log('PASS branded QuoteFlow homepage reachable');

const brandUrl = new URL(base);
if (brandUrl.hostname === 'quoteflow.allsetintl.com') {
  const parent = await fetch('https://allsetintl.com/', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(parent.status, 200, 'ALLSET parent website must be available');
  const parentHtml = await parent.text();
  assert.match(parentHtml, /href=["']https:\/\/quoteflow\.allsetintl\.com["']/, 'ALLSET product link must use the branded QuoteFlow domain');
  console.log('PASS ALLSET parent homepage links to branded QuoteFlow domain');
}
