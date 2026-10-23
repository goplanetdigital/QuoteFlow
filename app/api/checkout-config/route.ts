import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ testPriceMode: process.env.VERCEL_ENV !== "production" && process.env.QUOTE_STRIPE_TEST_MODE === "true" }, { headers: { "Cache-Control": "no-store" } });
}
