import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";
const url = process.env.QF_PREVIEW_URL;
if (!url || new URL(url).protocol !== "https:" || new URL(url).pathname !== "/" || new URL(url).username || new URL(url).password || new URL(url).search || new URL(url).hash) throw new Error("Set QF_PREVIEW_URL to the exact HTTPS QuoteFlow Preview origin. Hosted tests are blocked without it.");
export default defineConfig({
  testDir: "./tests/preview", workers: 1, retries: 0, timeout: 180000, reporter: "list",
  use: {
    baseURL: new URL(url).origin, headless: true,
    // No traces, HAR or failure screenshots that might capture protection tokens.
    trace: "off", screenshot: "off", video: "off", serviceWorkers: "block",
    launchOptions: { args: chromium.args.filter(arg => arg !== "--disable-web-security" && arg !== "--single-process"), executablePath: process.env.QF_TEST_CHROMIUM || "/tmp/chromium", env: { ...process.env, XDG_CACHE_HOME: "/tmp/quoteflow-browser-cache" } },
  },
});
