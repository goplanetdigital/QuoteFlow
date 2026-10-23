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

  const recognized = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed"
  ]);
  if (!recognized.has(event.type)) return NextResponse.json({ received: true });

  // A missing database must NOT acknowledge a paid order: Stripe can retry the event.
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("QuoteFlow webhook: DATABASE_URL missing");
    return NextResponse.json({ error: "Order storage unavailable" }, { status: 503 });
  }

  type CheckoutSession = {
    id?: string; mode?: string; currency?: string; amount_total?: number;
    payment_status?: string; payment_intent?: string | null;
    client_reference_id?: string;
    metadata?: { fingerprint?: string; itemCount?: string; liveTest?: string };
  };
  const checkout = (event as typeof event & { data?: { object?: CheckoutSession }; created?: number }).data?.object;
  const fingerprint = checkout?.metadata?.fingerprint;
  const count = Number(checkout?.metadata?.itemCount);
  const isProduction = process.env.VERCEL_ENV === "production";
  const expectedAmount = isProduction && checkout?.metadata?.liveTest === "true" && process.env.QUOTE_LIVE_TEST_TOKEN
    ? 100 : !isProduction && process.env.QUOTE_STRIPE_TEST_MODE === "true"
    ? 100 : count <= 20 ? 1000 : count <= 100 ? 2900 : count <= 300 ? 5900 : 9900;
  if (!checkout?.id?.startsWith(isProduction ? "cs_live_" : "cs_test_") ||
      checkout.mode !== "payment" || checkout.currency !== "usd" ||
      typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint) ||
      checkout.client_reference_id !== fingerprint ||
      !Number.isSafeInteger(count) || count < 1 || count > 1000 ||
      checkout.amount_total !== expectedAmount) {
    console.error("QuoteFlow webhook: invalid checkout metadata", { eventId: event.id });
    return NextResponse.json({ error: "Invalid checkout session" }, { status: 400 });
  }
  const paid = checkout.payment_status === "paid" &&
    (event.type === "checkout.session.completed" ||
     event.type === "checkout.session.async_payment_succeeded");
  const failed = event.type === "checkout.session.async_payment_failed";
  if (!paid && !failed) return NextResponse.json({ received: true });

  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(databaseUrl);
    // A single SQL statement makes event deduplication and order upsert atomic.
    // Paid is terminal here: a late failure event cannot undo a confirmed payment.
    await sql`
      WITH event_insert AS (
        INSERT INTO quoteflow_processed_events
          (stripe_event_id, stripe_session_id, event_type)
        VALUES (${event.id}, ${checkout.id}, ${event.type})
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING stripe_event_id
      )
      INSERT INTO quoteflow_orders
        (stripe_session_id, stripe_payment_intent_id, fingerprint, item_count,
         amount_total, currency, payment_status, stripe_event_id,
         stripe_event_created_at)
      SELECT ${checkout.id}, ${checkout.payment_intent ?? null}, ${fingerprint},
             ${count}, ${checkout.amount_total}, 'usd',
             ${paid ? "paid" : "failed"}, ${event.id},
             to_timestamp(${(event as typeof event & { created?: number }).created ?? 0})
      FROM event_insert
      WHERE true
      ON CONFLICT (stripe_session_id) DO UPDATE SET
        payment_status = CASE
          WHEN quoteflow_orders.payment_status = 'paid' THEN 'paid'
          ELSE EXCLUDED.payment_status
        END,
        stripe_payment_intent_id = COALESCE(
          quoteflow_orders.stripe_payment_intent_id, EXCLUDED.stripe_payment_intent_id
        ),
        stripe_event_id = CASE
          WHEN quoteflow_orders.payment_status = 'paid' THEN quoteflow_orders.stripe_event_id
          ELSE EXCLUDED.stripe_event_id
        END,
        stripe_event_created_at = CASE
          WHEN quoteflow_orders.payment_status = 'paid' THEN quoteflow_orders.stripe_event_created_at
          ELSE EXCLUDED.stripe_event_created_at
        END,
        updated_at = CASE
          WHEN quoteflow_orders.payment_status = 'paid' THEN quoteflow_orders.updated_at
          ELSE now()
        END
    `;
  } catch (error) {
    console.error("QuoteFlow webhook: order persistence failed", {
      eventId: event.id, message: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ error: "Order storage failed" }, { status: 503 });
  }
  return NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
}
