// Resume only unfinished/newly changed checks against an existing paid Test order.
// Does not create a payment, replay a webhook, or send another email.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import * as XLSX from 'xlsx';
assert.equal(process.env.VERCEL_ENV,'preview');
assert.equal(process.env.VERCEL_PROJECT_ID,'prj_MbjZemw47Dz4UoyloYnMIdNvMQgp');
assert.match(process.env.STRIPE_SECRET_KEY??'',/^(sk|rk)_test_/);
assert.equal(process.env.QUOTEFLOW_TEST_EMAIL_ALLOWLIST,'jcaiworker@gmail.com');
const base=new URL(process.env.QUOTEFLOW_ACCEPTANCE_URL);
assert.match(base.hostname,/^quote-flow-[a-z0-9]+-go-planet-digital\.vercel\.app$/);
const id=Number(process.env.QUOTEFLOW_ACCEPTANCE_JOB_ID);
assert.ok(Number.isSafeInteger(id)&&id>0);
const sql=neon(process.env.DATABASE_URL);
const [identity]=await sql`SELECT current_setting('neon.branch_id',true) AS branch_id,current_setting('neon.project_id',true) AS project_id`;
assert.equal(identity.branch_id,'br-summer-term-aonsnvyi');assert.equal(identity.project_id,'solitary-fog-81429256');
const [job]=await sql`SELECT * FROM quoteflow_email_deliveries WHERE id=${id}`;
assert.ok(job);assert.equal(job.email_kind,'isolated_preview_test');assert.equal(job.recipient_email,'jcaiworker@gmail.com');
assert.equal(job.status,'SENT');assert.match(job.stripe_session_id,/^cs_test_/);assert.ok(job.provider_message_id);
const log=(check,evidence)=>console.log(JSON.stringify({acceptance:check,...evidence}));
async function post(path,body,worker=false){
 const r=await fetch(new URL(path,base),{method:'POST',headers:{'Content-Type':'application/json',
  'x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN,
  ...(worker?{Authorization:'Bearer '+process.env.QUOTEFLOW_PREVIEW_WORKER_SECRET}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 return {r,data:await r.json()};
}
const dry=await post('/api/preview-email-dispatch',{id,action:'reconcile'},true);
assert.equal(dry.r.status,200);assert.equal(dry.data.dryRun,true);
const [unchanged]=await sql`SELECT attempts,provider_checked_at FROM quoteflow_email_deliveries WHERE id=${id}`;
assert.equal(unchanged.attempts,job.attempts);assert.equal(String(unchanged.provider_checked_at),String(job.provider_checked_at));
log('reconcile default dry-run',{status:dry.r.status,noMutation:true,jobId:id});
const receipt=await post('/api/preview-email-dispatch',{id,action:'reconcile',dryRun:false},true);
log('provider receipt reconciliation',{status:receipt.r.status,providerStatus:receipt.data.providerStatus,providerError:receipt.data.providerError,delivered:receipt.data.delivered});
const link=job.payload.text.match(/https:\/\/\S+/)?.[0];assert.ok(link);
const recovery=new URL(link);assert.match(recovery.hostname,/^quote-flow-[a-z0-9-]+-go-planet-digital\.vercel\.app$/);
assert.equal(new URLSearchParams(recovery.hash.slice(1)).get('recover_session'),job.stripe_session_id);
recovery.hash='';
const page=await fetch(recovery,{headers:{'x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN},signal:AbortSignal.timeout(20000)});
assert.equal(page.status,200);log('actual emailed recovery origin',{status:page.status,origin:recovery.origin,credentialOnlyInFragment:true});
const capability=await post('/api/deliver-quotation',{sessionId:job.stripe_session_id,format:'xlsx',issueToken:true});
assert.equal(capability.r.status,200);
const exported=await fetch(new URL('/api/deliver-quotation',base),{method:'POST',headers:{'Content-Type':'application/json','x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN},
 body:JSON.stringify({sessionId:job.stripe_session_id,format:'xlsx',token:capability.data.token}),signal:AbortSignal.timeout(20000)});
const bytes=Buffer.from(await exported.arrayBuffer());assert.equal(exported.status,200);
const workbook=XLSX.read(bytes,{type:'buffer'});assert.ok(workbook.SheetNames.length>0);
const cells=JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1}));
assert.ok(cells.includes('CBL-2C-1.5'));assert.ok(cells.includes('SW-20A'));assert.ok(cells.includes('247.2'));
log('patched SheetJS existing paid Test XLSX',{status:exported.status,version:XLSX.version,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),originalItemsAndTotal:true});
if(receipt.r.status!==200||receipt.data.delivered!==true){log('BLOCKED',{jobId:id,reason:'Provider delivered receipt not verified',providerStatus:receipt.data.providerStatus,providerError:receipt.data.providerError});process.exitCode=1;}
