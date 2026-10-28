import { NextRequest, NextResponse } from "next/server";
import { dispatchRequest } from "../../../lib/email-dispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { return await dispatchRequest(request); }
  catch { return NextResponse.json({ error: "Isolated worker unavailable" }, { status: 503 }); }
}

