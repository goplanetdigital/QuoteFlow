import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const checkout = readFileSync("app/api/checkout/route.ts", "utf8");
const verify = readFileSync("app/api/verify-payment/route.ts", "utf8");
const webhook = readFileSync("app/api/stripe-webhook/route.ts", "utf8");

const functionSource = checkout.match(/function amountForItems\(count: number\) \{([\s\S]*?)\n\}/)?.[1];
assert.ok(functionSource, "Checkout pricing function must exist");
const js = functionSource.replace(/: number/g, "");
const context = { process: { env: { VERCEL_ENV: "production" } } };
const amount = vm.runInNewContext("(count) => {" + js + "\n}", context);

test("production tier boundaries in cents", () => {
  for (const [count, expected] of [[1,800],[20,800],[21,1800],[100,1800],[101,3800],[300,3800],[301,5900],[1000,5900]]) {
    assert.equal(amount(count), expected, "item count " + count);
  }
  for (const count of [0,-1,1001,1.5,NaN]) assert.equal(amount(count), null);
});

test("Stripe checkout tags pricing version 3", () => {
  assert.match(checkout, /"metadata\[pricingVersion\]": "3"/);
  assert.match(checkout, /"metadata\[fingerprint\]"/);
});

test("verification retains historical pricing and current tier values", () => {
  assert.match(verify, /pricingVersion === "2"/);
  assert.match(verify, /pricingVersion !== "3"/);
  for (const cents of ["800","1800","3800","5900"]) assert.match(verify, new RegExp("\\b"+cents+"\\b"));
});

test("webhook verifies signature, version 3 prices, and stores orders", () => {
  assert.match(webhook, /validStripeSignature\(body, signature, secret\)/);
  assert.match(webhook, /pricingVersion === "3"/);
  for (const cents of ["800","1800","3800","5900"]) assert.match(webhook, new RegExp("\\b"+cents+"\\b"));
  assert.match(webhook, /INSERT INTO quoteflow_orders/);
});
