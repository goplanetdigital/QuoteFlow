import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function worker(authorized,statuses=[200,200]){
 const exports={},calls=[];
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/email-worker.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
 exports,JSON,require:name=>name==='next/server'?{NextRequest:Request,NextResponse:{json:(body,opts={})=>({body,status:opts.status??200})}}:
 name==='./delivery-policy'?{workerAuthorized:()=>authorized}:{dispatchRequest:async req=>{calls.push(await req.json());return {status:statuses[calls.length-1],json:async()=>({empty:true})};}}
 });return {tick:()=>exports.workerTick(new Request('https://preview.example/api/email-dispatch',{headers:{Authorization:'Bearer test'}})),calls};
}
test('cron tick authenticates before dispatch and runs both due delivery and reconciliation',async()=>{
 const denied=worker(false);assert.equal((await denied.tick()).status,401);assert.equal(denied.calls.length,0);
 const allowed=worker(true);assert.equal((await allowed.tick()).status,200);
 assert.deepEqual(allowed.calls,[{action:'dispatch',dryRun:false},{action:'reconcile',dryRun:false}]);
});
test('cron surfaces provider failure and tolerates a concurrent claim',async()=>{
 assert.equal((await worker(true,[502,200]).tick()).status,503);
 assert.equal((await worker(true,[409,200]).tick()).status,200);
});
