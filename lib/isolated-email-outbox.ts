import { verifiedDatabase } from "./verified-database";
import { outboxEnabled, retryDecision } from "./delivery-policy";
export async function isolatedOutbox() {
  if (!outboxEnabled() || !process.env.DATABASE_URL) throw new Error("Outbox disabled");
  return verifiedDatabase(process.env.DATABASE_URL);
}
export async function claimDelivery(id: number) {
  const sql = await isolatedOutbox();
  const rows = await sql`
    UPDATE quoteflow_email_deliveries
    SET status='SENDING', attempts=attempts+1, last_attempt_at=now(),
        first_attempt_at=COALESCE(first_attempt_at,now()), lease_until=now()+interval '2 minutes',
        lease_token=gen_random_uuid(), next_retry_at=NULL, updated_at=now()
    WHERE id=${id} AND payload IS NOT NULL AND payload_hash IS NOT NULL
      AND attempts<3 AND provider_message_id IS NULL
      AND (first_attempt_at IS NULL OR first_attempt_at>now()-interval '23 hours')
      AND (status='PENDING' OR (status='FAILED' AND next_retry_at<=now()))
    RETURNING *
  `;
  return rows[0] ?? null;
}
export async function markSent(id: number, lease: string, messageId: string) {
  const sql = await isolatedOutbox();
  return sql`UPDATE quoteflow_email_deliveries
    SET status='SENT', provider_message_id=${messageId}, provider_status='accepted',
        sent_at=now(), lease_until=NULL, lease_token=NULL, next_retry_at=NULL,
        last_error=NULL, last_provider_status=200, updated_at=now()
    WHERE id=${id} AND lease_token=${lease}::uuid AND status='SENDING' AND provider_message_id IS NULL
    RETURNING id,status,provider_message_id`;
}
export async function markFailed(id: number, lease: string, status: number | null, attempts: number, firstAttempt: Date, providerError?: string) {
  const sql = await isolatedOutbox();
  const decision = retryDecision(status, attempts, firstAttempt, new Date(), providerError);
  return sql`UPDATE quoteflow_email_deliveries SET status='FAILED', lease_until=NULL, lease_token=NULL,
    last_error=${decision.reason}, last_provider_status=${status},
    next_retry_at=CASE WHEN ${decision.retry} THEN now()+(${decision.delaySeconds ?? 0} * interval '1 second') ELSE NULL END,
    updated_at=now() WHERE id=${id} AND lease_token=${lease}::uuid AND status='SENDING' RETURNING id,status,next_retry_at`;
}
export async function quarantineExpiredLeases() {
  const sql = await isolatedOutbox();
  return sql`UPDATE quoteflow_email_deliveries SET status='FAILED', lease_until=NULL, lease_token=NULL,
    next_retry_at=CASE WHEN first_attempt_at>now()-interval '23 hours' AND attempts<3 THEN now() ELSE NULL END,
    last_error='LEASE_EXPIRED_OUTCOME_UNKNOWN', updated_at=now()
    WHERE status='SENDING' AND lease_until<now() AND provider_message_id IS NULL RETURNING id`;
}

