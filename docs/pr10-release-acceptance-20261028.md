# PR #10 acceptance and release decision — 2026-10-28 MYT

**Decision: HOLD. Keep PR #10 Draft. No Production release is authorized or performed.**
Functional payment, durable outbox, retry and protected-download checks pass. Provider receipt-read permission and an authenticated running timer remain release gates. A READY build is not delivery acceptance.

## Tested scope

- Repository: `goplanetdigital/QuoteFlow`, PR #10, branch `fix/email-outbox-isolated-20261026`.
- Runtime code: `c4a2b9b1b7b24428046b6a5e4a79eafd52e36e2e`; later changes add acceptance/scheduler source and this report only.
- Existing Neon project `solitary-fog-81429256`, branch `br-summer-term-aonsnvyi`, database `neondb`, role `neondb_owner`. Both the trusted test runtime and deployed identity endpoint attest the isolated database. HTTPS transport is not a claim about native PostgreSQL TLS.
- Existing Vercel project `quote-flow` / `prj_MbjZemw47Dz4UoyloYnMIdNvMQgp`, team `team_TBtCBG3NWZSDwClr2BQ3Qn0V`.
- Existing Stripe Test credentials, Resend sending service and sole owned recipient `jcaiworker@gmail.com` reused. No live payment, customer email, Production environment write or schema migration was performed.

## Evidence

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Failed CI | PASS | Original run `40638850713` failed during dependency download with `ECONNRESET`; rerun succeeded. Runtime-code run `40658469752` also passed install, tests and build. PR checks skip Production smoke calls. |
| Regression / build | PASS | 29 deterministic tests; TypeScript and Next.js 15.5.28 build pass. Includes worker authentication, malformed input, provider receipt identity rejection and dry-run safety. |
| Actual Stripe Test success | PASS | Existing paid Test order / Outbox job 4 reused and independently verified against Stripe. Customer B's Test session also completed; no live-mode charge. |
| Actual Stripe Test decline | PASS | `tok_chargeDeclined` produced HTTP 402. Unpaid recovery and file capability returned 403. A clearly labelled signed async-failure fixture persisted a failed order with zero outbox rows. This fixture is not represented as a real Stripe async-failure event. |
| Durable outbox / duplicate webhook | PASS | Actual completion event replayed twice; one processed-event row and one Outbox row remain, with unchanged send attempts. No repeat send. |
| Paid terminal state | PASS | A late signed failure fixture did not revert the paid order. |
| Failed mail retry | PASS, injected provider | Actual dispatcher code and isolated Neon DB executed provider 503 → FAILED with due time → premature retry 409 → due retry 200 / SENT. Provider HTTP was deliberately stubbed, so no email was sent in this test. Exact body and idempotency key stayed identical. This does not claim an induced live Resend outage. |
| Lease / uncertain outcome limits | PASS | Expired lease recovered, new lease fenced the stale writer, concurrent claim denied, third attempt exhausted. Retry fixture deleted. Existing policy stops uncertain retries before Resend's deduplication window expires. |
| PDF / Excel delivery | PASS | Actual deployed downloads for customers A and B returned 200. Parsed XLSX and PDF content matched the saved customer and approved total 247.2; no-store headers verified. Secure recovery returned the original snapshot even when a different payload was supplied. |
| Customer isolation | PASS | A's signed capability used with B's session, and B's with A's, returned 403 for both formats. Correct capabilities delivered only their corresponding customer data. These are synthetic customers sharing the owned test inbox; the application uses unguessable session bearer recovery, not logged-in tenant accounts. |
| Mailbox arrival | PASS with placement limitation | Gmail message `1a180fa23bb00b50`, subject `QuoteFlow Preview payment confirmed [ad62ca49bff8]`, received 2026-10-28 13:27:18 MYT. Gmail headers show SPF and DKIM pass. The message is in SPAM, is text-only with a protected recovery link, and has no attachments. No inbox-placement or attachment claim is made. |
| Automatic provider receipt reconciliation | **BLOCKED** | Dispatcher returns HTTP 502 with upstream 401 `restricted_api_key`. Current send key cannot read the email record; `RESEND_READ_API_KEY` is absent from inspected environment metadata. Gmail evidence is not substituted into the provider delivery state. |
| Authenticated deployed worker GET | PASS for access control / failure reporting | Trusted no-mail control test: unauthenticated 401; authenticated tick dispatched no mail and surfaced the known provider-read failure as HTTP 503. Retry test fixtures were confirmed deleted. Deployment `dpl_BfwUnGTSLbrCQsv8z5yVoqJ82D79`; source `ee123c0`; CI `40659094858` passed. |
| Recurring worker | **BLOCKED: credential binding / timer acceptance** | GET `/api/email-dispatch` now performs bounded dispatch and reconciliation with authentication, while POST supports targeted jobs. Vercel rejected minute Cron on the existing Hobby plan. The rejected Cron declaration was removed; no paid upgrade occurred. A validated, unpublished n8n Preview draft is prepared below. |

Functional acceptance logs: [Vercel acceptance deployment](https://vercel.com/go-planet-digital/quote-flow/86imgQjNK3AnJEk77S7oKXvEqE6T), source `c4a2b9b`, tested API deployment `dpl_3oFAmcMYa1ACYYhQwMJLCZRJQzaU`. Acceptance reports `functionalGaps: PASS`, `providerReceipt: BLOCKED`; its build completion deliberately does not certify the blocked gate.

Export SHA-256 evidence:

| Customer | Format | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| A | PDF | 1452 | `d253bb5fdc905781f5ecac46e28e88acd772eb41a686fd9b67d71283d424c2b4` |
| B | PDF | 1466 | `854ee6c095c9431e2958a6ff9ebcffa9a9482d0a40e2a1957a5e09708841f943` |
| A | XLSX | 17411 | `7575ec8a7bebcb22666a77eeef8f69025c1b9123d9e0097114d130be1b5d11b0` |
| B | XLSX | 17425 | `d92c55a42a15a06b68e8cae948775d460c51cb011ef45a0d90829f51dc6c94d6` |

## Prepared Preview scheduler

[QuoteFlow PR10 - isolated Preview outbox worker](https://206-189-36-241.sslip.io/workflow/e9FOjLAqJJzZtCRL) is in the personal project **Jade Cheng <jcaiworker@gmail.com>**, at the project root. ID `e9FOjLAqJJzZtCRL`; inspected state `active: false`, `activeVersionId: null`; no credentials auto-assigned.

Source: `scripts/n8n-preview-worker.sdk.js`. Validated four-node draft: minute schedule, manual trigger, one bounded HTTP worker call and setup note. The URL is fixed to this PR's Preview branch, with redirects disabled. Existing database leases and provider idempotency handle overlapping calls. HTTP failures remain failures. No workflow has been published or scheduled in this task.

The connector explicitly reports that this HTTP node requires manual credential configuration. Do not retrieve/copy keys into chat, source files, node parameters, logs or execution inputs.

## Minimum remaining Preview operations

1. An authorized Resend operator must make an email-read-capable credential from the existing Resend account available through the secure Vercel variable editor as `RESEND_READ_API_KEY`, scoped only to **Preview + this PR branch**. Keep the sending key unchanged. Redeploy Preview and run `scripts/resume-preview-delivery-acceptance.mjs` against existing job 4: require provider receipt ID, recipient and subject match, a delivered/opened/clicked state, and persisted delivery reconciliation. No new payment or email is required.
2. In the prepared n8n draft's secure credential editor, bind **QuoteFlow PR10 Preview Worker** to the existing Preview worker secret with template `{"headers":{"Authorization":"Bearer {{api_key}}"}}`. No credential was exposed or copied by this task. Verify the manual call, then publish **only this Preview workflow** and observe at least two timer executions; require bounded successful dispatch/reconcile, no unapproved recipient and visible failure status. This step remains incomplete until credential binding and actual timer evidence exist.
3. Record the successful provider/timer evidence, review the observed Gmail SPAM placement, and require CI success on the final head. Keep Draft until all required gates are accepted. Resuming a receipt check must not rerun the already-passed payment flow.

## Formal release conditions and minimum Production operations — not executed

Only after the Preview gates pass and a separate Production release is authorized:

1. Review the exact final PR and additive `db/migrations/20261026_quoteflow_email_deliveries.sql`; verify/apply it against the existing Production database with a direct migration connection. No historical backfill, table reset or resend of old orders.
2. Configure Production provider receipt-read access and a dedicated authenticated worker credential (`CRON_SECRET`, or existing `QUOTEFLOW_DELIVERY_WORKER_SECRET` fallback). Preview credentials and n8n workflow must never be retargeted to Production. Prepare the Production timer separately in the existing scheduler. Keep Production outbox disabled until schema, provider and timer prerequisites are ready.
3. Approve the PR, stage the Production build, verify configuration and protected endpoint behavior, then coordinate activation of `QUOTEFLOW_OUTBOX_ENABLED=true`, the Production timer and the tested release. Confirm monitoring for due-job age, terminal failure, provider-read errors and lease expiry. Do not initiate a live payment or customer test email as part of this change without separate authorization.
4. Reversal: disable the worker timer and outbox flag, retain outbox/order rows and provider IDs for reconciliation, then roll back application code if needed. Disabling outbox makes paid webhooks return 503 for Stripe retry; restoring the older direct-send release while paid events retry requires an operator's reconciliation review to avoid duplicate receipts. A code rollback alone is not a mail-delivery rollback.
