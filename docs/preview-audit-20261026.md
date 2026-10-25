# Preview audit — 2026-10-26 MYT

PR #10 remains Draft. No Production configuration, orders or secrets changed.

## Evidence
- Initial head: 31f613fa91d91b33300242ae091211ac42e21cb8.
- Initial deployment: dpl_HziyPAA8w8naH3DFWn3kgxfwyS6M, READY, correct PR branch.
- Neon API confirms non-default branch br-summer-term-aonsnvyi in project solitary-fog-81429256.
- Neon SQL confirms that exact branch/project, database neondb and role neondb_owner.
- Deployed /api/preview-db-identity returned 503: project=false, branch=false, database=true, role=true. This is evidence of a wrong runtime connection, not isolation success.
- Neon HTTP SQL transport reports pg_stat_ssl.ssl=false; native PostgreSQL TLS remains unverified. HTTPS and PostgreSQL TLS are distinct.
- Local: 19 tests pass; TypeScript and Next.js build pass.

## Repairs
Every server-side QuoteFlow database consumer now validates the Preview endpoint before connecting and checks the actual queried branch/project/database/role before application reads or mutations. Outbox mutations no longer rely solely on a configuration flag. The diagnostic explicitly does not claim PostgreSQL TLS verification. PR CI skips the Production smoke request.

## BLOCKED
Existing DATABASE_URL is sensitive. This task prohibits copying existing secrets, so no credentials were retrieved or transferred. In Vercel quote-flow → Settings → Environment Variables, an authorized operator must correct DATABASE_URL for Preview and this PR branch to the existing br-summer-term-aonsnvyi connection (neondb / neondb_owner), without changing Production. No reset or new secret is needed. Redeploy only Preview and rerun identity attestation.

Outbox enablement flags are not present in the inspected Preview environment metadata. Keep dispatch disabled until identity verification succeeds. The existing dispatcher sends text only: PDF/Excel attachment delivery and complete order E2E are NOT accepted. No emails, payments or order mutations were run.
