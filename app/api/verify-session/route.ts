import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return NextResponse.json({ paid: false }, { status: 503 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId || !sessionId.startsWith("cs_")) {
      return NextResponse.json({ paid: false }, { status: 400 });
    }

    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paid = session.payment_status === "paid";
    return NextResponse.json({
      paid,
      email: session.customer_details?.email ?? null,
      entitlement: paid ? "single_export_unlock" : null
    });
  } catch (error) {
    console.error("QuoteFlow session verification failed", error);
    return NextResponse.json({ paid: false }, { status: 500 });
  }
}
