import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/setup.ts",
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
    launchOptions: {
      args: chromium.args.filter(
        (arg) => arg !== "--disable-web-security" && arg !== "--single-process",
      ),
      executablePath: process.env.QF_TEST_CHROMIUM || "/tmp/chromium",
      env: { ...process.env, XDG_CACHE_HOME: "/tmp/quoteflow-browser-cache" },
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
