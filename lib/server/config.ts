export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function paymentConfig() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const amount = Number(process.env.QUOTE_EXPORT_AMOUNT);
  const currency = (process.env.QUOTE_EXPORT_CURRENCY ?? "").toLowerCase();
  const site = new URL(process.env.SITE_URL ?? "http://localhost:3000");
  if (
    !key.startsWith("sk_test_") ||
    !Number.isSafeInteger(amount) ||
    amount < 50 ||
    amount > 1000000 ||
    !["usd", "myr", "sgd", "eur", "gbp"].includes(currency)
  ) {
    throw new AppError(
      503,
      "Test payments are not configured. Please contact support.",
    );
  }
  if (
    (site.protocol !== "https:" &&
      !(site.protocol === "http:" && site.hostname === "localhost")) ||
    site.username ||
    site.password
  ) {
    throw new AppError(503, "The application URL is not configured.");
  }
  return { key, amount, currency, origin: site.origin };
}
