import { verifiedDatabase } from "../../../lib/verified-database";
import { outboxEnabled, payloadHash, recipientAllowed, type MailPayload } from "../../../lib/delivery-policy";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
    customer_details?: { email?: string | null } | null;
    customer_email?: string | null;
    metadata?: { fingerprint?: string; itemCount?: string; liveTest?: string; pricingVersion?: string };
  };
  const checkout = (event as typeof event & { data?: { object?: CheckoutSession }; created?: number }).data?.object;
  const fingerprint = checkout?.metadata?.fingerprint;
  const count = Number(checkout?.metadata?.itemCount);
  const isProduction = process.env.VERCEL_ENV === "production";
  // Keep webhook amount validation aligned with Checkout and payment verification.
  // Historical sessions can use legacy pricing; never accept an arbitrary amount.
  const pricingVersion = checkout?.metadata?.pricingVersion;
  const standardAmount = pricingVersion === "3"
    ? (count <= 20 ? 800 : count <= 100 ? 1800 : count <= 300 ? 3800 : 5900)
    : pricingVersion === "2"
      ? (count <= 20 ? 500 : count <= 100 ? 1500 : count <= 300 ? 2900 : 4900)
      : (count <= 20 ? 1000 : count <= 100 ? 2900 : count <= 300 ? 5900 : 9900);
  const expectedAmount = isProduction && checkout?.metadata?.liveTest === "true"
    ? 100 : !isProduction && process.env.QUOTE_STRIPE_TEST_MODE === "true"
      ? 100 : standardAmount;
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


  const recipient = (checkout.customer_details?.email ?? checkout.customer_email ?? "").trim().toLowerCase();
  if (paid && !outboxEnabled()) return NextResponse.json({ error: "Automated delivery not enabled" }, { status: 503 });
  if (paid && !recipientAllowed(recipient)) return NextResponse.json({ error: "Preview recipient not allowed or invalid recipient" }, { status: 403 });
  const siteUrl = "https://quoteflow.allsetintl.com";
  const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL || "";
  if (paid && !isProduction && !/^quote-flow-[a-z0-9-]+-go-planet-digital\.vercel\.app$/.test(previewHost))
    return NextResponse.json({ error: "Preview delivery origin invalid" }, { status: 503 });
  const recoveryUrl = new URL(isProduction ? siteUrl : "https://" + (previewHost || "invalid.example"));
  recoveryUrl.hash = new URLSearchParams({ recover_session: checkout.id }).toString();
  const receiptIdempotencyKey = "quoteflow-receipt-" + checkout.id;
  const kind = isProduction ? "payment_receipt" : "isolated_preview_test";
  const mail: MailPayload = {
    from: process.env.QUOTE_EMAIL_FROM?.trim() || "QuoteFlow <orders@allsetintl.com>",
    to: [recipient],
    subject: (isProduction ? "QuoteFlow payment confirmed" : "QuoteFlow Preview payment confirmed") + " [" + fingerprint.slice(0,12) + "]",
    text: (isProduction ? "Your QuoteFlow payment has been confirmed." : "QuoteFlow isolated test payment confirmed. No live charge was made.") +
      "\n\nOpen your secure quotation download page: " + recoveryUrl.toString() +
      "\n\nAfter your payment is verified, use Download PDF or Download Excel. This private recovery credential must not be forwarded. Saved quotations expire after 90 days.\n\nby ALLSET.co"
  };

  try {
    const sql = await verifiedDatabase(databaseUrl);
    // A single SQL statement makes event deduplication and order upsert atomic.
    // Paid is terminal here: a late failure event cannot undo a confirmed payment.
    const queued = await sql`
      WITH event_insert AS (
        INSERT INTO quoteflow_processed_events
          (stripe_event_id, stripe_session_id, event_type)
        VALUES (${event.id}, ${checkout.id}, ${event.type})
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING stripe_event_id
      )
      , order_upsert AS (
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
      RETURNING stripe_session_id, payment_status
      ), delivery_outbox AS (
        INSERT INTO quoteflow_email_deliveries (stripe_session_id,email_kind,recipient_email,idempotency_key,payload,payload_hash)
        SELECT ${checkout.id},${kind},${recipient},${createHash("sha256").update(receiptIdempotencyKey).digest("hex")},${JSON.stringify(mail)}::jsonb,${payloadHash(mail)}
        FROM (SELECT stripe_session_id,payment_status FROM order_upsert
              UNION ALL SELECT stripe_session_id,payment_status FROM quoteflow_orders
              WHERE stripe_session_id=${checkout.id} AND NOT EXISTS(SELECT 1 FROM order_upsert)) o
        WHERE ${paid} AND o.payment_status='paid'
          AND EXISTS(SELECT 1 FROM quoteflow_quote_snapshots WHERE fingerprint=${fingerprint} AND expires_at>now())
        ON CONFLICT(stripe_session_id,email_kind) DO NOTHING RETURNING id
      ) SELECT id FROM delivery_outbox
        UNION ALL SELECT id FROM quoteflow_email_deliveries WHERE stripe_session_id=${checkout.id} AND email_kind=${kind} LIMIT 1
    `;
    if (paid && queued.length !== 1) throw new Error("Paid quotation snapshot unavailable for delivery");
  } catch (error) {
    console.error("QuoteFlow webhook: order persistence failed", {
      eventId: event.id, message: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ error: "Order storage failed" }, { status: 503 });
  }
  return NextResponse.json({ received: true, ...(paid ? { deliveryQueued: true } : {}) }, { headers: { "Cache-Control": "no-store" } });
}

