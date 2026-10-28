import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('receipt reconciliation defaults to a read-only dry-run and rejects mismatched receipts',async()=>{
  const record={id:4,provider_message_id:'owned-test-id',recipient_email:'jcaiworker@gmail.com',email_kind:'isolated_preview_test',payload:{subject:'owned-test'}};
  let writes=0,providerCalls=0;
  const sql=async(strings)=>{if(strings.join('').includes('UPDATE'))writes++;return [record];};
  const exports={};
  const policy={workerAuthorized:()=>true,outboxEnabled:()=>true,recipientAllowed:()=>true};
  const outbox={isolatedOutbox:async()=>sql};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/email-dispatch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
    exports,process:{env:{VERCEL_ENV:'preview',RESEND_API_KEY:'test-send',RESEND_READ_API_KEY:'test-read'}},AbortSignal,
    require:name=>name==='next/server'?{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}}:name==='./delivery-policy'?policy:outbox,
    fetch:async(_url,options)=>{providerCalls++;assert.equal(options.headers.Authorization,'Bearer test-read');
      return {ok:true,json:async()=>({id:'unrelated-id',to:['jcaiworker@gmail.com'],subject:'owned-test',last_event:'delivered'})};}
  });
  for(const dryRun of [undefined,true]){
    const result=await exports.dispatchRequest({headers:{get:()=>''},json:async()=>({id:4,action:'reconcile',dryRun})});
    assert.equal(result.status,200);assert.equal(result.body.dryRun,true);
  }
  assert.equal(writes,0);assert.equal(providerCalls,0);
  const mismatch=await exports.dispatchRequest({headers:{get:()=>''},json:async()=>({id:4,action:'reconcile',dryRun:false})});
  assert.equal(mismatch.status,409);assert.equal(providerCalls,1);assert.equal(writes,0);
});
