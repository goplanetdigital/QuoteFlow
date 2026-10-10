# Issue #6 test-mode setup and release checklist

## What this implementation does

Upload RFQ and catalogue → review → approve source prices and exclusions → save an immutable server quotation → review that saved job → test Checkout → signature-verified payment webhook → private Excel / printable HTML delivery.

Quotation values always come from the uploaded approved catalogue. The configured service fee is separate from the quotation subtotal. Possible matches require explicit customer selection. Unmatched, unpriced and mismatched-unit lines cannot silently become ready. Excel includes a source/review audit sheet; printable HTML uses the browser's Print → Save as PDF.

`codex/revenue-launch` was the base. Its client export unlock and session-ID verification were replaced by job-specific server authorization. Existing branch tips and the original worktree are preserved. The prepared change is authorized for feature-branch and PR publication only. Merging and production deployment require separate authorization.

## Local setup

Use Node.js 24 and `npm ci`. Copy `.env.example` to `.env.local` and fill values locally or via the owner's secure development settings. Never commit `.env.local` or print its contents. Standalone scripts do not automatically load Next.js environment files. Use Node's env-file support:

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm run dev
```

Use a dedicated QuoteFlow PostgreSQL database. `DATABASE_URL` must include verified TLS for hosted databases; do not set `rejectUnauthorized:false` or point previews at production data. Migration creates only `qf_jobs`, `qf_uploads`, and `qf_stripe_events`. Give the runtime role only the permissions it needs; keep migration credentials separate where possible.

- `SITE_URL`: exact trusted origin for this environment, e.g. localhost in development or the intended HTTPS preview URL. Redirect destinations never come from the request Origin.
- `STRIPE_SECRET_KEY`: separate QuoteFlow **test** account key beginning `sk_test_`. Live keys are deliberately refused.
- `STRIPE_WEBHOOK_SECRET`: test endpoint signing secret beginning `whsec_`.
- `QUOTE_EXPORT_AMOUNT`: integer service fee in minor currency units (example 2900 = USD 29.00).
- `QUOTE_EXPORT_CURRENCY`: supported two-decimal fee currency: usd, myr, sgd, eur or gbp.
- `DATABASE_URL`: dedicated durable QuoteFlow Postgres connection.
- `NEXT_PUBLIC_SUPPORT_EMAIL`: owner-confirmed public support contact; never use it for secrets.

The prototype's `STRIPE_PRICE_QUOTE_EXPORT` and `NEXT_PUBLIC_SITE_URL` are no longer used. The new backend snapshots amount/currency in each job and uses server-side `price_data`; no Stripe Price object or account-setting change is required by the code.

## Test webhook setup (owner review required before remote publication)

Register `/api/webhooks/stripe` on the intended **test deployment**, or forward events locally using the Stripe CLI. Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

The route validates the raw body signature with Stripe's timestamp tolerance. It accepts test-mode Checkout payments whose session ID, job metadata, client reference, currency, amount, and mode match the stored job. A completed but unpaid event marks the job pending and does not fulfill an order. A signed event with matching immutable fields can repair an interrupted Checkout-save association. Failed or expired payments require a new job; pending payment jobs cannot initiate a second charge. Session IDs and success URLs never authorize a download.

Checkout creation uses a job-specific Stripe idempotency key and a PostgreSQL row lock. Repeated requests return the same saved session. Unsaved first/retry attempts are limited to the first 20 hours of a job, staying inside Stripe’s minimum 24-hour idempotency retention window. Expired sessions require a new job. Fulfillment generates both artifacts and writes the event record in one database transaction. A generation/database error returns a non-2xx response and rolls back, allowing Stripe to retry. Duplicate events and late failure/expiry events cannot regenerate or revoke a ready quotation. Operators can resend an event in **test** mode after fixing a failure. Keep event IDs for reconciliation.

Generation is deliberately synchronous and bounded: up to 500 RFQ lines, 5,000 catalogue items, and 1.5 MiB per upload; total multipart requests stay below the hosted function request limit. Larger files require a later direct-upload/storage workflow. Original uploads and results live in private database bytea columns; no public bucket or URL is created. Use a database provider with encryption at rest, managed backups and appropriate access controls.

## Access and retention

Each saved job has its own random 256-bit token in an HTTP-only, SameSite=Lax cookie restricted to that job's API path. Hosted cookies are Secure. Only its SHA-256 hash is stored. Knowing another job ID or Stripe session ID grants no access. Mutating endpoints require the configured same origin. Results are served with `private, no-store`, no-sniff and restrictive HTML CSP headers.

Self-service access expires after seven days, and clearing cookies removes it. There is no cross-device recovery or email delivery in this patch. Delivery is automatic on the private job/status page. Support recovery must verify the customer's identity before any future recovery feature is implemented.

Run the following daily against **only the dedicated QuoteFlow database** to delete expired records and associated uploads, artifacts and event IDs:

```sh
node --env-file=.env.local --import tsx scripts/cleanup.ts
```

No production cleanup schedule has been created. Configure a monitored schedule before a public pilot. Backup retention/deletion must be covered by the selected provider's policy. Privacy, refund terms and support contact need owner review. Add host-level abuse/rate controls before accepting public uploads.

## Automated verification

```sh
npm run test
npm run typecheck
npm run build
npm run test:e2e
```

The E2E suite runs Linux Chromium from an npm-packaged test binary, real ephemeral PostgreSQL, the production Next.js server, and a local Stripe HTTP simulator. The simulator validates the actual Stripe SDK Checkout request and emits signed synthetic webhooks. It is loaded only by the test process; application routes have no simulator switch or payment bypass. Embedded PostgreSQL's binary package needs its postinstall symlink setup (`npm rebuild @embedded-postgres/linux-x64` if dependencies were installed with scripts disabled).

Tests cover source pricing, uncertain matches, unsafe quantities/prices/units, unpaid downloads, a forged success redirect, cancellation, wrong/stale signatures, amount mismatch, async payment, duplicate/out-of-order events, failed-generation retries, concurrent sessions/uploads and cross-customer isolation. They also inspect the actual Excel values and printable HTML. A real Stripe-hosted test card and hosted database/preview integration are separate acceptance checks and must not be represented as completed by simulator tests.

## Remaining release gates

1. Provide dedicated preview database and test secrets securely, run migration, and set the trusted preview origin. No external infrastructure was provisioned by this patch.
2. Fix or replace the inherited `xlsx@0.18.5` dependency. npm reports prototype-pollution and ReDoS advisories with no npm fix; file size limits do not eliminate them. Preserve XLS/XLSX compatibility when evaluating the maintained upstream distribution.
3. Confirm support identity, retention scheduling/backups, abuse controls and approve policy wording.
4. Run a real QuoteFlow Stripe test-card checkout in a reviewed preview. Confirm success, cancellation, card decline, pending/failed async payments, signed webhook retry and duplication, restart durability and a second browser's isolation. Verify PDF/XLS/XLSX/CSV parsing on representative customer files, including selectable-text PDFs. OCR is not supported.
5. Check QuoteFlow account eligibility/activation manually. Live credentials are rejected by this implementation. Live launch needs a separately reviewed change and explicit authorization after fulfillment verification.

Do not modify TimeEase, Shopify, Payhip, n8n or Stripe live settings. Do not push, open a PR or publish without the user's approval.
