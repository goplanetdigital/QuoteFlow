import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

export async function migrate(db: Pool) {
  const c = await db.connect();
  try {
    // Keep the dedicated migration connection for the session-level lock.
    await c.query("SELECT pg_advisory_lock(716006, 2)");
    const files = (await readdir("db")).filter(name => /^\d{3}_[a-z_]+\.sql$/.test(name)).sort();
    for (const file of files) await c.query(await readFile(`db/${file}`, "utf8"));
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    try { await c.query("SELECT pg_advisory_unlock(716006, 2)"); } finally { c.release(); }
  }
}
