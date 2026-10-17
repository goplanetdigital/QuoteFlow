import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function validStripeSignature(payload: string, header: string, secret: string): boolean {
  const fields = header.split(",").map((part) => part.trim().split("="));
  const timestamp = fields.find(([key]) => key === "t")?.[1];
  const signatures = fields.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300) return false;
  const digest = createHmac("sha256", secret).update(timestamp + "." + payload).digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    return timingSafeEqual(digest, Buffer.from(signature, "hex"));
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !secret.startsWith("whsec_")) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await request.text();
  if (!validStripeSignature(body, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  let event: { id?: string; type?: string; livemode?: boolean };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.type !== "string" ||
      event.livemode !== (process.env.VERCEL_ENV === "production")) {
    return NextResponse.json({ error: "Invalid event environment" }, { status: 400 });
  }

  // Acknowledgement only. Do not claim order fulfillment here until durable,
  // idempotent order persistence and file-delivery processing are implemented.
  if (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed") {
    console.info("QuoteFlow Stripe event received", { type: event.type, id: event.id });
  }
  return NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
}
