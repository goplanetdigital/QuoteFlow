import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { reserveUpload, releaseUpload, UploadLimitError, uploadPolicy } from "../../lib/server/abuse";
const secret = "local_abuse_secret_for_tests_only_32_chars";
const key = createHmac("sha256", secret).update("local").digest("hex");
const origin = "http://localhost:3100";
function client(n: number) { return n.toString(16).padStart(64, "0"); }
async function withDatabase(action: (db: Pool) => Promise<void>) {
  const db = new Pool({ connectionString: process.env.QF_TEST_DATABASE_URL, max: 20 });
  try { await db.query("TRUNCATE qf_upload_rates, qf_upload_leases"); await action(db); }
  finally { await db.query("TRUNCATE qf_upload_rates, qf_upload_leases"); await db.end(); }
}
const upload = { kind: "rfq", file: { name: "rfq.csv", mimeType: "text/csv", buffer: Buffer.from("code,description,quantity,unit\nA,Part,1,pcs") } };
test("distributed concurrent admission never exceeds per-client or global limits and releases leases", async () => {
  await withDatabase(async db => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserveUpload(client(1), db)));
    const accepted = results.filter(r => r.status === "fulfilled");
    expect(accepted).toHaveLength(2);
    expect(results.filter(r => r.status === "rejected").every(r => r.reason instanceof UploadLimitError)).toBeTruthy();
    for (const r of accepted) if (r.status === "fulfilled") await releaseUpload(r.value, db);
    const global = await Promise.allSettled(Array.from({ length: 12 }, (_, n) => reserveUpload(client(n + 10), db)));
    expect(global.filter(r => r.status === "fulfilled")).toHaveLength(8);
    expect(Number((await db.query("SELECT count(*) FROM qf_upload_leases")).rows[0].count)).toBe(8);
    await db.query("UPDATE qf_upload_leases SET expires_at=now()-interval '1 second'");
    const next = await reserveUpload(client(100), db); await releaseUpload(next, db);
    expect(Number((await db.query("SELECT count(*) FROM qf_upload_leases")).rows[0].count)).toBe(0);
  });
});
test("upload endpoints share rate limits, count malformed attempts, ignore spoofed headers and return Retry-After", async ({ request }) => {
  await withDatabase(async db => {
    const bucket = Number((await db.query("SELECT floor(extract(epoch FROM now())/600) AS bucket")).rows[0].bucket);
    await db.query("INSERT INTO qf_upload_rates VALUES($1,$2,$3)", [key, bucket, uploadPolicy.perClient - 1]);
    const invalid = await request.post("/api/extract-spreadsheet", { headers: { Origin: origin }, multipart: { ...upload, file: { ...upload.file, name: "broken.xlsx" } } });
    expect(invalid.status()).toBe(422);
    for (const path of ["/api/extract-spreadsheet", "/api/extract-pdf", "/api/jobs"]) {
      const limited = await request.post(path, { headers: { Origin: origin, "x-forwarded-for": "192.0.2.200" }, multipart: upload });
      expect(limited.status()).toBe(429);
      expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    }
    expect(Number((await db.query("SELECT count(*) FROM qf_upload_leases")).rows[0].count)).toBe(0);
  });
});
test("global request quota and active concurrency block parsing; vanished database tables fail closed", async ({ request }) => {
  await withDatabase(async db => {
    const bucket = Number((await db.query("SELECT floor(extract(epoch FROM now())/600) AS bucket")).rows[0].bucket);
    await db.query("INSERT INTO qf_upload_rates VALUES('global',$1,300)", [bucket]);
    await expect(reserveUpload(client(123456), db)).rejects.toBeInstanceOf(UploadLimitError);
    expect(Number((await db.query("SELECT count(*) FROM qf_upload_rates WHERE client_key=$1", [client(123456)])).rows[0].count)).toBe(0);
    expect((await request.post("/api/extract-spreadsheet", { headers: { Origin: origin }, multipart: upload })).status()).toBe(429);
    await db.query("TRUNCATE qf_upload_rates");
    for (let n = 0; n < 2; n++) await db.query("INSERT INTO qf_upload_leases VALUES($1,$2,now()+interval '2 minutes')", [randomUUID(), key]);
    expect((await request.post("/api/extract-spreadsheet", { headers: { Origin: origin }, multipart: upload })).status()).toBe(429);
    await db.query("ALTER TABLE qf_upload_rates RENAME TO qf_upload_rates_unavailable");
    try { expect((await request.post("/api/extract-spreadsheet", { headers: { Origin: origin }, multipart: upload })).status()).toBe(503); }
    finally { await db.query("ALTER TABLE qf_upload_rates_unavailable RENAME TO qf_upload_rates"); }
  });
});
test("readiness confirms synthetic configuration/schema only, PDF checks reject forged/cross-origin uploads", async ({ request }) => {
  const status = await request.get("/api/readiness"); expect(status.status()).toBe(200);
  const report = await status.json(); expect(report.ready).toBeTruthy(); expect(report.paymentMode).toBe("test"); expect(JSON.stringify(report)).not.toContain(secret);
  await withDatabase(async db => {
    const file = { name: "forged.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") };
    expect((await request.post("/api/extract-pdf", { headers: { Origin: "https://attacker.invalid" }, multipart: { file } })).status()).toBe(403);
    expect((await request.post("/api/extract-pdf", { headers: { Origin: origin }, multipart: { file } })).status()).toBe(422);
    expect(Number((await db.query("SELECT count(*) FROM qf_upload_leases")).rows[0].count)).toBe(0);
  });
});
