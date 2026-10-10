# QuoteFlow

QuoteFlow turns RFQs and supplier price files into ready-to-review quotations.

## MVP

Upload an RFQ or supplier quote, review extracted line items and flagged matches, apply approved pricing, then export a customer-ready quotation.

## Initial flow

Upload → Extract → Match → Review → Price → Export

## Principles

- Never invent prices.
- Uncertain matches must be flagged.
- Preserve original descriptions and quantities.
- Keep a clear audit trail from source line to quoted line.
- Make review fast enough for real sales teams.


## Preview validation

Vercel is connected to this repository. Feature branches are validated with Vercel Preview before merging into `main`.

## Issue #6: test payments and private quotation delivery

The local Issue #6 implementation ties one immutable reviewed quotation to one test Checkout session. Only a signed, paid webhook can generate private Excel and printable results. Customer jobs and uploads persist in PostgreSQL and are authorized by job-specific browser cookies.

See [setup, tests and release gates](docs/issue-6-deployment.md). Live Stripe keys are rejected. Publication and real Stripe test acceptance remain subject to owner approval.
