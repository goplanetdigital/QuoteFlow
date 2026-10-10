import { test, expect, Page, Frame, APIRequestContext } from "@playwright/test";
import { readSheet } from "read-excel-file/node";
const origin = new URL(process.env.QF_PREVIEW_URL!).origin;
const branch = "codex/issue-6-checkout-delivery";
const oidc = process.env.QF_PREVIEW_OIDC_TOKEN || process.env.VERCEL_OIDC_TOKEN;
const headers: Record<string, string> = oidc ? { "x-vercel-trusted-oidc-idp-token": oidc } : {};
const rfq = "code,description,quantity,unit\nPREVIEW-A,Synthetic cable,2,m";
async function previewGet(api: APIRequestContext, path: string) {
  try { return await api.get(`${origin}${path}`, { headers }); }
  catch { throw new Error("Preview request failed. Check automation access; credential-bearing request logs are suppressed."); }
}
const catalogue = "code,description,unit,price\nPREVIEW-A,Synthetic cable,m,12.4";

async function fillCardField(page: Page, selectors: string, value: string) {
  let field: import("@playwright/test").Locator | undefined;
  await expect.poll(async () => {
    for (const frame of [page, ...page.frames()] as (Page | Frame)[]) {
      const candidate = frame.locator(selectors).first();
      if (await candidate.isVisible().catch(() => false)) { field = candidate; return true; }
    }
    return false;
  }, { timeout: 30000, message: "Stripe test card field must be available; CAPTCHA or changed Checkout UI needs review" }).toBe(true);
  await field!.fill(value);
}

test("REAL Preview: customer uploads → approved catalogue price → Stripe test card → verified webhook → private Excel", async ({ page, context, request }) => {
  const ready = await previewGet(request, "/api/readiness");
  expect(ready.status(), "Preview configuration/database/protection must be ready; this test never substitutes a simulator").toBe(200);
  const report = await ready.json();
  expect(report.environment).toBe("preview"); expect(report.branch).toBe(branch); expect(report.paymentMode).toBe("test"); expect(report.ready).toBe(true);
  // Scope protection credentials to QuoteFlow only; never forward them to Stripe.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const h = { ...route.request().headers() };
    delete h["x-vercel-trusted-oidc-idp-token"];
    if (url.origin === origin && oidc) h["x-vercel-trusted-oidc-idp-token"] = oidc;
    await route.continue({ headers: h });
  });
  await page.goto(origin);
  await page.locator("input[type=file]").nth(0).setInputFiles({ name: "synthetic-preview-catalogue.csv", mimeType: "text/csv", buffer: Buffer.from(catalogue) });
  await expect(page.getByText(/Loaded 1 catalogue item/)).toBeVisible();
  await page.locator("input[type=file]").nth(1).setInputFiles({ name: "synthetic-preview-rfq.csv", mimeType: "text/csv", buffer: Buffer.from(rfq) });
  await expect(page.getByText(/Loaded 1 RFQ line/)).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Review saved quotation/ }).click();
  await expect(page).toHaveURL(/\/jobs\/[a-f0-9-]+$/);
  const id = page.url().split("/").pop()!;
  expect((await previewGet(context.request, `/api/jobs/${id}/result?format=xlsx`)).status()).toBe(402);
  await page.getByRole("button", { name: /Pay .* in test mode/ }).click();
  await expect.poll(() => new URL(page.url()).hostname).toBe("checkout.stripe.com");
  expect(page.url().includes("cs_test_"), "Refuse to fill card fields unless Checkout is a test session").toBe(true);
  const email = page.locator('input[type="email"]').first();
  if (await email.isVisible()) await email.fill("quoteflow-preview@example.com");
  await fillCardField(page, 'input[name="cardNumber"], input[name="number"], input[autocomplete="cc-number"]', "4242424242424242");
  await fillCardField(page, 'input[name="cardExpiry"], input[name="exp-date"], input[autocomplete="cc-exp"]', "1230");
  await fillCardField(page, 'input[name="cardCvc"], input[name="cvc"], input[autocomplete="cc-csc"]', "123");
  const name = page.locator('input[name="billingName"], input[autocomplete="cc-name"]').first();
  if (await name.isVisible()) await name.fill("QuoteFlow Synthetic Preview");
  const postal = page.locator('input[name="billingPostalCode"], input[autocomplete="postal-code"]').first();
  if (await postal.isVisible()) await postal.fill("10001");
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("link", { name: "Download Excel" })).toBeVisible({ timeout: 120000 });
  const excel = await previewGet(context.request, `/api/jobs/${id}/result?format=xlsx`);
  expect(excel.status()).toBe(200); expect(excel.headers()["cache-control"]).toBe("private, no-store");
  const rows = await readSheet(await excel.body(), "Quotation");
  expect(rows.some(row => row[0] === "Approved subtotal" && row[1] === 24.8)).toBe(true);
  expect((await readSheet(await excel.body(), "Review audit")).length).toBe(2);
  const cookie = (await context.cookies()).find(c => c.name === `qf_job_${id}`)!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.secure).toBe(true);
  // This request fixture has no customer cookie, only project protection access.
  expect((await previewGet(request, `/api/jobs/${id}/result?format=xlsx`)).status()).toBe(404);
});
