import { NextResponse } from "next/server";
import { verifiedDatabase } from "../../../lib/verified-database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"no-store"};
export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({error:"Not found"},{status:404,headers});
  if (!process.env.DATABASE_URL) return NextResponse.json({isolated:false,reason:"missing_connection"},{status:503,headers});
  try {
    await verifiedDatabase(process.env.DATABASE_URL);
    return NextResponse.json({isolated:true,readOnly:true,checks:{project:true,branch:true,database:true,role:true},
      transport:"neon-https",postgresTlsVerified:false},{headers});
  } catch {
    return NextResponse.json({isolated:false,reason:"preview_database_verification_failed"},{status:503,headers});
  }
}
