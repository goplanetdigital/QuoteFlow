# Issue #6 implementation report — 10 October 2026

Repository: goplanetdigital/QuoteFlow. Issue: https://github.com/goplanetdigital/QuoteFlow/issues/6.

Status: the user approved publication to a new feature branch and a Pull Request against main on 10 October 2026. This report records verification before that publication. Merging and production deployment remain unauthorized. Live charging is disabled by a strict test-key check.

## Authentication and preservation

The connected GitHub account is `goplanetdigital` (ID 299771345). GitHub repository metadata reports admin, maintain, pull, push and triage permissions; collaborator permission independently reports admin. No remote write was attempted to probe permissions. The initial shell `gh auth status` failed with its configured token; the connected GitHub identity supplied the verified access. Git fetching worked with the command's granted network access.

The original `/workspace/QuoteFlow` worktree is clean on `work`, at `2f90de3e67665fa36bd4de41b96c666aaf56134d`. All remote branches were enumerated via GitHub, fetched without pruning and inspected by comparison with main. Existing branch tips have been preserved:

| Remote branch | Tip | Comparison with main |
| --- | --- | --- |
| main | 2f90de3e67665fa36bd4de41b96c666aaf56134d | Original upload-first homepage and working RFQ flow |
| codex/home-above-fold-upload | 08b64d63bf2ac09a15e50a57d0c28b4115f6f7aa | Ahead 1; upload visibility CSS |
| codex/home-upload-first | 35d49f47d8b7b286d8a9898fef98dbb33fd47842 | Diverged, ahead 1 / behind 1; alternative homepage |
| codex/mvp01-workspace | 2f11625ff06544a96b501c4e68e518434eca4996 | Diverged, ahead 10 / behind 2; first review workspace |
| codex/mvp02-file-inputs | 64f2692b350eba49da842956344e89cf894cef6c | Diverged, ahead 14 / behind 2; CSV/Excel inputs |
| codex/mvp03-complete-mvp | 304c87aa68a9c3d73e77778d5aea675a31e063af | Diverged, ahead 22 / behind 2; PDF extraction and exports |
| codex/revenue-launch | 0f95854ca268098a973685bfe277f2e4983ac7b7 | Ahead 5; Checkout/session verification prototype |

Commit `71b6686` was not found in fetched objects, all-branch history or local reflogs. GitHub's direct commit lookup returned 422, “No commit found for SHA: 71b6686”. This does not establish whether it exists in another repository or an unavailable/deleted reference.

The implementation was prepared in `/workspace/work/quoteflow-issue6` on `codex/issue-6-local`, based on `codex/revenue-launch`. The authorized publication branch is `codex/issue-6-checkout-delivery`. No existing branch was rebased, reset, deleted or merged.

## Existing gaps and proposed implementation

Main had no payment backend. The revenue branch had server-side Checkout and a Stripe session lookup, but its export gate was client-side, not associated with an immutable quotation job. It had no signed payment webhook, private durable input/result storage or automated tests. Quotation data also remained in the browser and could be lost on a payment redirect.

The proposed local change:

- Keeps the current Next.js RFQ, catalogue, matching and review flow and starts from the existing revenue work.
- Saves original files and a server-validated, immutable quotation snapshot in a dedicated PostgreSQL database before Checkout. Files are private database records, with bounded upload sizes rather than public URLs or ephemeral filesystem storage.
- Uses server-controlled per-job service fees and trusted redirect origins. Live Stripe keys and live webhook events cannot unlock a quotation.
- Uses one job-specific Checkout session, Stripe idempotency and PostgreSQL row locks. Pending/complete/failed/expired jobs cannot initiate a second payment attempt. Unsaved Checkout retries remain within Stripe's minimum idempotency-retention window.
- Verifies raw webhook signatures, timestamp freshness, mode, amount, currency and job/session metadata. Completion alone with an unpaid status does not deliver a quotation. A signed event can repair an interrupted Checkout-save association only after all immutable fields match.
- Atomically generates/stores Excel and printable HTML with a processed event record. Failures roll back for retry; duplicates do not regenerate delivery, and later failure/expiry events do not revoke ready output.
- Authorizes status and downloads with per-job HTTP-only cookies; a different browser, job ID or Stripe session ID cannot access another customer's files. Results survive a server restart.
- Uses only uploaded catalogue prices and explicit approval of uncertain matches. Invalid quantities, negative prices, duplicate catalogue codes and unit mismatches cannot silently enter a quote. Excel includes a review/source audit sheet and guards spreadsheet formula injection; printable HTML escapes customer content.
- Adds saved-job, success, cancellation and result/status UX, test support/privacy/terms/refund copy, server-only configuration documentation, migration and seven-day cleanup scripts.
- Patches Next.js to 15.5.27 and pins PostCSS 8.5.29 to resolve audit findings in those dependencies.

Delivery is automatic on the private job page after verified payment. It does not send email. PDF output uses the browser's Print → Save as PDF; no standalone binary PDF renderer is claimed.

## Final verification results

| Check | Result | Evidence / limitations |
| --- | --- | --- |
| Deterministic automated tests | PASS | 13 passed, 0 failed, 0 skipped |
| Browser/API/database integration | PASS | 5 passed using Linux Chromium, real ephemeral PostgreSQL, production Next.js and a local Stripe HTTP simulator |
| TypeScript | PASS | `npm run typecheck` completed successfully |
| Production build | PASS | `npm run build` compiled, checked types, generated pages and completed build tracing |
| Diff whitespace checks | PASS | `git diff --check` completed successfully |
| Production dependency audit | BLOCKED | One high-severity affected dependency, inherited `xlsx@0.18.5`, with prototype-pollution and ReDoS advisories; no npm fix available |
| Real Stripe-hosted test-card acceptance | NOT RUN | Real QuoteFlow test credentials and a configured test endpoint were not available |
| Hosted deployment / database acceptance | NOT RUN | No deployment, infrastructure provisioning or environment settings were changed |
| Live account eligibility / charging | NOT VERIFIED / DISABLED | No live account settings were inspected or changed; live credentials are refused by the code |

The five integration scenarios verified:

1. Browser CSV uploads → explicit match approval → frozen server quotation → actual Stripe SDK request to a simulator → signed webhook → Excel with the expected subtotal and printable output. Browser page errors were also checked.
2. A forged success URL cannot unlock downloads; cancellation retains the saved job.
3. Concurrent customers/uploads and repeated Checkout requests stay isolated; client fee/currency tampering is ignored.
4. Wrong/stale signatures, mismatched fees, pending completion, failed/async-success events and duplicates behave correctly. Stored files/event deduplication were inspected in PostgreSQL. Restarting the application retained the same authorized result bytes.
5. Cross-origin mutations, oversized bodies and wholly unresolved quotations fail safely.

The deterministic suite additionally covers failed-generation rollback/retry, out-of-order events, live/mismatched/foreign sessions, source pricing and uncertain matches, malformed quantities/prices/units, multiline CSV parsing, unsafe quotation content, missing/live configuration, interrupted Checkout association repair and the idempotency retry window.

## Missing requirements before release

1. Resolve the inherited `xlsx` security advisories before accepting public untrusted spreadsheets. The small-file limit is not a fix. Maintained upstream distribution or a replacement needs review while retaining XLS/XLSX compatibility.
2. Securely supply a dedicated preview PostgreSQL connection, QuoteFlow test API/webhook secrets and trusted site origin; run the migration. No real secret has been added to GitHub or the repository.
3. Complete a real Stripe-hosted test-card run and verify the webhook endpoint/retries in the intended preview. Simulator success is not real Stripe acceptance.
4. Confirm the public support contact, review policy/refund wording, configure monitored data cleanup/backups and host-level abuse controls. Cookie access is browser-specific; cross-device recovery is not implemented.
5. Verify representative PDF/XLS/XLSX customer files in preview, including PDF extraction review. OCR remains unsupported. Each file is limited to 1.5 MiB; bigger uploads need a later direct-upload architecture.
6. Verify account eligibility separately before considering live charging. Live mode needs a separately reviewed code change and explicit authorization.

No TimeEase, Shopify, Payhip, n8n or Stripe live settings were changed. Publication authorization covers only the new QuoteFlow feature branch and PR against main. Do not merge, enable auto-merge or deploy to production.
