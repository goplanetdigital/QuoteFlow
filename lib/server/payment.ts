import Stripe from "stripe";
import { AppError, paymentConfig } from "./config";
import { generateDelivery } from "./delivery";
import { Job, Store, store } from "./store";
export function stripeClient() {
  return new Stripe(paymentConfig().key, {
    maxNetworkRetries: 2,
    timeout: 15000,
  });
}
export function requireOwner(job: Job, hash: string) {
  if (!hash || job.owner_hash !== hash)
    throw new AppError(404, "Quotation job not found in this browser.");
}
export async function beginCheckout(
  id: string,
  hash: string,
  create: (job: Job) => Promise<Stripe.Checkout.Session>,
  db: Store = store,
) {
  return db.transaction(id, async (tx) => {
    const job = tx.job;
    requireOwner(job, hash);
    if (job.state === "ready" || job.state === "processing")
      throw new AppError(409, "This payment is pending or complete. Refresh the job status.");
    if (job.state === "payment_failed")
      throw new AppError(
        409,
        "Payment failed. Create a new quotation job from the workspace before retrying.",
      );
    if (job.session_id) {
      if (
        job.state === "expired" ||
        Number(job.session_expires) <= Math.floor(Date.now() / 1000)
      )
        throw new AppError(
          409,
          "Checkout expired. Return to the workspace and create a new quotation job.",
        );
      if (!job.checkout_url)
        throw new AppError(
          409,
          "Payment verification is pending. Refresh this job status.",
        );
      return job.checkout_url;
    }
    // Stripe retains idempotency keys for at least 24h. Bound first/retry attempts
    // to the job's first 20h so an interrupted response cannot cause a later duplicate charge.
    if (job.created_at && Date.now() - job.created_at.getTime() > 20 * 60 * 60 * 1000)
      throw new AppError(409, "This unpaid job expired. Create a new quotation from the workspace.");
    const session = await create(job);
    if (session.livemode || !session.url)
      throw new AppError(503, "Test checkout is unavailable.");
    job.session_id = session.id;
    job.checkout_url = session.url;
    job.session_expires = String(session.expires_at);
    await tx.save();
    return session.url;
  });
}
export function createStripeSession(job: Job) {
  const config = paymentConfig();
  return stripeClient().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: job.id,
      metadata: { job_id: job.id, product: "QuoteFlow" },
      line_items: [
        {
          price_data: {
            currency: job.currency,
            unit_amount: job.amount,
            product_data: {
              name: "QuoteFlow — one reviewed quotation export (test mode)",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${config.origin}/checkout/success?job=${job.id}`,
      cancel_url: `${config.origin}/checkout/cancel?job=${job.id}`,
    },
    { idempotencyKey: `quoteflow-checkout-${job.id}` },
  );
}
export const paymentEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
export async function processPayment(
  event: Stripe.Event,
  db: Store = store,
  deliver = generateDelivery,
) {
  if (!paymentEvents.has(event.type)) return;
  if (event.livemode)
    throw new AppError(400, "Only test-mode events are accepted.");
  const session = event.data.object as Stripe.Checkout.Session;
  const id = session.metadata?.job_id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    throw new AppError(400, "Missing quotation job association.");
  await db.transaction(id, async (tx) => {
    const job = tx.job;
    if (await tx.hasEvent(event.id)) return;
    if (
      session.livemode ||
      (job.session_id !== null && session.id !== job.session_id) ||
      session.client_reference_id !== job.id ||
      session.metadata?.product !== "QuoteFlow" ||
      session.mode !== "payment" ||
      session.amount_total !== job.amount ||
      session.currency !== job.currency
    )
      throw new AppError(400, "Payment does not match this quotation job.");
    // A valid signed event can repair the association if Checkout succeeded but
    // the response/DB commit was interrupted. All immutable payment fields were verified above.
    if (job.session_id === null) job.session_id = session.id;
    if (job.state !== "ready") {
      if (
        (event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded") &&
        session.payment_status === "paid"
      ) {
        job.state = "processing";
        const files = deliver(job.snapshot);
        job.excel = files.excel;
        job.printable = files.printable;
        job.state = "ready";
      } else if (
        event.type === "checkout.session.completed" &&
        job.state === "awaiting_payment"
      )
        job.state = "processing";
      else if (event.type === "checkout.session.async_payment_failed")
        job.state = "payment_failed";
      else if (event.type === "checkout.session.expired") job.state = "expired";
    }
    await tx.save();
    await tx.recordEvent(event.id);
  });
}
