BEGIN;
CREATE TABLE IF NOT EXISTS qf_upload_rates (
 client_key text NOT NULL CHECK(client_key='global' OR client_key ~ '^[a-f0-9]{64}$'),
 bucket bigint NOT NULL,
 attempts integer NOT NULL CHECK(attempts > 0),
 PRIMARY KEY(client_key,bucket)
);
CREATE INDEX IF NOT EXISTS qf_upload_rates_bucket ON qf_upload_rates(bucket);
CREATE TABLE IF NOT EXISTS qf_upload_leases (
 id uuid PRIMARY KEY,
 client_key text NOT NULL CHECK(client_key ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS qf_upload_leases_expiry ON qf_upload_leases(expires_at);
REVOKE ALL ON qf_jobs,qf_uploads,qf_stripe_events,qf_upload_rates,qf_upload_leases FROM PUBLIC;
COMMIT;
