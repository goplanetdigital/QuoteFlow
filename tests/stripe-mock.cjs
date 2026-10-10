// Loaded only by the local test server, never by production application code.
const nock = require("nock");
nock.disableNetConnect();
nock.enableNetConnect((host) => /^(localhost|127\.0\.0\.1)/.test(host));
nock("https://api.stripe.com")
  .persist()
  .post("/v1/checkout/sessions")
  .reply(function (uri, body) {
    const values =
      typeof body === "string"
        ? new URLSearchParams(body)
        : new URLSearchParams(body);
    const job = values.get("metadata[job_id]");
    const amount = Number(values.get("line_items[0][price_data][unit_amount]"));
    const currency = values.get("line_items[0][price_data][currency]");
    if (
      !job ||
      amount !== 2900 ||
      currency !== "usd" ||
      values.get("mode") !== "payment"
    )
      return [400, { error: { message: "Incorrect Checkout payload" } }];
    const session = {
      id: `cs_test_${job}`,
      object: "checkout.session",
      livemode: false,
      mode: "payment",
      payment_status: "unpaid",
      metadata: { job_id: job, product: "QuoteFlow" },
      client_reference_id: job,
      amount_total: amount,
      currency,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      url: `${process.env.MOCK_PAYMENT_ORIGIN}/checkout?job=${job}`,
    };
    return [200, session];
  });
// Stripe 18 waits for TLS secureConnect before sending a body. Nock supplies a
// virtual socket; mark only that intercepted API socket ready for the SDK.
const https = require("node:https");
const mockedRequest = https.request;
https.request = function (options, ...args) {
  const request = mockedRequest.call(this, options, ...args);
  if (options.host === "api.stripe.com")
    request.prependOnceListener("socket", (socket) =>
      Object.defineProperty(socket, "connecting", {
        value: false,
        configurable: true,
      }),
    );
  return request;
};
