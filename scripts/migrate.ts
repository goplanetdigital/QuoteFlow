import { migrate } from "../lib/server/migrations";
import { database } from "../lib/server/store";
async function main() {
  const db = database();
  try {
    await migrate(db);
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
