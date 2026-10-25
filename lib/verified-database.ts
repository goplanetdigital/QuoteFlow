import { neon } from "@neondatabase/serverless";

const HOST = "ep-withered-glitter-ao41bqx3.c-2.ap-southeast-1.aws.neon.tech";
export const PREVIEW_BRANCH = "br-summer-term-aonsnvyi";
export const PREVIEW_PROJECT = "solitary-fog-81429256";

/** Check the endpoint before connecting, then attest the actual database session.
 * Never trust a manually configured isolation flag as proof of isolation.
 * Neon HTTP uses HTTPS; this is not a native PostgreSQL TLS attestation.
 */
export async function verifiedDatabase(raw: string) {
  if (process.env.VERCEL_ENV === "preview") {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        ![HOST, HOST.replace('.c-2.', '-pooler.c-2.')].includes(url.hostname) ||
        url.pathname !== '/neondb' || url.username !== 'neondb_owner') {
      throw new Error('PREVIEW_ENDPOINT_OR_IDENTITY_MISMATCH');
    }
  }
  const sql = neon(raw);
  if (process.env.VERCEL_ENV === "preview") {
    const rows = await sql`SELECT current_setting('neon.branch_id',true) AS branch_id,
      current_setting('neon.project_id',true) AS project_id,
      current_database() AS database, current_user AS role`;
    if (rows.length !== 1 || rows[0].branch_id !== PREVIEW_BRANCH ||
        rows[0].project_id !== PREVIEW_PROJECT || rows[0].database !== 'neondb' ||
        rows[0].role !== 'neondb_owner') throw new Error('PREVIEW_DATABASE_IDENTITY_MISMATCH');
  }
  return sql;
}
