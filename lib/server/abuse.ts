import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Pool } from "pg";
import { AppError } from "./config";
import { database } from "./store";

// Shared across all three upload endpoints and all serverless instances.
export const uploadPolicy = { windowSeconds: 600, perClient: 30, global: 300, clientConcurrency: 2, globalConcurrency: 8, leaseSeconds: 120 };
export class UploadLimitError extends AppError {
  constructor(public retryAfter: number) { super(429, "Upload limit reached. Please wait and retry."); }
}
export function uploadIdentity(request: Request, env: Readonly<Record<string, string | undefined>> = process.env) {
  const secret = env.UPLOAD_ABUSE_SECRET;
  if (!secret || secret.length < 32) throw new AppError(503, "Upload protection is not configured.");
  // Vercel overwrites x-forwarded-for by default. Never trust arbitrary proxy
  // headers outside Vercel, or use cookies/User-Agent as a spoofable identity.
  const ip = env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.trim() : "local";
  if (!ip || (env.VERCEL === "1" && !isIP(ip))) throw new AppError(503, "Upload client identity is unavailable.");
  return createHmac("sha256", secret).update(ip).digest("hex");
}
export async function reserveUpload(key: string, db: Pool = database()) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new AppError(503, "Upload protection is unavailable.");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='2s'");
    await c.query("SET LOCAL statement_timeout='3s'");
    // One short transaction serializes check-and-reserve globally, avoiding
    // multi-instance races. Parsing happens after COMMIT, never under this lock.
    await c.query("SELECT pg_advisory_xact_lock(716006, 1)");
    const seconds = Number((await c.query("SELECT extract(epoch FROM clock_timestamp()) AS seconds")).rows[0].seconds);
    const bucket = Math.floor(seconds / uploadPolicy.windowSeconds);
    const retry = Math.max(1, Math.ceil((bucket + 1) * uploadPolicy.windowSeconds - seconds));
    await c.query("DELETE FROM qf_upload_leases WHERE expires_at <= clock_timestamp()");
    await c.query("DELETE FROM qf_upload_rates WHERE bucket < $1", [bucket - 1]);
    // Stop creating client records once the global window is exhausted. This
    // also bounds rate-table cardinality under rotating-IP abuse.
    const global = (await c.query("SELECT attempts FROM qf_upload_rates WHERE client_key='global' AND bucket=$1", [bucket])).rows[0];
    if (global && global.attempts >= uploadPolicy.global) {
      await c.query("COMMIT"); throw new UploadLimitError(retry);
    }
    const rates = (await c.query(
      "INSERT INTO qf_upload_rates(client_key,bucket,attempts) VALUES($1,$2,1),('global',$2,1) ON CONFLICT(client_key,bucket) DO UPDATE SET attempts=LEAST(qf_upload_rates.attempts+1,301) RETURNING client_key,attempts", [key, bucket],
    )).rows;
    if (rates.some(r => r.attempts > (r.client_key === "global" ? uploadPolicy.global : uploadPolicy.perClient))) {
      await c.query("COMMIT"); throw new UploadLimitError(retry);
    }
    const active = (await c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE client_key=$1)::int AS client FROM qf_upload_leases", [key])).rows[0];
    if (active.total >= uploadPolicy.globalConcurrency || active.client >= uploadPolicy.clientConcurrency) {
      await c.query("COMMIT"); throw new UploadLimitError(uploadPolicy.leaseSeconds);
    }
    const id = randomUUID();
    await c.query("INSERT INTO qf_upload_leases(id,client_key,expires_at) VALUES($1,$2,clock_timestamp() + interval '120 seconds')", [id, key]);
    await c.query("COMMIT");
    return id;
  } catch (error) {
    if (!(error instanceof UploadLimitError)) await c.query("ROLLBACK");
    throw error;
  } finally { c.release(); }
}
export async function releaseUpload(id: string, db: Pool = database()) {
  await db.query("DELETE FROM qf_upload_leases WHERE id=$1", [id]);
}
export async function guardedUpload<T>(request: Request, maxBytes: number, action: () => Promise<T>) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new AppError(413, "Upload is too large.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
    throw new AppError(400, "Use a multipart file upload.");
  const id = await reserveUpload(uploadIdentity(request));
  try { return await action(); }
  finally {
    // A cleanup outage must not turn a committed job into an apparent failure.
    // Crash/outage leases expire; the admission path itself always fails closed.
    try { await releaseUpload(id); } catch { console.error("QuoteFlow upload lease cleanup unavailable"); }
  }
}
