// Explicit Preview acceptance; never part of the default build. Logs contain no credentials.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';
const require=createRequire(import.meta.url),cache={};
function load(path,fetchImpl=fetch){
 if(cache[path])return cache[path];const exports={};cache[path]=exports;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
 {exports,process,Date,URL,Buffer,AbortSignal,console,fetch:fetchImpl,require:name=>name.startsWith('./')?load('lib/'+name.slice(2),fetchImpl):require(name)});return exports;
}
assert.equal(process.env.VERCEL_ENV,'preview');
assert.equal(process.env.VERCEL_PROJECT_ID,'prj_MbjZemw47Dz4UoyloYnMIdNvMQgp');
assert.match(process.env.STRIPE_SECRET_KEY??'',/^(sk|rk)_test_/);
assert.equal(process.env.QUOTEFLOW_TEST_EMAIL_ALLOWLIST,'jcaiworker@gmail.com');
const base=new URL(process.env.QUOTEFLOW_ACCEPTANCE_URL);
assert.match(base.hostname,/^quote-flow-[a-z0-9]+-go-planet-digital\.vercel\.app$/);
const sql=await load('lib/verified-database').verifiedDatabase(process.env.DATABASE_URL);
const policy=load('lib/delivery-policy'),outbox=load('lib/isolated-email-outbox');
const log=(check,evidence={})=>console.log(JSON.stringify({acceptance:check,...evidence}));
const headers={'Content-Type':'application/json','x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN};
async function post(path,body,worker=false){const r=await fetch(new URL(path,base),{method:'POST',headers:{...headers,...(worker?{Authorization:'Bearer '+process.env.QUOTEFLOW_PREVIEW_WORKER_SECRET}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});return {r,data:await r.json()};}
async function stripe(path,method='GET',params,expected=200){
 const r=await fetch('https://api.stripe.com'+path,{method,headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(params?{body:new URLSearchParams(params).toString()}:{}),signal:AbortSignal.timeout(25000)});
 const data=await r.json();assert.equal(r.status,expected,'Stripe Test HTTP '+r.status+' '+data.error?.code);assert.notEqual(data.livemode,true);return data;
}
async function webhook(event,expected=200){const raw=JSON.stringify(event),t=Math.floor(Date.now()/1000),sig=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(t+'.'+raw).digest('hex');
 const r=await fetch(new URL('/api/stripe-webhook',base),{method:'POST',headers:{...headers,'stripe-signature':'t='+t+',v1='+sig},body:raw});assert.equal(r.status,expected);return r.json();}
const [job]=await sql`SELECT * FROM quoteflow_email_deliveries WHERE id=4 AND email_kind='isolated_preview_test' AND recipient_email='jcaiworker@gmail.com'`;
assert.ok(job);assert.equal(job.status,'SENT');assert.ok(job.provider_message_id);
const [snapshot]=await sql`SELECT payload::text AS payload FROM quoteflow_quote_snapshots WHERE fingerprint=(SELECT fingerprint FROM quoteflow_orders WHERE stripe_session_id=${job.stripe_session_id})`;
const original=JSON.parse(snapshot.payload);assert.equal(typeof original,'string');
const parsed=JSON.parse(original),run=randomUUID().slice(0,8);
const identityResponse=await fetch(new URL('/api/preview-db-identity',base),{headers,signal:AbortSignal.timeout(25000)});
assert.equal(identityResponse.status,200);assert.equal((await identityResponse.json()).isolated,true);
log('runtime and build database attestation',{pass:true});
const a=await stripe('/v1/checkout/sessions/'+job.stripe_session_id);assert.equal(a.payment_status,'paid');assert.equal(a.livemode,false);
log('existing real paid Stripe Test order reused',{jobId:4,paid:true,live:false});
const events=await stripe('/v1/events?type=checkout.session.completed&limit=100');
const event=events.data.find(e=>e.data.object.id===a.id);assert.ok(event);
const before=(await sql`SELECT attempts FROM quoteflow_email_deliveries WHERE id=4`)[0].attempts;
await webhook(event);await webhook(event);
assert.equal((await sql`SELECT count(*)::int AS n FROM quoteflow_email_deliveries WHERE stripe_session_id=${a.id}`)[0].n,1);
assert.equal((await sql`SELECT count(*)::int AS n FROM quoteflow_processed_events WHERE stripe_event_id=${event.id}`)[0].n,1);
assert.equal((await sql`SELECT attempts FROM quoteflow_email_deliveries WHERE id=4`)[0].attempts,before);
log('actual completed event duplicate replay',{pass:true,noResend:true});
for(const body of [null,[],{dryRun:'false'}])assert.equal((await post('/api/preview-email-dispatch',body,true)).r.status,400);
log('deployed dispatcher input validation',{pass:true});
// Different synthetic customer, same owned test mailbox; never deliver this job.
const payload=JSON.stringify({...parsed,meta:{...parsed.meta,customerName:'ISOLATED CUSTOMER B '+run,quoteNumber:'ISOLATION-B-'+run}});
const checkout=await post('/api/checkout',{payload});assert.equal(checkout.r.status,200);
const bId=new URL(checkout.data.url).pathname.split('/').pop();assert.match(bId,/^cs_test_/);
try {
let b=await stripe('/v1/checkout/sessions/'+bId);
await stripe('/v1/payment_pages/'+bId);
async function method(token){return stripe('/v1/payment_methods','POST',{type:'card','card[token]':token,'billing_details[email]':'jcaiworker@gmail.com','billing_details[name]':'Preview Customer B','billing_details[address][line1]':'354 Oyster Point Blvd','billing_details[address][city]':'South San Francisco','billing_details[address][postal_code]':'94080','billing_details[address][state]':'CA','billing_details[address][country]':'US'});}
const declined=await method('tok_chargeDeclined');
await stripe('/v1/payment_pages/'+bId+'/confirm','POST',{payment_method:declined.id,expected_amount:String(b.amount_total)},402);
b=await stripe('/v1/checkout/sessions/'+bId);assert.notEqual(b.payment_status,'paid');
assert.equal((await post('/api/recover-quotation',{sessionId:bId})).r.status,403);
assert.equal((await post('/api/deliver-quotation',{sessionId:bId,format:'pdf',issueToken:true})).r.status,403);
const failureId='evt_preview_failure_'+run;
await webhook({id:failureId,type:'checkout.session.async_payment_failed',livemode:false,created:Math.floor(Date.now()/1000),data:{object:b}});
assert.equal((await sql`SELECT payment_status FROM quoteflow_orders WHERE stripe_session_id=${bId}`)[0].payment_status,'failed');
assert.equal((await sql`SELECT count(*)::int AS n FROM quoteflow_email_deliveries WHERE stripe_session_id=${bId}`)[0].n,0);
log('actual Test card decline and signed failure fixture',{pass:true,noDownload:true,noEmailJob:true});
const visa=await method('tok_visa');await stripe('/v1/payment_pages/'+bId+'/confirm','POST',{payment_method:visa.id,expected_amount:String(b.amount_total)});
b=await stripe('/v1/checkout/sessions/'+bId);assert.equal(b.payment_status,'paid');assert.equal(b.livemode,false);
const completed=await stripe('/v1/events?type=checkout.session.completed&limit=100');const bEvent=completed.data.find(e=>e.data.object.id===bId);assert.ok(bEvent);await webhook(bEvent);
await webhook({id:'evt_preview_late_failure_'+run,type:'checkout.session.async_payment_failed',livemode:false,created:Math.floor(Date.now()/1000),data:{object:b}});
assert.equal((await sql`SELECT payment_status FROM quoteflow_orders WHERE stripe_session_id=${bId}`)[0].payment_status,'paid');
const aToken=await post('/api/deliver-quotation',{sessionId:a.id,format:'pdf',issueToken:true});assert.equal(aToken.r.status,200);
const bToken=await post('/api/deliver-quotation',{sessionId:bId,format:'pdf',issueToken:true});assert.equal(bToken.r.status,200);
for(const format of ['pdf','xlsx']){
 for(const [sessionId,token] of [[bId,aToken.data.token],[a.id,bToken.data.token]])assert.equal((await post('/api/deliver-quotation',{sessionId,format,token})).r.status,403);
 for(const [sessionId,token,isB] of [[a.id,aToken.data.token,false],[bId,bToken.data.token,true]]){
 const r=await fetch(new URL('/api/deliver-quotation',base),{method:'POST',headers,body:JSON.stringify({sessionId,format,token}),signal:AbortSignal.timeout(25000)});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 const bytes=Buffer.from(await r.arrayBuffer());let contents;
 if(format==='pdf'){assert.equal(bytes.subarray(0,5).toString(),'%PDF-');contents=bytes.toString();}
 else{const wb=XLSX.read(bytes,{type:'buffer'});contents=JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1}));}
 assert.equal(contents.includes('ISOLATED CUSTOMER B '+run),isB);assert.ok(contents.includes('247.2'));
 log('actual paid file contents and customer isolation',{format,customer:isB?'B':'A',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),pass:true});
 }
}
assert.equal((await post('/api/recover-quotation',{sessionId:a.id,payload})).data.payload,original);
assert.equal((await post('/api/recover-quotation',{sessionId:bId,payload:original})).data.payload,payload);
log('paid terminal status and recovery snapshot isolation',{pass:true});
// Real dispatcher code + real isolated DB; controlled provider fault injection, zero outgoing email.
let calls=0,firstBody,firstKey;
const dispatch=load('lib/email-dispatch',async(_url,options)=>{
 calls++;if(calls===1){firstBody=options.body;firstKey=options.headers['Idempotency-Key'];return {status:503,ok:false,json:async()=>({name:'internal_error'})};}
 assert.equal(options.body,firstBody);assert.equal(options.headers['Idempotency-Key'],firstKey);
 return {status:200,ok:true,json:async()=>({id:'preview-mock-'+run})};
}).dispatchRequest;
const fixture='acceptance-retry-'+run;let fixtureId;
try{
 const [row]=await sql`INSERT INTO quoteflow_email_deliveries(stripe_session_id,email_kind,recipient_email,idempotency_key,payload,payload_hash) VALUES(${fixture},'isolated_preview_test','jcaiworker@gmail.com',${fixture},${JSON.stringify(job.payload)}::jsonb,${policy.payloadHash(job.payload)}) RETURNING id`;fixtureId=Number(row.id);
 const request=()=>({headers:{get:()=> 'Bearer '+process.env.QUOTEFLOW_PREVIEW_WORKER_SECRET},json:async()=>({id:fixtureId,dryRun:false})});
 assert.equal((await dispatch(request())).status,502);
 let [state]=await sql`SELECT * FROM quoteflow_email_deliveries WHERE id=${fixtureId}`;assert.equal(state.status,'FAILED');assert.ok(state.next_retry_at);assert.equal(state.attempts,1);
 assert.equal((await dispatch(request())).status,409);assert.equal(calls,1);
 await sql`UPDATE quoteflow_email_deliveries SET next_retry_at=now()-interval '1 second' WHERE id=${fixtureId} AND stripe_session_id=${fixture}`;
 assert.equal((await dispatch(request())).status,200);assert.equal((await dispatch(request())).status,409);assert.equal(calls,2);
 [state]=await sql`SELECT * FROM quoteflow_email_deliveries WHERE id=${fixtureId}`;assert.equal(state.status,'SENT');assert.equal(state.attempts,2);assert.equal(state.next_retry_at,null);
 log('provider failure to successful retry through actual dispatcher and DB',{pass:true,injectedProvider:true,noOutgoingMail:true,identicalPayloadAndKey:true});
 // Reset only this synthetic fixture to verify crash recovery and stale writer fencing.
 await sql`UPDATE quoteflow_email_deliveries SET status='PENDING',attempts=0,provider_message_id=NULL,first_attempt_at=NULL WHERE id=${fixtureId} AND stripe_session_id=${fixture}`;
 const old=await outbox.claimDelivery(fixtureId);assert.ok(old);
 await sql`UPDATE quoteflow_email_deliveries SET lease_until=now()-interval '1 second' WHERE id=${fixtureId} AND stripe_session_id=${fixture}`;
 await outbox.quarantineExpiredLeases();const next=await outbox.claimDelivery(fixtureId);assert.ok(next);assert.notEqual(next.lease_token,old.lease_token);
 assert.equal((await outbox.markSent(fixtureId,old.lease_token,'stale')).length,0);
 await outbox.markFailed(fixtureId,next.lease_token,503,2,new Date(next.first_attempt_at));
 await sql`UPDATE quoteflow_email_deliveries SET next_retry_at=now()-interval '1 second' WHERE id=${fixtureId} AND stripe_session_id=${fixture}`;
 const last=await outbox.claimDelivery(fixtureId);assert.equal(last.attempts,3);await outbox.markFailed(fixtureId,last.lease_token,503,3,new Date(last.first_attempt_at));assert.equal(await outbox.claimDelivery(fixtureId),null);
 log('lease expiry recovery stale writer and attempt limit',{pass:true});
}finally{if(fixtureId)await sql`DELETE FROM quoteflow_email_deliveries WHERE id=${fixtureId} AND stripe_session_id=${fixture}`;}
} finally {
// Prevent later workers from sending the second acceptance order; preserve test ledger evidence.
await sql`UPDATE quoteflow_email_deliveries SET status='FAILED',next_retry_at=NULL,last_error='ACCEPTANCE_NO_SEND' WHERE stripe_session_id=${bId} AND email_kind='isolated_preview_test' AND attempts=0`;
}
const receipt=await post('/api/preview-email-dispatch',{id:4,action:'reconcile',dryRun:false},true);
log('provider reconciliation',{http:receipt.r.status,status:receipt.data.providerStatus,error:receipt.data.providerError,delivered:receipt.data.delivered});
log('release result',{functionalGaps:'PASS',providerReceipt:receipt.r.status===200&&receipt.data.delivered?'PASS':'BLOCKED',testCustomerBNoSend:true});
