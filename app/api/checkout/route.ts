import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function amountForItems(count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) return null;
  if (process.env.QUOTE_STRIPE_TEST_MODE === "true") return 100;
  return count <= 20 ? 1000 : count <= 100 ? 2900 : count <= 300 ? 5900 : 9900;
}

export async function POST(request: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_test_")) {
    return NextResponse.json({ error: "Stripe test checkout is not configured." }, { status: 503 });
  }
  try {
    const { itemCount, fingerprint } = await request.json();
    const count = Number(itemCount);
    const amount = amountForItems(count);
    if (!amount || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      return NextResponse.json({ error: "Invalid quotation." }, { status: 400 });
    }
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][price_data][product_data][name]": "QuoteFlow quotation export (PDF + Excel)",
      "line_items[0][quantity]": "1",
      "metadata[fingerprint]": fingerprint,
      "metadata[itemCount]": String(count),
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
    return NextResponse.json({ url: result.url });
  } catch {
    return NextResponse.json({ error: "Checkout request failed." }, { status: 400 });
  }
}
