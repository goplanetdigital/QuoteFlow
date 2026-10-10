import { NextResponse } from "next/server";
// Legacy unlock endpoint is retired: a session ID alone never grants access.
export async function GET() { return NextResponse.json({ paid: false, error: "Use the private quotation job status page." }, { status: 410 }); }
