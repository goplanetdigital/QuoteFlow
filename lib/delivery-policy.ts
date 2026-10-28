import { createHash, timingSafeEqual } from "node:crypto";
export const TEST_RECIPIENT = "jcaiworker@gmail.com";
export type MailPayload = { from: string; to: string[]; subject: string; text: string };
export function outboxEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview" ? process.env.QUOTEFLOW_ISOLATED_OUTBOX_ENABLED === "true"
    : process.env.VERCEL_ENV === "production" && process.env.QUOTEFLOW_OUTBOX_ENABLED === "true";
}
export function recipientAllowed(email: string): boolean {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  if (process.env.VERCEL_ENV !== "preview") return process.env.VERCEL_ENV === "production";
  const allowed = (process.env.QUOTEFLOW_TEST_EMAIL_ALLOWLIST || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return allowed.length === 1 && allowed[0] === TEST_RECIPIENT && email === TEST_RECIPIENT;
}
export function workerAuthorized(header: string | null): boolean {
  const secret = process.env.VERCEL_ENV === "preview" ? process.env.QUOTEFLOW_PREVIEW_WORKER_SECRET : (process.env.CRON_SECRET || process.env.QUOTEFLOW_DELIVERY_WORKER_SECRET);
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(createHash("sha256").update(secret).digest(), createHash("sha256").update(header.slice(7)).digest());
}
export function payloadHash(payload: MailPayload): string { return createHash("sha256").update(JSON.stringify([payload.from, payload.to, payload.subject, payload.text])).digest("hex"); }
export function retryDecision(status: number | null, attempts: number, firstAttempt: Date, now = new Date(), providerError?: string) {
  // Resend retains keys for 24h. Stop an hour early and never change the body.
  if (now.getTime() - firstAttempt.getTime() >= 23 * 60 * 60 * 1000) return { retry: false, reason: "IDEMPOTENCY_WINDOW_EXPIRED" };
  if (attempts >= 3) return { retry: false, reason: "ATTEMPTS_EXHAUSTED_RECONCILE" };
  const uncertain = status === null || (status >= 200 && status < 300) || (status === 409 && providerError === "concurrent_idempotent_requests");
  if (!uncertain && status !== null && status < 500 && status !== 429) return { retry: false, reason: "PROVIDER_REJECTED" };
  return { retry: true, reason: status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_OUTCOME_UNKNOWN", delaySeconds: Math.min(900, 60 * 2 ** (attempts - 1)) };
}
