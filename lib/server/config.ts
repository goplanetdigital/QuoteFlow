export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function applicationOrigin(env: Readonly<Record<string, string | undefined>> = process.env) {
  try {
    if (env.VERCEL === "1" && !env.SITE_URL) throw new Error();
    const site = new URL(env.SITE_URL ?? "http://localhost:3000");
    if ((site.protocol !== "https:" && !(site.protocol === "http:" && site.hostname === "localhost")) || site.username || site.password || site.pathname !== "/" || site.search || site.hash) throw new Error();
    return site.origin;
  } catch { throw new AppError(503, "The application URL is not configured."); }
}
export function paymentConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  const key = env.STRIPE_SECRET_KEY ?? "";
  const amount = Number(env.QUOTE_EXPORT_AMOUNT);
  const currency = (env.QUOTE_EXPORT_CURRENCY ?? "").toLowerCase();
  const origin = applicationOrigin(env);
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
  return { key, amount, currency, origin };
}
