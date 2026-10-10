import EmbeddedPostgres from "embedded-postgres";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Stripe from "stripe";
import { Pool } from "pg";
import chromium from "@sparticuz/chromium";
export default async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "quoteflow-test-"));
  const postgres = new EmbeddedPostgres({
    databaseDir: join(dir, "pg"),
    user: "qf_test",
    password: "local_test_only",
    port: 55436,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("quoteflow_test");
  const dbUrl =
    "postgresql://qf_test:local_test_only@localhost:55436/quoteflow_test";
  process.env.QF_TEST_DATABASE_URL = dbUrl;
  const db = new Pool({ connectionString: dbUrl });
  await db.query(await readFile("db/001_jobs.sql", "utf8"));
  await db.end();
  const appOrigin = "http://localhost:3100",
    mockOrigin = "http://localhost:3101",
    secret = "whsec_local_testing_only";
  let restart: () => Promise<void>;
  const stripe = new Stripe("sk_test_local_testing_only");
  const mock = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, mockOrigin);
      if (url.pathname === "/restart" && req.method === "POST") {
        await restart();
        res.end("restarted");
        return;
      }
      const job = url.searchParams.get("job")!;
      if (url.pathname === "/checkout") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          `<h1>Local Stripe Checkout simulator</h1><a href="/pay?job=${job}">Complete test payment</a><a href="${appOrigin}/checkout/cancel?job=${job}">Cancel payment</a>`,
        );
        return;
      }
      if (url.pathname === "/pay") {
        const session = {
          id: `cs_test_${job}`,
          object: "checkout.session",
          livemode: false,
          mode: "payment",
          payment_status: "paid",
          metadata: { job_id: job, product: "QuoteFlow" },
          client_reference_id: job,
          amount_total: 2900,
          currency: "usd",
        };
        const payload = JSON.stringify({
          id: `evt_test_${job}`,
          object: "event",
          type: "checkout.session.completed",
          livemode: false,
          data: { object: { ...session, payment_status: "paid" } },
        });
        const signature = stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
        });
        const r = await fetch(`${appOrigin}/api/webhooks/stripe`, {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: payload,
        });
        if (!r.ok) {
          res.statusCode = 500;
          res.end(await r.text());
          return;
        }
        res.writeHead(302, {
          Location: `${appOrigin}/checkout/success?job=${job}`,
        });
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end();
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });
  await new Promise<void>((r) => mock.listen(3101, "127.0.0.1", r));
  const startApp = () =>
    spawn(
      process.execPath,
      [
        "--require",
        resolve("tests/stripe-mock.cjs"),
        "node_modules/next/dist/bin/next",
        "start",
        "-p",
        "3100",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
          SITE_URL: appOrigin,
          STRIPE_SECRET_KEY: "sk_test_local_testing_only",
          STRIPE_WEBHOOK_SECRET: secret,
          QUOTE_EXPORT_AMOUNT: "2900",
          QUOTE_EXPORT_CURRENCY: "usd",
          MOCK_PAYMENT_ORIGIN: mockOrigin,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  let output = "";
  let app = startApp();
  function attach() {
    app.stdout?.on("data", (x) => (output += x));
    app.stderr?.on("data", (x) => (output += x));
  }
  attach();
  async function ready() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (app.exitCode !== null) throw Error(output);
      try {
        const r = await fetch(appOrigin);
        if (r.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw Error("Local app did not start: " + output);
  }
  restart = async () => {
    const stopped = new Promise<void>((r) => app.once("exit", () => r()));
    app.kill("SIGTERM");
    await stopped;
    app = startApp();
    attach();
    await ready();
  };
  const teardown = async () => {
    app.kill("SIGTERM");
    await new Promise<void>((r) => mock.close(() => r()));
    await postgres.stop();
    await rm(dir, { recursive: true, force: true });
  };
  try {
    await ready();
    process.env.QF_TEST_CHROMIUM = await chromium.executablePath();
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
