import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_test_")) return NextResponse.json({ paid: false }, { status: 503 });
  try {
    const { sessionId, fingerprint } = await request.json();
    if (typeof sessionId !== "string" || !/^cs_test_[a-zA-Z0-9]+$/.test(sessionId) ||
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
      session.metadata?.fingerprint === fingerprint;
    return NextResponse.json({ paid });
  } catch {
    return NextResponse.json({ paid: false }, { status: 400 });
  }
}
