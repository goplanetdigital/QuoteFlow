import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const host='ep-withered-glitter-ao41bqx3.c-2.ap-southeast-1.aws.neon.tech';
function load(row,env='preview'){
 let connections=0,queries=0;
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync('lib/verified-database.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
 {exports,URL,process:{env:{VERCEL_ENV:env}},require:()=>({neon:()=>{connections++;return async()=>{queries++;return [row];};}})});
 return {verify:exports.verifiedDatabase,counts:()=>[connections,queries]};
}
const identity={branch_id:'br-summer-term-aonsnvyi',project_id:'solitary-fog-81429256',database:'neondb',role:'neondb_owner'};
const url=`postgresql://neondb_owner:synthetic@${host}/neondb`;
test('reject wrong endpoint or URL identity before connecting',async()=>{
 for(const bad of [url.replace(host,'production.example.com'),url.replace('neondb_owner','worker'),url.replace('/neondb','/other'),url.replace('postgresql:','http:')]){
  const db=load(identity);await assert.rejects(db.verify(bad));assert.deepEqual(db.counts(),[0,0]);
 }
});
test('query result must attest exact branch, project, database and role',async()=>{
 for(const field of Object.keys(identity)){
  const db=load({...identity,[field]:'wrong'});await assert.rejects(db.verify(url));assert.deepEqual(db.counts(),[1,1]);
 }
 const db=load(identity);assert.equal(typeof await db.verify(url),'function');assert.deepEqual(db.counts(),[1,1]);
});
test('existing production connection does not use Preview attestation',async()=>{
 const db=load(null,'production');await db.verify('postgresql://synthetic@production.example.com/neondb');assert.deepEqual(db.counts(),[1,0]);
});
