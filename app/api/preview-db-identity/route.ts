import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only, Preview-only identity attestation. Never expose database
// credentials, hostname, branch metadata, or query results.
export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({error:"Not found"},{status:404});
  if (!process.env.DATABASE_URL) return NextResponse.json({isolated:false,reason:"missing_connection"},{status:503});
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT current_setting('neon.branch_id',true) AS branch_id,
      current_setting('neon.project_id',true) AS project_id,
      current_database() AS db_name, current_user AS db_role`;
    const identity = rows[0];
    const isolated = identity?.branch_id === "br-summer-term-aonsnvyi" &&
      identity?.project_id === "solitary-fog-81429256" &&
      identity?.db_name === "neondb" && identity?.db_role === "neondb_owner";
    return NextResponse.json({isolated,readOnly:true,checks:{project:identity?.project_id === "solitary-fog-81429256",branch:identity?.branch_id === "br-summer-term-aonsnvyi",database:identity?.db_name === "neondb",role:identity?.db_role === "neondb_owner"}},{status:isolated?200:503,headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({isolated:false,reason:"connection_failed"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
