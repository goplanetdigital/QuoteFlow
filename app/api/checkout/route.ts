import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildQuote, type RfqLine, type CatalogueItem } from "../../../lib/quoteflow";

export const runtime = "nodejs";

function amountForItems(count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) return null;
  if (process.env.VERCEL_ENV !== "production" && process.env.QUOTE_STRIPE_TEST_MODE === "true") return 100;
  return count <= 20 ? 800 : count <= 100 ? 1800 : count <= 300 ? 3800 : 5900;
}

export async function POST(request: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const isProduction = process.env.VERCEL_ENV === "production";
  const allowedPrefixes = isProduction ? ["sk_live_", "rk_live_"] : ["sk_test_", "rk_test_"];
  if (!key || !allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
    const reason = !key ? "missing" : /^(?:sk|rk)_(?:test|live)_/.test(key) ? "wrong_mode" : "invalid_format";
    console.error("QuoteFlow checkout Stripe configuration mismatch", { environment: isProduction ? "production" : "preview", reason });
    return NextResponse.json({ error: isProduction ? "Stripe Live checkout is unavailable. The deployed server does not have a valid live Stripe API key. Please contact support; no payment was made." : "Stripe Test checkout is unavailable. Check the environment key.", code: "STRIPE_KEY_CONFIGURATION", reason }, { status: 503 });
  }
  try {
    const { payload, liveTestToken, growthCampaign } = await request.json();
    // Optional non-identifying campaign tag. Never treat this as proof of a paid referral.
    const campaign = typeof growthCampaign === 'string' && /^[a-z0-9_-]{1,48}$/.test(growthCampaign) ? growthCampaign : null;
    const configuredToken = process.env.QUOTE_LIVE_TEST_TOKEN?.trim();
    const liveTest = isProduction && process.env.QUOTE_LIVE_TEST_ENABLED === "true" && typeof liveTestToken === "string" && !!configuredToken &&
      Buffer.byteLength(liveTestToken) === Buffer.byteLength(configuredToken) &&
      timingSafeEqual(Buffer.from(liveTestToken), Buffer.from(configuredToken));
    if (typeof payload !== "string" || payload.length > 2_000_000 || payload.length < 2) {
      return NextResponse.json({ error: "Invalid quotation payload." }, { status: 400 });
    }
    const parsed = JSON.parse(payload);
    // Enforce PDF character safety on the server too; clients can bypass UI validation.
    // Until Unicode fonts are supported, never create a paid PDF+Excel Checkout
    // for source content that the PDF renderer could silently corrupt.
    const asciiOnly = (value: unknown) => !/[^\x20-\x7E]/.test(String(value ?? ""));
    const meta = parsed?.meta;
    const rfq = parsed?.rfqLines;
    const catalogue = parsed?.catalogue;
    if (!meta || typeof meta !== "object" || !Array.isArray(rfq) || !Array.isArray(catalogue) ||
        !rfq.length || rfq.length > 1000 || rfq.some((line: unknown) => !line || typeof line !== "object") ||
        catalogue.some((item: unknown) => !item || typeof item !== "object")) {
      return NextResponse.json({ error: "Invalid quotation data. No payment was made." }, { status: 422 });
    }
    // Recompute approved lines server-side. Only characters that actually appear
    // in the exported PDF should block checkout; unused catalogue rows are irrelevant.
    const base = buildQuote(rfq as RfqLine[], catalogue as CatalogueItem[]);
    const matches = parsed?.manualMatches && typeof parsed.manualMatches === "object" && !Array.isArray(parsed.manualMatches)
      ? parsed.manualMatches as Record<string, unknown> : {};
    const lines = base.lines.map((line) => {
      const selectedCode = matches[line.id];
      if (typeof selectedCode !== "string" || !selectedCode) return line;
      const selected = (catalogue as CatalogueItem[]).find((item) => item.code === selectedCode);
      if (!selected) return line;
      const price = selected.approvedUnitPrice;
      return { ...line, matchedCode: selected.code, matchedDescription: selected.description,
        approvedUnitPrice: price, lineTotal: price === null ? null : Number((price * line.quantity).toFixed(2)),
        reviewStatus: price === null ? "blocked" as const : "ready" as const };
    });
    if (lines.some((line) => line.reviewStatus !== "ready" ||
        !Number.isFinite(line.quantity) || line.quantity <= 0 ||
        !Number.isFinite(line.approvedUnitPrice) || (line.approvedUnitPrice ?? 0) < 0 ||
        !Number.isFinite(line.lineTotal))) {
      return NextResponse.json({ error: "All RFQ items need valid approved catalogue prices before checkout. No payment was made." }, { status: 422 });
    }
    const renderedFields = [meta.quoteNumber, meta.notes, meta.currency, meta.supplierName, meta.customerName,
      meta.validDays, parsed?.sourceName,
      ...lines.flatMap((line) => [line.code, line.description, line.matchedCode, line.matchedDescription, line.unit])];
    if (renderedFields.some((value) => !asciiOnly(value)) || !/^[A-Z]{3}$/.test(String(meta.currency ?? ""))) {
      return NextResponse.json({ error: "Checkout paused: quotation contains characters unsupported by PDF export or an invalid currency. No payment was made." }, { status: 422 });
    }
    const count = Array.isArray(parsed?.rfqLines) ? parsed.rfqLines.length : 0;
    const fingerprint = createHash("sha256").update(payload, "utf8").digest("hex");
    const amount = liveTest ? 100 : amountForItems(count);
    if (!amount) {
      return NextResponse.json({ error: "Invalid quotation." }, { status: 400 });
    }
    const siteUrl = isProduction ? "https://quoteflow.allsetintl.com" : request.nextUrl.origin;
    if (!siteUrl) return NextResponse.json({ error: "SITE_URL is not configured." }, { status: 503 });
    const site = new URL(siteUrl);
    if (site.protocol !== "https:" && !(site.protocol === "http:" && site.hostname === "localhost" && !isProduction)) {
      return NextResponse.json({ error: "Invalid SITE_URL configuration." }, { status: 503 });
    }
    // Return to the exact host that initiated Checkout so sessionStorage survives.
    const requestOrigin = request.nextUrl.origin;
    const requestHost = new URL(requestOrigin);
    const allowedHosts = new Set([site.hostname, "quoteflow.allsetintl.com"]);
    const origin = requestHost.protocol === "https:" && allowedHosts.has(requestHost.hostname) ? requestOrigin : site.origin;
    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][price_data][product_data][name]": "QuoteFlow quotation export (PDF + Excel)",
      "line_items[0][quantity]": "1",
      "client_reference_id": fingerprint,
      "metadata[fingerprint]": fingerprint,
      "metadata[itemCount]": String(count),
      "metadata[pricingVersion]": "3",
      ...(campaign ? { "metadata[growthCampaign]": campaign } : {}),
      "metadata[liveTest]": liveTest ? "true" : "false",
      success_url: origin + "/?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/?checkout=cancelled"
    });
    // Prevent duplicate Stripe sessions when the same checkout request is retried.
    // Include the exact Stripe request body so differing return URLs or campaigns
    // never share an idempotency key and trigger a parameter mismatch.
    const idempotencyKey = "quoteflow-checkout-v3-" + createHash("sha256").update(params.toString()).digest("hex");
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey },
      body: params.toString(),
      cache: "no-store"
    });
    const result = await response.json();
    if (!response.ok || !result.url) return NextResponse.json({ error: "Stripe checkout could not start." }, { status: 502 });
    // Persist the exact payload only after Stripe created a valid checkout session.
    // Do not return a checkout URL if the quote cannot be restored after payment.
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      console.error("QuoteFlow snapshot storage not configured");
      return NextResponse.json({ error: "Secure quotation storage is temporarily unavailable. No payment was made." }, { status: 503 });
    }
    try {
      const sql = neon(databaseUrl);
      await sql`INSERT INTO quoteflow_quote_snapshots (fingerprint, payload, expires_at)
        VALUES (${fingerprint}, ${JSON.stringify(payload)}::jsonb, now() + interval '90 days')
        ON CONFLICT (fingerprint) DO UPDATE SET payload = EXCLUDED.payload, expires_at = GREATEST(quoteflow_quote_snapshots.expires_at, now() + interval '90 days')`;
    } catch (error) {
      console.error("QuoteFlow snapshot persistence failed", error instanceof Error ? error.message : "unknown");
      return NextResponse.json({ error: "Secure quotation storage is temporarily unavailable. No payment was made." }, { status: 503 });
    }
    return NextResponse.json({ url: result.url });
  } catch {
    return NextResponse.json({ error: "Checkout request failed." }, { status: 400 });
  }
}
