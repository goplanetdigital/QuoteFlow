import { verifiedDatabase } from "../../../lib/verified-database";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// The Checkout Session ID is an unguessable bearer recovery credential.
// Never put it in public pages, analytics, or server logs.
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();
    const production = process.env.VERCEL_ENV === "production";
    if (typeof sessionId !== "string" || !/^cs_(?:live|test)_[a-zA-Z0-9]+$/.test(sessionId) ||
        !sessionId.startsWith(production ? "cs_live_" : "cs_test_")) {
      return NextResponse.json({ error: "Invalid Checkout Session ID." }, { status: 400 });
    }
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    const db = process.env.DATABASE_URL?.trim();
    if (!key || !db || !(production ? /^(sk|rk)_live_/.test(key) : /^(sk|rk)_test_/.test(key))) {
      return NextResponse.json({ error: "Recovery is temporarily unavailable." }, { status: 503 });
    }
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
      headers: { Authorization: "Bearer " + key }, cache: "no-store"
    });
    if (!response.ok) return NextResponse.json({ error: "Payment could not be verified." }, { status: 404 });
    const session = await response.json();
    const fingerprint = session.metadata?.fingerprint;
    const count = Number(session.metadata?.itemCount);
    const version = session.metadata?.pricingVersion;
    const standard = version === "3" ? (count <= 20 ? 800 : count <= 100 ? 1800 : count <= 300 ? 3800 : 5900)
      : version === "2" ? (count <= 20 ? 500 : count <= 100 ? 1500 : count <= 300 ? 2900 : 4900)
      : (count <= 20 ? 1000 : count <= 100 ? 2900 : count <= 300 ? 5900 : 9900);
    const amount = production && session.metadata?.liveTest === "true" ? 100
      : !production && process.env.QUOTE_STRIPE_TEST_MODE === "true" ? 100 : standard;
    if (session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid" ||
        session.currency !== "usd" || !Number.isSafeInteger(count) || count < 1 || count > 1000 ||
        session.amount_total !== amount || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint) ||
        session.client_reference_id !== fingerprint) {
      return NextResponse.json({ error: "Payment not eligible for recovery." }, { status: 403 });
    }
    const sql = await verifiedDatabase(db);
    const rows = await sql`SELECT payload::text AS payload FROM quoteflow_quote_snapshots
      WHERE fingerprint = ${fingerprint} AND expires_at > now() LIMIT 1`;
    const payload = rows[0]?.payload ? JSON.parse(rows[0].payload) : null;
    if (typeof payload !== "string" || createHash("sha256").update(payload, "utf8").digest("hex") !== fingerprint) {
      return NextResponse.json({ error: "Quotation snapshot unavailable or expired." }, { status: 404 });
    }
    return NextResponse.json({ payload }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Recovery failed." }, { status: 400 });
  }
}
