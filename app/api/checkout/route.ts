import { NextResponse } from "next/server";
import { paymentConfig } from "../../../lib/server/config";
import { failure } from "../../../lib/server/http";
export async function GET() {
  try { const { amount, currency } = paymentConfig(); return NextResponse.json({ amount, currency, testMode: true }, { headers: { "Cache-Control": "no-store" } }); } catch(error) { return failure(error); }
}
