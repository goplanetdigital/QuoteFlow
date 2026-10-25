import { neon } from "@neondatabase/serverless";

/**
 * Preview-only outbox primitives. No email is sent by this module.
 * DATABASE_URL must point to the dedicated isolated Neon branch.
 */
export function isolatedOutbox() {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.QUOTEFLOW_ISOLATED_OUTBOX_ENABLED !== "true" ||
      !process.env.DATABASE_URL) {
    throw new Error("Isolated outbox disabled");
  }
  return neon(process.env.DATABASE_URL);
}

export async function claimDelivery(id: number) {
  const sql = isolatedOutbox();
  const rows = await sql`
    UPDATE quoteflow_email_deliveries
    SET status = 'SENDING', attempts = attempts + 1,
        last_attempt_at = now(), lease_until = now() + interval '2 minutes',
        next_retry_at = NULL, updated_at = now()
    WHERE id = ${id}
      AND recipient_email = 'jcaiworker@gmail.com'
      AND attempts < 3
      AND provider_message_id IS NULL
      AND (status = 'PENDING' OR
           (status = 'FAILED' AND next_retry_at <= now()
            AND last_error IS DISTINCT FROM 'LEASE_EXPIRED_OUTCOME_UNKNOWN' AND last_error IS DISTINCT FROM 'PROVIDER_OUTCOME_UNKNOWN'))
    RETURNING id, recipient_email, idempotency_key, attempts
  `;
  return rows[0] ?? null;
}

export async function markSent(id: number, idempotencyKey: string, messageId: string) {
  const sql = isolatedOutbox();
  return sql`
    UPDATE quoteflow_email_deliveries
    SET status = 'SENT', provider_message_id = ${messageId},
        sent_at = now(), lease_until = NULL, updated_at = now(), last_error = NULL
    WHERE id = ${id} AND idempotency_key = ${idempotencyKey}
      AND status = 'SENDING' AND provider_message_id IS NULL
    RETURNING id, status, provider_message_id
  `;
}

export async function markFailed(id: number, idempotencyKey: string, reason: string) {
  const sql = isolatedOutbox();
  return sql`
    UPDATE quoteflow_email_deliveries
    SET status = 'FAILED', lease_until = NULL,
        last_error = ${reason.slice(0, 250)},
        next_retry_at = CASE WHEN attempts < 3
          THEN now() + (interval '1 minute' * power(2, attempts))
          ELSE NULL END, updated_at = now()
    WHERE id = ${id} AND idempotency_key = ${idempotencyKey}
      AND status = 'SENDING' AND provider_message_id IS NULL
    RETURNING id, status, attempts, next_retry_at
  `;
}

export async function quarantineExpiredLeases() {
  const sql = isolatedOutbox();
  return sql`
    UPDATE quoteflow_email_deliveries
    SET status = 'FAILED', lease_until = NULL, next_retry_at = NULL,
        last_error = 'LEASE_EXPIRED_OUTCOME_UNKNOWN', updated_at = now()
    WHERE status = 'SENDING' AND lease_until < now()
    RETURNING id
  `;
}
