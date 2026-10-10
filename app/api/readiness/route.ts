import { NextResponse } from "next/server";
import { readiness } from "../../../lib/server/readiness";
export const runtime = "nodejs";
export async function GET() {
  const report = await readiness();
  return NextResponse.json(report, { status: report.ready ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
