# QuoteFlow Codex Instructions

## Mission

Build QuoteFlow as a focused revenue product for RFQ and quotation workflows.

The MVP must help a buyer, distributor, supplier, contractor, or sales team move from messy RFQ input to a reviewable quotation draft quickly and safely.

## Product flow

Upload → Extract → Match → Review → Price → Export

## Non-negotiable rules

1. Never fabricate a price.
2. Never silently substitute a catalogue item.
3. Any uncertain match must be explicitly flagged.
4. Preserve source text, quantity, and unit where possible.
5. Keep changes small and production-oriented.
6. Do not add unrelated features before the core flow works.

## MVP scope

Build only what supports:
- RFQ upload/input
- structured line extraction
- catalogue matching
- review flags
- approved pricing
- quotation preview
- Excel/PDF-ready export architecture

Do not build a full CRM, accounting suite, ERP, chat system, or general-purpose AI assistant.

## Engineering rules

- Prefer TypeScript.
- Prefer a simple Next.js app structure.
- Keep business logic separate from UI.
- Validate all incoming data.
- Add deterministic helpers for pricing and matching.
- Make external AI/provider use optional behind interfaces.
- Never commit secrets.
- Add tests for pricing and match-decision logic.

## Acceptance standard

A task is complete only when:
- the requested flow works end-to-end for synthetic demo data,
- uncertain results are visibly reviewable,
- no price is invented,
- build/tests pass,
- the change is documented.
