import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const production = process.env.VERCEL_ENV === "production";
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const checks = {
    stripeKey: production ? /^(sk|rk)_live_/.test(key) : /^(sk|rk)_test_/.test(key),
    stripeWebhook: webhook.startsWith("whsec_"),
    databaseConfigured: /^postgres(ql)?:\/\//.test(databaseUrl)
  };
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { ready, environment: production ? "production" : "preview", checks },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
