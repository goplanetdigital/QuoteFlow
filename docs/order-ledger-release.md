# QuoteFlow order ledger release checklist

Production is currently on the stable webhook-only release. Do not promote the
ledger release until the checks below pass.

## Database

1. Use a dedicated QuoteFlow PostgreSQL database (not another product's database).
2. Run `db/migrations/001_quoteflow_order_ledger.sql` using a **direct** PostgreSQL
   connection, first against an isolated preview database/branch.
3. Verify that `quoteflow_orders` and `quoteflow_processed_events` exist and
   that their primary keys and constraints are present.
4. Configure `DATABASE_URL` in Vercel Preview. Test webhook persistence.
5. Configure `DATABASE_URL` in Vercel Production only after testing. Use a
   pooled connection for serverless runtime and a direct connection for migrations.
6. Redeploy Production with the ledger commit once schema and connection exist.

## Webhook validation

- Send a **signed Stripe test-mode** `checkout.session.completed` event for a
  completed test Checkout Session. Do not use a real-money charge.
- Confirm HTTP 200 and exactly one paid order row.
- Replay the same event ID: still one event row and one order row.
- Test a valid signed `checkout.session.async_payment_failed` event and
  confirm a failed order without overriding a previously paid order.
- Temporarily disconnect Preview database and verify HTTP 503 so Stripe retries.
- Check that incorrect signatures and timestamps return HTTP 400.
- Confirm Stripe destination uses the Production endpoint and live signing secret.

## Remaining release gate

The existing browser-side PDF and XLSX generators are not server-side protected
deliverables. A verified Checkout Session currently unlocks the browser UI,
but browser code can be bypassed. Server-side generation or signed stored
downloads are required before claiming tamper-resistant delivery.

Never place database credentials, webhook signing secrets, or API keys in Git.
