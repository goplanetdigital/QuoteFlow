import { NextRequest, NextResponse } from "next/server";
import { claimDelivery, isolatedOutbox, markFailed, markSent, quarantineExpiredLeases } from "./isolated-email-outbox";
import { outboxEnabled, payloadHash, recipientAllowed, workerAuthorized, type MailPayload } from "./delivery-policy";
const noStore = { "Cache-Control": "no-store" };
export async function dispatchRequest(request: NextRequest) {
  if (!workerAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  if (!outboxEnabled() || !process.env.RESEND_API_KEY) return NextResponse.json({ error: "Worker disabled or provider unavailable" }, { status: 503, headers: noStore });
  let input: { id?: number; dryRun?: boolean; action?: string };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (input.action && !["dispatch", "reconcile"].includes(input.action)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const sql = await isolatedOutbox();
  // A dry-run never reclaims leases or mutates jobs.
  if (input.dryRun === false && input.action !== "reconcile") await quarantineExpiredLeases();
  const rows = input.id !== undefined ? await sql`SELECT * FROM quoteflow_email_deliveries WHERE id=${input.id}`
    : input.action === "reconcile" ? await sql`SELECT * FROM quoteflow_email_deliveries WHERE status='SENT'
        AND provider_message_id IS NOT NULL AND payload IS NOT NULL
        AND COALESCE(provider_status,'accepted') NOT IN ('delivered','opened','clicked','bounced','failed','complained')
        AND (provider_checked_at IS NULL OR provider_checked_at<now()-interval '5 minutes')
        ORDER BY provider_checked_at NULLS FIRST,created_at LIMIT 1`
    : await sql`SELECT * FROM quoteflow_email_deliveries WHERE provider_message_id IS NULL AND payload IS NOT NULL
        AND attempts<3 AND (status='PENDING' OR (status='FAILED' AND next_retry_at<=now())) ORDER BY created_at LIMIT 1`;
  const record = rows[0];
  if (!record) return NextResponse.json({ empty: true }, { status: input.id ? 404 : 200, headers: noStore });
  if (!recipientAllowed(record.recipient_email) || (process.env.VERCEL_ENV === "preview" && record.email_kind !== "isolated_preview_test"))
    return NextResponse.json({ error: "Forbidden recipient or job kind" }, { status: 403 });
  if (input.action === "reconcile") {
    if (!record.provider_message_id) return NextResponse.json({ error: "Provider id unavailable; manual reconciliation required" }, { status: 409 });
    if (input.dryRun !== false) return NextResponse.json({ id: record.id, dryRun: true, wouldReconcile: true }, { headers: noStore });
    const r = await fetch("https://api.resend.com/emails/" + encodeURIComponent(record.provider_message_id), {
      headers: { Authorization: "Bearer " + (process.env.RESEND_READ_API_KEY || process.env.RESEND_API_KEY) }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      return NextResponse.json({ error: "Provider reconciliation unavailable", providerStatus: r.status,
        providerError: typeof body.name === "string" ? body.name : undefined }, { status: 502, headers: noStore });
    }
    const receipt = await r.json();
    const to = Array.isArray(receipt.to) ? receipt.to.map((s: string) => s.toLowerCase()) : [];
    if (receipt.id !== record.provider_message_id || to.length !== 1 || to[0] !== record.recipient_email || receipt.subject !== record.payload?.subject)
      return NextResponse.json({ error: "Provider receipt identity mismatch" }, { status: 409 });
    const state = String(receipt.last_event || "unknown");
    await sql`UPDATE quoteflow_email_deliveries SET provider_status=${state}, provider_checked_at=now(),
      delivered_at=CASE WHEN ${state} IN ('delivered','opened','clicked') THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
      updated_at=now() WHERE id=${record.id} AND provider_message_id=${receipt.id}`;
    return NextResponse.json({ id: record.id, reconciled: true, providerStatus: state, delivered: ["delivered","opened","clicked"].includes(state) }, { headers: noStore });
  }
  const payload = record.payload as MailPayload | null;
  if (!payload || payloadHash(payload) !== record.payload_hash || payload.to.length !== 1 || payload.to[0] !== record.recipient_email)
    return NextResponse.json({ error: "Stored payload missing or changed; manual review required" }, { status: 409 });
  if (input.dryRun !== false) return NextResponse.json({ id: record.id, dryRun: true, status: record.status, eligible: record.status === "PENDING" || (record.status === "FAILED" && !!record.next_retry_at) }, { headers: noStore });
  const job = await claimDelivery(Number(record.id));
  if (!job) return NextResponse.json({ error: "Not claimable", status: record.status }, { status: 409, headers: noStore });
  if (payloadHash(job.payload) !== job.payload_hash || job.payload.to?.[0] !== job.recipient_email || !recipientAllowed(job.recipient_email)) {
    await markFailed(Number(job.id), job.lease_token, 409, Number(job.attempts), new Date(job.first_attempt_at));
    return NextResponse.json({ error: "Claimed payload identity mismatch" }, { status: 409 });
  }
  let status: number | null = null;
  let providerError: string | undefined;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": job.idempotency_key
    }, body: JSON.stringify(job.payload), signal: AbortSignal.timeout(15000) });
    status = r.status;
    const receipt = await r.json().catch(() => ({}));
    providerError = typeof receipt.name === "string" ? receipt.name : undefined;
    if (r.ok && typeof receipt.id === "string") {
      const updated = await markSent(Number(job.id), job.lease_token, receipt.id);
      return NextResponse.json({ id: job.id, accepted: true, providerStatus: r.status, recorded: updated.length === 1 }, { status: updated.length === 1 ? 200 : 503, headers: noStore });
    }
  } catch { /* Retry identical payload/key only within the bounded 23h window. */ }
  await markFailed(Number(job.id), job.lease_token, status, Number(job.attempts), new Date(job.first_attempt_at), providerError);
  return NextResponse.json({ error: "Provider result not confirmed", providerStatus: status, id: job.id }, { status: 502, headers: noStore });
}
