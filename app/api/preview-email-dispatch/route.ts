import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { claimDelivery, markSent, markFailed, quarantineExpiredLeases, isolatedOutbox } from "../../../lib/isolated-email-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.QUOTEFLOW_PREVIEW_WORKER_SECRET;
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
  if (!secret || secret.length < 32 || !token) return false;
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({error:"Not found"},{status:404});
  if (!authorized(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
  if (process.env.QUOTEFLOW_ISOLATED_OUTBOX_ENABLED !== "true")
    return NextResponse.json({error:"Worker disabled"},{status:503});
  if (process.env.QUOTEFLOW_ISOLATED_DATABASE_VERIFIED !== "true")
    return NextResponse.json({error:"Database isolation unverified"},{status:503});
  const allowed = (process.env.QUOTEFLOW_TEST_EMAIL_ALLOWLIST || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if (allowed.length !== 1 || allowed[0] !== "jcaiworker@gmail.com")
    return NextResponse.json({error:"Recipient policy invalid"},{status:503});
  if (!process.env.RESEND_API_KEY) return NextResponse.json({error:"Provider unavailable"},{status:503});
  let payload: {id?:number; dryRun?:boolean};
  try { payload = await request.json(); } catch { return NextResponse.json({error:"Invalid JSON"},{status:400}); }
  if (!Number.isSafeInteger(payload.id) || !payload.id || payload.id < 1)
    return NextResponse.json({error:"Invalid id"},{status:400});
  try {
    await quarantineExpiredLeases();
    const sql = await isolatedOutbox();
    const rows = await sql`SELECT id, recipient_email, status, email_kind FROM quoteflow_email_deliveries WHERE id = ${payload.id}`;
    const record = rows[0];
    if (!record) return NextResponse.json({error:"Not found"},{status:404});
    if (record.recipient_email !== "jcaiworker@gmail.com" || record.email_kind !== "isolated_preview_test")
      return NextResponse.json({error:"Forbidden recipient or job kind"},{status:403});
    if (payload.dryRun !== false) return NextResponse.json({eligible:record.status === "PENDING",dryRun:true});
    const job = await claimDelivery(payload.id);
    if (!job) return NextResponse.json({error:"Not claimable"},{status:409});
    // The provider request has a network ambiguity window. Any error after
    // initiating it is quarantined, never automatically resent.
    let attempted = false;
    try {
      attempted = true;
      const response = await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{"Authorization":`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":String(job.idempotency_key)},
        body:JSON.stringify({from:"orders@allsetintl.com",to:["jcaiworker@gmail.com"],subject:"QuoteFlow isolated Preview delivery test",text:"QuoteFlow Preview isolated outbox test. No purchase or customer order was used."})
      });
      const body = await response.json().catch(()=>({})) as {id?:string;message?:string};
      if (response.ok && body.id) {
        const updated = await markSent(Number(job.id),String(job.idempotency_key),body.id);
        return NextResponse.json({providerStatus:response.status,messageId:body.id,updated:updated.length===1},{status:updated.length===1?200:503});
      }
      // Provider errors can be ambiguous; quarantine rather than retry.
      await markFailed(Number(job.id),String(job.idempotency_key),"PROVIDER_OUTCOME_UNKNOWN");
      return NextResponse.json({providerStatus:response.status,error:"Provider result not confirmed"},{status:502});
    } catch {
      if (attempted) await markFailed(Number(job.id),String(job.idempotency_key),"PROVIDER_OUTCOME_UNKNOWN");
      return NextResponse.json({error:"Provider outcome unknown; manual reconciliation required"},{status:503});
    }
  } catch {
    return NextResponse.json({error:"Isolated worker unavailable"},{status:503});
  }
}
