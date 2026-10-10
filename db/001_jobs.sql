BEGIN;
CREATE TABLE IF NOT EXISTS qf_jobs (
 id uuid PRIMARY KEY,
 owner_hash text NOT NULL,
 snapshot jsonb NOT NULL,
 amount integer NOT NULL CHECK(amount > 0),
 currency text NOT NULL,
 state text NOT NULL DEFAULT 'awaiting_payment' CHECK(state IN ('awaiting_payment','processing','ready','payment_failed','expired')),
 session_id text UNIQUE,
 checkout_url text,
 session_expires bigint,
 excel bytea,
 printable bytea,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS qf_uploads (
 job_id uuid NOT NULL REFERENCES qf_jobs(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('rfq','catalogue')),
 filename text NOT NULL,
 content bytea NOT NULL,
 PRIMARY KEY(job_id,kind)
);
CREATE TABLE IF NOT EXISTS qf_stripe_events (
 event_id text PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES qf_jobs(id) ON DELETE CASCADE,
 processed_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
