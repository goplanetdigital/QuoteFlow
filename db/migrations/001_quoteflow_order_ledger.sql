-- QuoteFlow order ledger, apply with a direct PostgreSQL connection.
-- No customer document content is stored in this table.
CREATE TABLE IF NOT EXISTS quoteflow_orders (
  stripe_session_id text PRIMARY KEY,
  stripe_payment_intent_id text,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 1000),
  amount_total integer NOT NULL CHECK (amount_total >= 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  payment_status text NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed')),
  stripe_event_id text NOT NULL,
  stripe_event_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS quoteflow_orders_payment_intent_unique
  ON quoteflow_orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS quoteflow_processed_events (
  stripe_event_id text PRIMARY KEY,
  stripe_session_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quoteflow_processed_events_session_idx
  ON quoteflow_processed_events(stripe_session_id);
