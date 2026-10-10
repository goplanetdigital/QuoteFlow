import { readFile } from "node:fs/promises";
import { database } from "../lib/server/store";
async function main() {
  const db = database();
  try {
    await db.query(await readFile("db/001_jobs.sql", "utf8"));
    console.log("QuoteFlow schema ready.");
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error(
    "Migration failed. Check the database connection and permissions.",
  );
  process.exitCode = 1;
});
