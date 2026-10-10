# QuoteFlow PR #7 — Vercel Preview testing

Target: `go-planet-digital/quote-flow`, project `prj_MbjZemw47Dz4UoyloYnMIdNvMQgp`, Node.js 24, branch `codex/issue-6-checkout-delivery`. Keep the PR draft. No merge, production deployment or live Stripe configuration is part of this work.

## Observed infrastructure status

On 10 October 2026 the existing branch Preview was READY, Vercel Authentication was enabled, the branch environment-variable list was empty, and no Neon integration was listed for the team. The workspace had no database/test Stripe credentials and no authenticated Vercel CLI. An authenticated request to that Preview's `/api/checkout` actually returned HTTP 503: test payments are not configured. These observations establish a build, not a working hosted payment journey. Hosted database migration and real Stripe test-card acceptance are **blocked**, not passed.

During this preparation, six values were actually created and verified through the connected Vercel account, scoped only to Preview and `codex/issue-6-checkout-delivery`: `SITE_URL`, `QF_DATABASE_SCOPE`, `QF_DATABASE_NAME`, `QUOTE_EXPORT_AMOUNT`, `QUOTE_EXPORT_CURRENCY`, and a generated sensitive `UPLOAD_ABUSE_SECRET`. No existing variables were overwritten and no Production variables were changed. Four required values remain absent: `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPPORT_EMAIL`. Local ignored `.vercel/project.json` records the verified project/team; an authenticated CLI is still unavailable.

The configured stable branch origin is `https://quote-flow-git-codex-issue-6-checkout-166cdc-go-planet-digital.vercel.app`. Use that origin for customer requests, redirects and the test webhook so new immutable deployment URLs do not conflict with `SITE_URL`.

## Dedicated database preparation

1. In [QuoteFlow Vercel storage](https://vercel.com/dashboard/go-planet-digital/stores), provision a **new dedicated Neon Preview resource**, or provide a verified existing resource dedicated solely to this QuoteFlow Preview. Do not attach any shared app or production database. Marketplace/provider provisioning requires account access not available in this workspace.
2. Create a database named `quoteflow_preview`. Keep its owner/direct connection separate from the limited runtime/pooled connection. Select a region near the Preview function region. Record the provider/resource identity privately and confirm that this is not production data.
3. Link the local repo to this exact Vercel project before hosted setup. Check `vercel whoami` and `.vercel/project.json`; do not use another team's default project. Credentials go in ignored local env files or the provider/Vercel secret UI, never the repository or chat.
4. In an ignored `.env.preview-migration.local`, put the **unpooled owner** `DATABASE_URL`, `QF_DATABASE_SCOPE=preview`, and `QF_DATABASE_NAME=quoteflow_preview`. Run:

   ```sh
   node --env-file=.env.preview-migration.local --import tsx scripts/migrate.ts
   ```

   The runner serializes migrations on a dedicated connection and applies numbered SQL in order. `001_jobs.sql` creates private jobs/uploads/events; `002_upload_protection.sql` adds rate counters/leases and revokes PUBLIC table access. Both migrations are idempotent. Local integration setup executes them twice against a disposable PostgreSQL database. **No hosted migration has run.** Use the direct endpoint for migrations because session advisory locks are not compatible with transaction-pooler connections.
5. Create the provider's limited runtime role through its secure UI. Review [runtime grants](preview-runtime-role.sql) and apply only to the dedicated database. The runtime needs no public access, DDL or direct SELECT on original upload bytes. Configure its **pooled** connection in Vercel Preview. Cleanup uses a separate owner/maintenance connection; never put that credential in the deployed runtime.

The application verifies the declared database name/scope on hosted connections, refuses production Vercel storage access, and forces TLS certificate verification after removing connection-string flags that could override it. These checks help catch mistakes but cannot prove that an operator supplied a genuinely separate provider resource; verify the resource identity too.

## Environment variables

Scope these variables to **Preview and this Git branch only**. Do not change Production values. Use Vercel Secret type for credentials; public variables contain only public information. No credential values are shown here.

| Variable | Type | Required value/purpose |
| --- | --- | --- |
| `DATABASE_URL` | Secret | Dedicated Preview runtime/pooled Postgres connection; verified TLS |
| `QF_DATABASE_SCOPE` | Config | `preview` |
| `QF_DATABASE_NAME` | Config | Exact database name, normally `quoteflow_preview` |
| `UPLOAD_ABUSE_SECRET` | Secret | Cryptographically random server-only HMAC key, at least 32 characters |
| `SITE_URL` | Config | Exact HTTPS Preview origin, no path/query; use a stable branch alias |
| `STRIPE_SECRET_KEY` | Secret | Dedicated QuoteFlow **test** key beginning `sk_test_` |
| `STRIPE_WEBHOOK_SECRET` | Secret | Signing secret for this Preview's **test** webhook endpoint |
| `QUOTE_EXPORT_AMOUNT` | Config | Integer fee in minor units, e.g. `2900`; separate from quote subtotal |
| `QUOTE_EXPORT_CURRENCY` | Config | Two-decimal supported currency: `usd`, `myr`, `sgd`, `eur` or `gbp` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Public Config | Owner-confirmed support contact; approve policy wording |

The HMAC secret has already been generated and stored as a sensitive Preview variable. Do not replace it merely to run tests. For a fresh environment, generate the HMAC key directly into an ignored secure file, then import it through Vercel without echoing it:

```sh
node -e 'require("node:fs").writeFileSync(".env.upload-secret.local",require("node:crypto").randomBytes(32).toString("hex"),{mode:0o600})'
vercel env add UPLOAD_ABUSE_SECRET preview --git-branch=codex/issue-6-checkout-delivery --type secret < .env.upload-secret.local
```

The repository already ignores `.env*` except the empty-value template, and `.vercel/`. Do not dump `vercel env` values. Preview Secrets may be omitted from `vercel env pull`; obtain separate development/migration credentials securely instead of copying Production Secrets. After adding Preview settings, trigger a **Preview-only** rebuild of this feature branch. This work relies on the existing Git Preview integration and does not invoke a production deployment.

`/api/readiness` reports readiness, missing key names, schema availability, branch and environment only; it never returns credentials, connection URLs, stored files or customer records. A READY deployment alone does not imply readiness. The hosted test runner requires this endpoint to return 200 with `environment=preview`, the expected branch, and `paymentMode=test`.

## Upload controls and privacy

All three upload endpoints (`extract-spreadsheet`, `extract-pdf`, `jobs`) share:

- 30 admitted/contended upload attempts per client per fixed 10-minute window; 300 globally.
- At most two active uploads per client and eight globally. Atomic PostgreSQL transactions and an advisory transaction lock enforce limits across serverless instances.
- A 120-second crash lease; explicit release on success and failure. Hosted upload functions have a 30-second maximum duration and body reads a 15-second deadline. Leases outlive terminated requests and expire after failures.
- Multipart validation and size bounds before parsing, same-origin validation using configured `SITE_URL`, and existing XLSX archive/XML limits. Forged PDF headers are rejected. Limiter/schema/config failure refuses uploads with 503 rather than falling back to process-local counters. Throttled requests return 429 with `Retry-After` and `no-store`.

Only Vercel's overwritten `x-forwarded-for` header is trusted on Vercel; missing/malformed/multiple addresses fail closed. Non-Vercel local tests use one shared identity and ignore spoofable IP headers. Keep Vercel's default header sanitization; custom proxy passthrough needs a separate security review. IP addresses are stored only as keyed HMACs; counters retain at most the current/previous window during traffic and are also removed by maintenance cleanup. Once the global quota is exhausted, new client rows are no longer created, bounding counter-table growth under rotating-IP abuse. Tokens and files never appear in rate records.

Original RFQ/catalogue bytes are private Postgres records, with no public URL/download route. Only generated artifacts can be downloaded, using job-specific HTTP-only, Secure hosted cookies after verified payment. Jobs expire after seven days. No cross-device recovery is implemented. Local tests inspect original bytes, hashed owner tokens, cookie boundaries, concurrent customer isolation, unapproved prices, expired access, source URL guessing and cascading deletion.

These controls are not a full DDoS firewall: rejected requests still reach the function/database, distributed traffic can exhaust the global quota, and shared NAT clients share a quota. Keep Vercel Authentication enabled for the limited Preview pilot; before a public launch review edge WAF/rate controls and monitoring. No project-wide firewall or protection settings were modified because those can also affect Production. Files are not antivirus-scanned, and parser unknown-vulnerability risk remains.

## Stripe test webhook and deployment protection

Register `https://<stable-preview-origin>/api/webhooks/stripe` **in Stripe test mode only**, for completed, async-success, async-failure and expired Checkout events. Store its signing secret in Preview. The code checks raw-body signatures/timestamp freshness, rejects live events, validates immutable job/session metadata/fee/currency, and deduplicates paid fulfillment atomically. A redirect never unlocks delivery; repeated Checkout requests share one idempotency key/session. Local tests verify SDK requests against a simulator, invalid/stale signatures, retries/duplicates, pending/failed events and delivery after restart.

Stripe cannot log into Vercel Authentication. The current Preview has that protection enabled. Before the real card run, provide a **reviewed narrowly scoped webhook access path**: a dedicated Preview hostname/webhook exception that leaves customer routes protected, or an authenticated Preview-only relay that forwards the original bytes/signature unchanged. If using Vercel's automation-bypass mechanism, its query credential is itself a secret, grants deployment access, and must never enter docs, logs or Git. Its security/scope must be reviewed by the owner; do not disable project-wide protection as a shortcut. Confirm webhook delivery in the Stripe test dashboard. No exception/relay/bypass credential has been configured here.

For browser/API automation, use existing Vercel authentication or a short-lived same-project development OIDC token. The protected-deployment helper was used for the observed 503. Do not use or alter Production Trusted Sources rules. Test runner protection headers are scoped to the Preview origin and are not sent to Stripe; tracing/HAR/screenshots are disabled to avoid capturing tokens.

## Executable verification

Local checks (real disposable Postgres and production Next.js; **simulated Stripe**):

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
npm audit
```

Real hosted test (separate runner; **no simulator**):

1. Finish the database, variables, protection/webhook path and Preview rebuild above.
2. Set `QF_PREVIEW_URL` to the exact stable HTTPS Preview origin in the test process. If protected, securely supply `QF_PREVIEW_OIDC_TOKEN` or the existing `VERCEL_OIDC_TOKEN` for the same project. These test-runner variables are not application settings and must not be published.
3. Ensure a Chromium binary is available through `QF_TEST_CHROMIUM` (the local managed workspace uses `/tmp/chromium`). Then run:

   ```sh
   npm run test:preview
   ```

The runner verifies readiness/Preview identity, uploads synthetic RFQ/catalogue, checks the approved 24.80 subtotal, saves the immutable job, confirms unpaid downloads are denied, navigates to `checkout.stripe.com`, refuses to fill fields unless the session is `cs_test_`, fills Stripe's documented `4242` test card, waits for actual webhook-gated delivery, reads Excel values/audit and checks another customer's download is denied. CAPTCHA, changed Stripe form markup, protection failure or a missing webhook fails the run and needs investigation; there is no skip/fake-success fallback. This runner has been prepared/typechecked but the real card journey has **not been executed successfully** in this work.

## Owner actions still required

- Provision/confirm the dedicated Preview database and credentials; run hosted migrations and runtime grants.
- Supply the four missing branch-scoped values (`DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPPORT_EMAIL`) securely; six others are already configured. Confirm the support contact and retention/backup policy.
- Create the Stripe **test** endpoint, authorize a safe webhook protection path, and rebuild Preview with the settings.
- Supply same-project automation access securely and run/review real test-card acceptance and customer-file compatibility. Do not infer payment acceptance from build or simulator success.

Do not use live payments, merge PR #7, deploy Production, or change TimeEase, Shopify, Payhip, n8n or Stripe live settings.
