// Read-only inspection in the existing trusted Vercel Preview environment.
import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
assert.equal(process.env.VERCEL_ENV,'preview');
assert.equal(process.env.VERCEL_PROJECT_ID,'prj_MbjZemw47Dz4UoyloYnMIdNvMQgp');
const sql=neon(process.env.DATABASE_URL);
const [identity]=await sql`SELECT current_setting('neon.branch_id',true) AS branch_id,current_setting('neon.project_id',true) AS project_id`;
assert.equal(identity.branch_id,'br-summer-term-aonsnvyi');
assert.equal(identity.project_id,'solitary-fog-81429256');
console.log(JSON.stringify({inspection:'database identity',...identity}));
assert.match(process.env.STRIPE_SECRET_KEY??'',/^(sk|rk)_test_/);
const r=await fetch('https://api.stripe.com/v1/checkout/sessions?status=complete&limit=100',{headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY}});
const body=await r.json();
console.log(JSON.stringify({inspection:'existing Stripe test sessions',http:r.status,hasMore:body.has_more,
 sessions:body.data?.map(s=>({idSuffix:s.id.slice(-8),paid:s.payment_status==='paid',recipientAllowed:(s.customer_details?.email??s.customer_email)==='jcaiworker@gmail.com',hasFingerprint:!!s.metadata?.fingerprint,items:s.metadata?.itemCount,pricingVersion:s.metadata?.pricingVersion}))}));
assert.equal(r.status,200);
const jobs=await sql`SELECT id,status,provider_message_id FROM quoteflow_email_deliveries WHERE provider_message_id IS NOT NULL ORDER BY id LIMIT 1`;
if(jobs[0]){
 const receipt=await fetch('https://api.resend.com/emails/'+encodeURIComponent(jobs[0].provider_message_id),{headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY}});
 const data=await receipt.json();
 console.log(JSON.stringify({inspection:'existing provider receipt read access',http:receipt.status,hasReceiptId:!!data.id,lastEvent:data.last_event??null,errorName:data.name,message:typeof data.message==='string'?data.message.replace(/re_[A-Za-z0-9]+/g,'[redacted]'):undefined}));
}
