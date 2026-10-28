// Explicit trusted Preview-only acceptance. Never part of normal build.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
assert.equal(process.env.VERCEL_ENV,'preview');
assert.equal(process.env.VERCEL_PROJECT_ID,'prj_MbjZemw47Dz4UoyloYnMIdNvMQgp');
assert.match(process.env.STRIPE_SECRET_KEY??'',/^(sk|rk)_test_/);
assert.equal(process.env.QUOTEFLOW_TEST_EMAIL_ALLOWLIST,'jcaiworker@gmail.com');
assert.equal(process.env.QUOTEFLOW_ISOLATED_OUTBOX_ENABLED,'true');
const base=new URL(process.env.QUOTEFLOW_ACCEPTANCE_URL);
assert.match(base.hostname,/^quote-flow-[a-z0-9]+-go-planet-digital\.vercel\.app$/);
const sql=neon(process.env.DATABASE_URL);
const [identity]=await sql`SELECT current_setting('neon.branch_id',true) AS branch_id,current_setting('neon.project_id',true) AS project_id`;
assert.equal(identity.branch_id,'br-summer-term-aonsnvyi');assert.equal(identity.project_id,'solitary-fog-81429256');
const run=randomUUID().slice(0,8),recipient='jcaiworker@gmail.com';
const log=(check,evidence)=>console.log(JSON.stringify({acceptance:check,...evidence}));
async function app(path,body,worker=false){
 const headers={'Content-Type':'application/json','x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN};
 if(worker)headers.Authorization='Bearer '+process.env.QUOTEFLOW_PREVIEW_WORKER_SECRET;
 const r=await fetch(new URL(path,base),{method:'POST',headers,body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
 const data=await r.json();log('HTTP',{path,status:r.status,error:data.error,providerStatus:data.providerStatus});return {r,data};
}
async function stripe(path,method='GET',params){
 const r=await fetch('https://api.stripe.com'+path,{method,headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,
  ...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(params?{body:new URLSearchParams(params).toString()}:{})});
 const data=await r.json();log('Stripe Test API',{path:path.replace(/cs_test_[A-Za-z0-9]+/g,'[test-session]'),status:r.status,errorType:data.error?.type,errorCode:data.error?.code});
 assert.ok(r.ok,'Stripe Test operation failed');assert.notEqual(data.livemode,true);return data;
}
const payload=JSON.stringify({rfqLines:[
 {id:'1',code:'CBL-2C-1.5',description:'2 Core Cable 1.5mm',quantity:120,unit:'m'},
 {id:'2',code:'SW-20A',description:'20A Double Pole Switch',quantity:12,unit:'pcs'}],catalogue:[
 {code:'CBL-2C-1.5',description:'2 Core Cable 1.5mm',unit:'m',approvedUnitPrice:0.82},
 {code:'SW-20A',description:'20A Double Pole Switch',unit:'pcs',approvedUnitPrice:12.4}],
 meta:{supplierName:'ALLSET INTERNAL TEST',customerName:'OWNED PREVIEW TEST',quoteNumber:'PREVIEW-'+run,currency:'MYR',validDays:'30',notes:'Isolated test fixture; existing demo catalogue prices'},sourceName:'existing-demo-catalogue'});
const fingerprint=createHash('sha256').update(payload).digest('hex');
let sessionId,event,jobId;
let failure;
try{
 const checkout=await app('/api/checkout',{payload});assert.equal(checkout.r.status,200);
 const checkoutUrl=new URL(checkout.data.url);sessionId=checkoutUrl.pathname.split('/').pop();assert.match(sessionId,/^cs_test_/);
 const session=await stripe('/v1/checkout/sessions/'+sessionId);assert.equal(session.metadata.fingerprint,fingerprint);
 // Follow the official stripe-cli checkout.session.completed fixture using tok_visa.
 await stripe('/v1/payment_pages/'+sessionId);
 const method=await stripe('/v1/payment_methods','POST',{type:'card','card[token]':'tok_visa','billing_details[email]':recipient,'billing_details[name]':'ALLSET Preview Test',
  'billing_details[address][line1]':'354 Oyster Point Blvd','billing_details[address][postal_code]':'94080','billing_details[address][city]':'South San Francisco',
  'billing_details[address][state]':'CA','billing_details[address][country]':'US'});
 await stripe('/v1/payment_pages/'+sessionId+'/confirm','POST',{payment_method:method.id,expected_amount:String(session.amount_total)});
 const paid=await stripe('/v1/checkout/sessions/'+sessionId);assert.equal(paid.status,'complete');assert.equal(paid.payment_status,'paid');assert.equal(paid.livemode,false);
 assert.equal(paid.customer_details?.email??paid.customer_email,recipient);
 log('real Stripe Test payment completed',{sessionSuffix:sessionId.slice(-8),livemode:false,amount:paid.amount_total,currency:paid.currency});
 for(let i=0;i<6&&!event;i++){
  const events=await stripe('/v1/events?type=checkout.session.completed&limit=30');event=events.data?.find(e=>e.data.object.id===sessionId);
  if(!event)await new Promise(resolve=>setTimeout(resolve,1500));
 }
 assert.ok(event,'Actual Stripe Test completion event missing');
 async function webhook(){
  const raw=JSON.stringify(event),stamp=Math.floor(Date.now()/1000),digest=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(stamp+'.'+raw).digest('hex');
  const r=await fetch(new URL('/api/stripe-webhook',base),{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'t='+stamp+',v1='+digest,
   'x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN},body:raw});const data=await r.json();log('actual Test event replay',{status:r.status,queued:data.deliveryQueued,error:data.error});
  assert.equal(r.status,200);assert.equal(data.deliveryQueued,true);
 }
 await webhook();await webhook();
 const jobs=await sql`SELECT * FROM quoteflow_email_deliveries WHERE stripe_session_id=${sessionId} AND email_kind='isolated_preview_test'`;
 assert.equal(jobs.length,1);jobId=Number(jobs[0].id);assert.equal(jobs[0].attempts,0);
 assert.equal((await sql`SELECT count(*)::int AS n FROM quoteflow_processed_events WHERE stripe_event_id=${event.id}`)[0].n,1);
 log('atomic durable order/event/outbox and replay deduplication',{pass:true,jobId});
 const denied=await app('/api/preview-email-dispatch',{id:jobId,dryRun:false});assert.equal(denied.r.status,401);
 const dry=await app('/api/preview-email-dispatch',{id:jobId,dryRun:true},true);assert.equal(dry.r.status,200);assert.equal(dry.data.eligible,true);
 assert.equal((await sql`SELECT attempts FROM quoteflow_email_deliveries WHERE id=${jobId}`)[0].attempts,0);
 const results=await Promise.all([app('/api/preview-email-dispatch',{id:jobId,dryRun:false},true),app('/api/preview-email-dispatch',{id:jobId,dryRun:false},true)]);
 assert.equal(results.filter(x=>x.r.status===409).length,1,'Only one concurrent request may claim the job');
 const sent=results.find(x=>x.r.status!==409);log('concurrent dispatcher claim',{statuses:results.map(x=>x.r.status)});
 const [record]=await sql`SELECT status,attempts,provider_message_id,next_retry_at,last_error FROM quoteflow_email_deliveries WHERE id=${jobId}`;
 log('actual provider outcome',{jobId,status:record.status,attempts:record.attempts,providerIdPresent:!!record.provider_message_id,retryScheduled:!!record.next_retry_at,lastError:record.last_error});
 if(sent.r.status!==200){failure='PROVIDER_SEND_BLOCKED_HTTP_'+sent.data.providerStatus;}
 else{
  assert.equal(record.status,'SENT');assert.equal(record.attempts,1);assert.ok(record.provider_message_id);assert.equal(record.next_retry_at,null);
  const repeated=await app('/api/preview-email-dispatch',{id:jobId,dryRun:false},true);assert.equal(repeated.r.status,409);
  const reconciled=await app('/api/preview-email-dispatch',{id:jobId,action:'reconcile',dryRun:false},true);
  if(reconciled.r.status!==200) failure='PROVIDER_RECEIPT_BLOCKED_HTTP_'+reconciled.data.providerStatus;
  else log('provider receipt',{reconciled:reconciled.data.reconciled,delivered:reconciled.data.delivered,providerStatus:reconciled.data.providerStatus});
 }
 // Exercise actual database lease/retry transitions without any provider request.
 const policyExports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/delivery-policy.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
  {exports:policyExports,process,Date,require});
 const outboxExports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/isolated-email-outbox.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
  {exports:outboxExports,process,Date,require:name=>name==='./verified-database'?{verifiedDatabase:async()=>sql}:name==='./delivery-policy'?policyExports:require(name)});
 const retrySession='internal-retry-'+run;
 try{
  const [fixture]=await sql`INSERT INTO quoteflow_email_deliveries(stripe_session_id,email_kind,recipient_email,idempotency_key,payload,payload_hash,status,attempts,first_attempt_at,next_retry_at)
   VALUES(${retrySession},'isolated_preview_test',${recipient},${retrySession},${JSON.stringify(jobs[0].payload)}::jsonb,${jobs[0].payload_hash},'FAILED',1,now(),now()) RETURNING id`;
  const id=Number(fixture.id),claim=await outboxExports.claimDelivery(id);assert.equal(claim.attempts,2);assert.equal(await outboxExports.claimDelivery(id),null);
  await outboxExports.markFailed(id,claim.lease_token,503,2,new Date(claim.first_attempt_at));
  const [failed]=await sql`SELECT status,next_retry_at FROM quoteflow_email_deliveries WHERE id=${id}`;assert.equal(failed.status,'FAILED');assert.ok(failed.next_retry_at);
  assert.equal(await outboxExports.claimDelivery(id),null);
  await sql`UPDATE quoteflow_email_deliveries SET next_retry_at=now()-interval '1 second' WHERE id=${id} AND stripe_session_id=${retrySession}`;
  const final=await outboxExports.claimDelivery(id);assert.equal(final.attempts,3);
  assert.equal((await outboxExports.markSent(id,claim.lease_token,'stale-test-receipt')).length,0);
  await outboxExports.markFailed(id,final.lease_token,503,3,new Date(final.first_attempt_at));
  assert.equal((await sql`SELECT next_retry_at FROM quoteflow_email_deliveries WHERE id=${id}`)[0].next_retry_at,null);
  assert.equal(await outboxExports.claimDelivery(id),null);
  log('real database retry/lease/stale-worker/attempt-limit',{pass:true});
 }finally{await sql`DELETE FROM quoteflow_email_deliveries WHERE stripe_session_id=${retrySession} AND idempotency_key=${retrySession}`;}
 const recovered=await app('/api/recover-quotation',{sessionId});assert.equal(recovered.r.status,200);assert.equal(recovered.data.payload,payload);
 const capability=await app('/api/deliver-quotation',{sessionId,format:'pdf',issueToken:true});assert.equal(capability.r.status,200);
 for(const format of ['pdf','xlsx']){
  const r=await fetch(new URL('/api/deliver-quotation',base),{method:'POST',headers:{'Content-Type':'application/json','x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN},
   body:JSON.stringify({sessionId,format,token:capability.data.token})});const bytes=Buffer.from(await r.arrayBuffer());
  log('actual paid Test file download',{format,status:r.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});assert.equal(r.status,200);assert.ok(bytes.length>500);
 }
 log('result',{run,jobId,paymentAndOutboxAndFiles:'PASS',providerAndGmail:failure??'provider accepted; Gmail verification still required'});
 if(failure){console.log('BLOCKED: '+failure);process.exitCode=1;}
}catch(e){log('FAIL',{run,jobId,error:e.name,message:String(e.message).replaceAll(sessionId??'UNSET_SESSION','[redacted]')});process.exitCode=1;}
