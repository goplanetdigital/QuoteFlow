import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadIdentity, uploadPolicy, UploadLimitError } from "../lib/server/abuse";
import { databaseOptions } from "../lib/server/database-config";
import { boundedBody, failure } from "../lib/server/http";
import { applicationOrigin } from "../lib/server/config";
const secret = "synthetic_upload_secret_for_unit_tests_only";
test("upload identity requires a secret and trusts client IP headers only on Vercel", () => {
  const a = new Request("https://preview.invalid", { headers: { "x-forwarded-for": "192.0.2.1" } });
  const b = new Request("https://preview.invalid", { headers: { "x-forwarded-for": "192.0.2.2" } });
  assert.throws(() => uploadIdentity(a, {}), /not configured/);
  assert.equal(uploadIdentity(a, { UPLOAD_ABUSE_SECRET: secret }), uploadIdentity(b, { UPLOAD_ABUSE_SECRET: secret }));
  assert.notEqual(uploadIdentity(a, { VERCEL: "1", UPLOAD_ABUSE_SECRET: secret }), uploadIdentity(b, { VERCEL: "1", UPLOAD_ABUSE_SECRET: secret }));
  for (const ip of ["", "attacker", "192.0.2.1, 192.0.2.2"]) assert.throws(() => uploadIdentity(new Request("https://preview.invalid", { headers: { "x-forwarded-for": ip } }), { VERCEL: "1", UPLOAD_ABUSE_SECRET: secret }), /identity/);
  assert.match(uploadIdentity(a, { VERCEL: "1", UPLOAD_ABUSE_SECRET: secret }), /^[a-f0-9]{64}$/);
  assert.ok(uploadPolicy.leaseSeconds > 30);
});
test("throttle responses carry a safe retry interval and cannot be cached", async () => {
  const response = failure(new UploadLimitError(120));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "120");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!(await response.text()).includes(secret));
});
test("hosted database configuration enforces dedicated Preview scope, name and verified TLS", () => {
  const env = { DATABASE_URL: "postgresql://synthetic:synthetic@database.invalid/quoteflow_preview?sslmode=require", QF_DATABASE_NAME: "quoteflow_preview", QF_DATABASE_SCOPE: "preview", VERCEL: "1", VERCEL_ENV: "preview" };
  const options = databaseOptions(env);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.ok(!options.connectionString?.includes("sslmode"));
  for (const patch of [{ QF_DATABASE_NAME: "production" }, { QF_DATABASE_SCOPE: "production" }, { VERCEL_ENV: "production" }, { DATABASE_URL: env.DATABASE_URL.replace("require", "no-verify") }, { QF_DATABASE_NAME: "" }]) assert.throws(() => databaseOptions({ ...env, ...patch }), /securely/);
  assert.equal(databaseOptions({ DATABASE_URL: "postgresql://synthetic:synthetic@localhost/quoteflow_test" }).ssl, undefined);
});
test("trusted origin configuration fails closed on Vercel and rejects path/credential/query tricks", () => {
  assert.throws(() => applicationOrigin({ VERCEL: "1" }));
  for (const site of ["http://preview.invalid", "https://user:password@preview.invalid", "https://preview.invalid/evil", "https://preview.invalid?origin=evil", "not-a-url"]) assert.throws(() => applicationOrigin({ SITE_URL: site }));
  assert.equal(applicationOrigin({ SITE_URL: "https://preview.invalid" }), "https://preview.invalid");
});
test("stalled body streams time out and are cancelled rather than being treated as a truncated successful upload", async context => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost/upload", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const assertion = assert.rejects(boundedBody(request, 10), /timed out/);
  context.mock.timers.tick(15001);
  await assertion;
  assert.equal(cancelled, true);
});
