import { databaseOptions } from "./database-config";
import { paymentConfig } from "./config";
import { database } from "./store";
export const requiredPreviewKeys = ["SITE_URL", "DATABASE_URL", "QF_DATABASE_SCOPE", "QF_DATABASE_NAME", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "QUOTE_EXPORT_AMOUNT", "QUOTE_EXPORT_CURRENCY", "UPLOAD_ABUSE_SECRET", "NEXT_PUBLIC_SUPPORT_EMAIL"] as const;
export async function readiness() {
  const missing = requiredPreviewKeys.filter(key => !process.env[key]);
  let configured = missing.length === 0;
  try {
    paymentConfig(); databaseOptions();
    if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_") || (process.env.UPLOAD_ABUSE_SECRET?.length ?? 0) < 32 || !process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.includes("@")) configured = false;
  } catch { configured = false; }
  let storage = false;
  if (configured) {
    try {
      const r = await database().query("SELECT to_regclass('qf_jobs') IS NOT NULL AND to_regclass('qf_uploads') IS NOT NULL AND to_regclass('qf_stripe_events') IS NOT NULL AND to_regclass('qf_upload_rates') IS NOT NULL AND to_regclass('qf_upload_leases') IS NOT NULL AS ready");
      storage = r.rows[0].ready === true;
    } catch { /* No connection details or secrets in the public readiness report. */ }
  }
  return { ready: configured && storage, environment: process.env.VERCEL_ENV ?? "local", branch: process.env.VERCEL_GIT_COMMIT_REF ?? null, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, paymentMode: "test", configured, storage, missing };
}
