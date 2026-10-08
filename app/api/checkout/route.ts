import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_QUOTE_EXPORT;

    if (!secret || !priceId) {
      return NextResponse.json(
        { error: "Payments are not configured yet." },
        { status: 503 }
      );
    }

    const stripe = new Stripe(secret);
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://quote-flow-blond.vercel.app";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: origin + "/?paid=1&session_id={CHECKOUT_SESSION_ID}#workspace",
      cancel_url: origin + "/?checkout=cancelled#workspace",
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_creation: "always",
      metadata: {
        product: "QuoteFlow quotation export",
        entitlement: "single_export_unlock"
      }
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("QuoteFlow checkout failed", error);
    return NextResponse.json(
      { error: "Unable to start checkout right now." },
      { status: 500 }
    );
  }
}
