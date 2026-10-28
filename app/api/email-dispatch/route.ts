import { NextRequest, NextResponse } from "next/server";
import { dispatchRequest } from "../../../lib/email-dispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try { return await dispatchRequest(request); }
  catch { return NextResponse.json({ error: "Delivery worker unavailable" }, { status: 503 }); }
}
