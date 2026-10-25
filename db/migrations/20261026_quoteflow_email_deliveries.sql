-- QuoteFlow email outbox. Apply only after review; no historical backfill.
CREATE TABLE IF NOT EXISTS quoteflow_email_deliveries (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 stripe_session_id TEXT NOT NULL,
 email_kind TEXT NOT NULL DEFAULT 'payment_receipt',
 recipient_email TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_attempt_at TIMESTAMPTZ,
 next_retry_at TIMESTAMPTZ,
 lease_until TIMESTAMPTZ,
 sent_at TIMESTAMPTZ,
 provider_message_id TEXT,
 last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(stripe_session_id,email_kind)
);
CREATE INDEX IF NOT EXISTS quoteflow_email_deliveries_due_idx
 ON quoteflow_email_deliveries(status,next_retry_at) WHERE status IN ('PENDING','FAILED');
