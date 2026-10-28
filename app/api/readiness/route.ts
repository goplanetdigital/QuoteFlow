import { verifiedDatabase } from "../../../lib/verified-database";
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
    databaseConfigured: /^postgres(ql)?:\/\//.test(databaseUrl),
    databaseReachable: false,
    orderTablesReady: false,
    quoteSnapshotsReady: false
  };

  if (checks.databaseConfigured) {
    try {
      const sql = await verifiedDatabase(databaseUrl);
      const rows = await sql`SELECT
        to_regclass('public.quoteflow_orders') IS NOT NULL AS orders_ready,
        to_regclass('public.quoteflow_processed_events') IS NOT NULL AS events_ready,
        to_regclass('public.quoteflow_quote_snapshots') IS NOT NULL AS snapshots_ready`;
      checks.databaseReachable = rows.length === 1;
      checks.orderTablesReady = rows[0]?.orders_ready === true && rows[0]?.events_ready === true;
      checks.quoteSnapshotsReady = rows[0]?.snapshots_ready === true;
    } catch (error) {
      console.error("QuoteFlow readiness database check failed", {
        message: error instanceof Error ? error.message : "unknown"
      });
    }
  }

  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { ready, environment: production ? "production" : "preview", checks },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
