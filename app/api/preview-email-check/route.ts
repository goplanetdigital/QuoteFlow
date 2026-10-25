import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Read-only preview diagnostic. Never reveals environment variable values.
export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supplied = request.nextUrl.searchParams.get("recipient")?.trim().toLowerCase() || "";
  const allowed = (process.env.QUOTEFLOW_TEST_EMAIL_ALLOWLIST || "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const configured = Boolean(process.env.RESEND_API_KEY);
  const strictlyIsolated = allowed.length === 1 && allowed[0] === "jcaiworker@gmail.com";
  return NextResponse.json({
    resendConfigured: configured,
    allowlistConfigured: strictlyIsolated,
    recipientAllowed: strictlyIsolated && supplied === "jcaiworker@gmail.com",
    deliveryEnabled: false
  }, { headers: { "Cache-Control": "no-store" } });
}
