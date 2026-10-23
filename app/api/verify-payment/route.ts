import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const isProduction = process.env.VERCEL_ENV === "production";
  const allowedKeyPrefixes = isProduction ? ["sk_live_", "rk_live_"] : ["sk_test_", "rk_test_"];
  const expectedSessionPrefix = isProduction ? "cs_live_" : "cs_test_";
  if (!key || !allowedKeyPrefixes.some((prefix) => key.startsWith(prefix))) return NextResponse.json({ paid: false }, { status: 503 });
  try {
    const { sessionId, fingerprint } = await request.json();
    if (typeof sessionId !== "string" || !sessionId.startsWith(expectedSessionPrefix) || !/^cs_(?:test|live)_[a-zA-Z0-9]+$/.test(sessionId) ||
        typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      return NextResponse.json({ paid: false }, { status: 400 });
    }
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
      headers: { Authorization: "Bearer " + key }, cache: "no-store"
    });
    if (!response.ok) return NextResponse.json({ paid: false }, { status: 502 });
    const session = await response.json();
    const paid = session.mode === "payment" && session.status === "complete" &&
      session.payment_status === "paid" && session.currency === "usd" &&
      session.metadata?.fingerprint === fingerprint &&
      Number.isSafeInteger(Number(session.metadata?.itemCount)) &&
      Number(session.metadata.itemCount) >= 1 && Number(session.metadata.itemCount) <= 1000 &&
      session.amount_total === (isProduction && session.metadata?.liveTest === "true" ? 100 : isProduction || process.env.QUOTE_STRIPE_TEST_MODE !== "true"
        ? (session.metadata?.pricingVersion !== "2" && session.metadata?.pricingVersion !== "3"
          ? (Number(session.metadata.itemCount) <= 20 ? 1000 : Number(session.metadata.itemCount) <= 100 ? 2900 : Number(session.metadata.itemCount) <= 300 ? 5900 : 9900)
          : session.metadata?.pricingVersion === "2"
            ? (Number(session.metadata.itemCount) <= 20 ? 500 : Number(session.metadata.itemCount) <= 100 ? 1500 : Number(session.metadata.itemCount) <= 300 ? 2900 : 4900)
            : (Number(session.metadata.itemCount) <= 20 ? 800 : Number(session.metadata.itemCount) <= 100 ? 1800 : Number(session.metadata.itemCount) <= 300 ? 3800 : 5900))
        : 100) &&
      session.client_reference_id === fingerprint;
    return NextResponse.json({ paid });
  } catch {
    return NextResponse.json({ paid: false }, { status: 400 });
  }
}
