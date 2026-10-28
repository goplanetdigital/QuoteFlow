import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(record){
 const exports={};let writes=0;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/email-dispatch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
 exports,process:{env:{RESEND_API_KEY:'test'}},Date,
 require:name=>name==='next/server'?{NextResponse:{json:(body,opts={})=>({body,status:opts.status??200})}}:
 name==='./delivery-policy'?{workerAuthorized:()=>true,outboxEnabled:()=>true,recipientAllowed:()=>true,payloadHash:()=> 'hash'}:
 {isolatedOutbox:async()=>async()=>[record],quarantineExpiredLeases:async()=>{writes++}},
 });return {dispatch:async body=>exports.dispatchRequest({headers:{get:()=>''},json:async()=>body}),writes:()=>writes};
}
test('dispatcher rejects non-object bodies and malformed options before touching jobs',async()=>{
 for(const body of [null,[],true,42,'text',{dryRun:'false'},{action:5},{id:0}]){
 const worker=load(null);assert.equal((await worker.dispatch(body)).status,400);assert.equal(worker.writes(),0);
 }
});
test('dry run eligibility agrees with claim attempt, due-time and deduplication limits',async()=>{
 const job={id:1,status:'PENDING',attempts:0,payload:{to:['owned@example.com']},recipient_email:'owned@example.com',payload_hash:'hash'};
 for(const changes of [{attempts:3},{first_attempt_at:new Date(Date.now()-24*3600000).toISOString()},
 {provider_message_id:'already-sent'},{status:'FAILED',next_retry_at:new Date(Date.now()+60000).toISOString()}]){
 const worker=load({...job,...changes});const result=await worker.dispatch({id:1});assert.equal(result.status,200);assert.equal(result.body.eligible,false);assert.equal(worker.writes(),0);
 }
 assert.equal((await load(job).dispatch({id:1})).body.eligible,true);
});
