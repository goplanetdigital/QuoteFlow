import { NextResponse } from "next/server";
import { AppError } from "../../../../lib/server/config";
import { boundedBody, failure } from "../../../../lib/server/http";
import { processPayment, stripeClient } from "../../../../lib/server/payment";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret?.startsWith("whsec_"))
      throw new AppError(503, "Test webhook is not configured.");
    const body = await boundedBody(request, 256 * 1024);
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new AppError(400, "Missing webhook signature.");
    const stripe = stripeClient();
    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
    } catch {
      throw new AppError(400, "Invalid webhook signature.");
    }
    await processPayment(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    return failure(error);
  }
}
