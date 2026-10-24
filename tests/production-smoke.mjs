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
assert.ok([400,503].includes(verify.status), 'invalid session must be rejected');
const body = await verify.json();
assert.equal(body.paid, false, 'invalid payment cannot unlock files');
console.log('PASS invalid payment rejected; paid=false');

const webhook = await request('/api/stripe-webhook', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
assert.ok([400,503].includes(webhook.status), 'unsigned webhook must be rejected');
console.log('PASS unsigned webhook rejected');
