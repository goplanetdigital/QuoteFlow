import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
function policy(env) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/delivery-policy.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,process:{env},Date,require:name=>{assert.equal(name,'node:crypto');return crypto;}});
  return exports;
}
test('retry uncertain outcomes only inside provider deduplication window and attempt limit',()=>{
  const p=policy({}), first=new Date('2026-10-28T00:00:00Z');
  for(const status of [null,429,500,503]) assert.equal(p.retryDecision(status,1,first,new Date('2026-10-28T00:01:00Z')).retry,true);
  for(const status of [400,401,403,409,422]) assert.equal(p.retryDecision(status,1,first,new Date('2026-10-28T00:01:00Z')).retry,false);
  assert.equal(p.retryDecision(null,3,first,new Date('2026-10-28T00:01:00Z')).retry,false);
  assert.equal(p.retryDecision(null,1,first,new Date('2026-10-28T23:00:00Z')).retry,false);
  assert.equal(p.retryDecision(200,1,first,new Date('2026-10-28T00:01:00Z')).retry,true,'Missing provider id remains uncertain');
  assert.equal(p.retryDecision(409,1,first,new Date('2026-10-28T00:01:00Z'),'concurrent_idempotent_requests').retry,true);
  assert.equal(p.retryDecision(409,1,first,new Date('2026-10-28T00:01:00Z'),'invalid_idempotent_request').retry,false);
});
test('persisted JSONB key ordering cannot break payload hash; altered content does',()=>{
  const p=policy({});
  const mail={from:'orders@allsetintl.com',to:['jcaiworker@gmail.com'],subject:'test',text:'original'};
  assert.equal(p.payloadHash(mail),p.payloadHash({text:mail.text,subject:mail.subject,to:mail.to,from:mail.from}));
  assert.notEqual(p.payloadHash(mail),p.payloadHash({...mail,text:'changed'}));
});
test('Preview delivery stays confined to the existing single owned test mailbox',()=>{
  const p=policy({VERCEL_ENV:'preview',QUOTEFLOW_ISOLATED_OUTBOX_ENABLED:'true',QUOTEFLOW_TEST_EMAIL_ALLOWLIST:'jcaiworker@gmail.com'});
  assert.equal(p.outboxEnabled(),true);
  assert.equal(p.recipientAllowed('jcaiworker@gmail.com'),true);
  assert.equal(p.recipientAllowed('customer@example.com'),false);
  assert.equal(policy({VERCEL_ENV:'production'}).outboxEnabled(),false);
});
test('worker authentication rejects absent, malformed and unrelated credentials',()=>{
  const secret='x'.repeat(48),p=policy({VERCEL_ENV:'preview',QUOTEFLOW_PREVIEW_WORKER_SECRET:secret});
  for(const v of [null,'Bearer wrong','Basic '+secret]) assert.equal(p.workerAuthorized(v),false);
  assert.equal(p.workerAuthorized('Bearer '+secret),true);
});
