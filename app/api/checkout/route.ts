import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

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
    const count = Array.isArray(parsed?.rfqLines) ? parsed.rfqLines.length : 0;
    const fingerprint = createHash("sha256").update(payload, "utf8").digest("hex");
    const amount = liveTest ? 100 : amountForItems(count);
    if (!amount) {
      return NextResponse.json({ error: "Invalid quotation." }, { status: 400 });
    }
    const siteUrl = isProduction ? "https://quote-flow-go-planet-digital.vercel.app" : request.nextUrl.origin;
    if (!siteUrl) return NextResponse.json({ error: "SITE_URL is not configured." }, { status: 503 });
    const site = new URL(siteUrl);
    if (site.protocol !== "https:" && !(site.protocol === "http:" && site.hostname === "localhost" && !isProduction)) {
      return NextResponse.json({ error: "Invalid SITE_URL configuration." }, { status: 503 });
    }
    // Return to the exact host that initiated Checkout so sessionStorage survives.
    const requestOrigin = request.nextUrl.origin;
    const requestHost = new URL(requestOrigin);
    const allowedHosts = new Set([site.hostname]);
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
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
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
