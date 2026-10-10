# Spreadsheet security — PR #7

The direct dependency `QuoteFlow → xlsx@0.18.5` was the only vulnerable SheetJS path. Both its prototype-pollution advisory (GHSA-4r6h-8v6p-xvw6) and ReDoS advisory (GHSA-5pgg-2g8v-p4x9) affected browser uploads and server job creation. Excel delivery and its tests also imported that package. It has been removed, including its transitive packages and lockfile entries.

## Replacement and preserved behavior

Pinned `read-excel-file@9.3.12` and `write-excel-file@4.1.1` provide XLSX reading and multi-sheet delivery. Their npm metadata showed updates in October and June 2026 respectively. `yauzl@3.4.0` streams ZIP validation, `sax@1.6.0` validates XML, and `fflate@0.8.3` rebuilds a checked archive. The full npm audit reports zero known vulnerabilities in production and development dependencies; this is not proof against unknown vulnerabilities.

Spreadsheet preview now calls `/api/extract-spreadsheet`; it stores nothing and loads no spreadsheet parser into the browser. Preview and authoritative job creation share the same XLSX validator. Source descriptions, multiline text, quantities, text product codes, explicit uncertain-match approval and catalogue prices retain their existing flow. Blank prices stay unapproved. Excel still contains `Quotation` and `Review audit` sheets, numeric approved totals and excluded-line information. String cells are written as text with formula-injection guards. The webhook awaits the writer inside its existing transaction; generation failures still roll back the job and processed-event record for retry.

## Untrusted upload checks

- Compressed file limit: 1.5 MiB; actual expanded total: 16 MiB; individual entry: 8 MiB; archive: at most 100 entries. Streaming limits apply to actual decompressed bytes, and declared sizes are validated too.
- ZIP entries are never extracted to disk. Unsafe paths, duplicate file names, encryption and non-XML binary content are rejected. The reader receives a rebuilt archive containing only validated entries, avoiding disagreements between ZIP local and central headers.
- Strict UTF-8/XML validation rejects DTDs/entities, malformed XML, multiple roots, excessive nesting/node count, formulas (including namespace-prefixed formulas), macro content types, external relationships and embedded binary files. No formula is evaluated and no external relationship is fetched.
- Worksheet rows/coordinates are bounded to 501 for RFQs and 5,001 for catalogues, including the header; at most 32 columns and 160,032 cells across the archive. Boolean/date cells and malformed/non-finite numeric values fail validation rather than becoming prices.
- Errors produce controlled 400/422 responses; malformed XLSX does not become a server exception or save a payable job. Preview also requires same origin and a bounded multipart body.

## Compatibility

Import values-only `.xlsx` or CSV. Convert legacy `.xls` in trusted spreadsheet software first. Paste formulas as values before upload and review resulting prices. Macro-enabled, password-protected, externally linked, image-bearing or embedded-object workbooks are rejected. Only the first sheet is imported; every archive entry is still checked. Keep product codes (especially leading zeroes) as text cells. Numeric display formatting is not a source of price or code values. Date/boolean inputs are unsupported for RFQ/catalogue fields. Keep sheets within the documented dimensions; remove extra hidden sheets/columns/content when needed. Selectable-text RFQ PDF extraction remains unchanged; OCR is unsupported.

## Verification and remaining risks

The eleven new unit scenarios cover valid XLSX source/price preservation, forged/truncated archives and malformed XML, cached/prefixed formulas, DTD/deep XML, external links/macros/embedded objects, sparse huge coordinates, decompression bombs/excessive entries, unsafe paths/prototype property names, non-finite/date/boolean values, duplicate/encrypted archives and false ZIP size metadata. Existing matching, pricing, export and payment tests remain. Browser/API/Postgres tests cover real XLSX preview → approval → payment simulator → signed webhook → Excel/printable results, plus malicious preview and direct job rejection without database creation.

PR #7 now adds shared database upload quotas and admission leases; see [Preview testing](vercel-preview-testing.md). Retain protection and add reviewed edge controls before public uploads: application-rejected requests still consume function/database resources. XML/ZIP parsers retain unknown-vulnerability risk; continue dependency audits and representative customer-file acceptance. Original uploads are stored privately in Postgres but are not antivirus-scanned; this implementation never executes them or returns original uploads as downloads. PDF parsing is unchanged and is outside this spreadsheet fix. Hosted secrets/database TLS, migrations, cleanup/backups, support/policy review and a real Stripe-hosted test-card/webhook acceptance run remain deployment gates. Tests use a local Stripe simulator, not a real hosted payment.

Only QuoteFlow repository code and documentation change. Stripe remains test-only; no external service settings, production deployment, merge or auto-merge are authorized by this patch.
