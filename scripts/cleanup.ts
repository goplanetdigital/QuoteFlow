import { database } from "../lib/server/store";
async function main() {
  const db = database();
  try {
    const result = await db.query(
      "DELETE FROM qf_jobs WHERE created_at < now() - interval '7 days'",
    );
    console.log(
      `Removed ${result.rowCount} expired QuoteFlow jobs and associated files.`,
    );
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error(
    "Cleanup failed. Check the dedicated QuoteFlow database connection.",
  );
  process.exitCode = 1;
});
