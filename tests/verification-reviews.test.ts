import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyCommand, snapshotFor } from '../src/lib/demo';
import { commandSchema, type Command, type Profile } from '../src/lib/domain';
import { seedState, ids } from '../src/lib/seed';
import { auditRuntimeDatabase } from '../src/lib/database-readiness';

// Runs against an isolated PostgreSQL engine. No environment files or hosted data.
const db = new PGlite();
const campus = randomUUID(), otherCampus = randomUUID();
let admin: string, otherAdmin: string;
async function user(values: {role?:string; verified?:boolean; suspended?:boolean; college_id?:string|null} = {}) {
 const id = randomUUID();
 await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [id,'Test member',id+'@example.test']);
 await db.query('UPDATE profiles SET role=$2,verified=$3,suspended=$4,college_id=$5 WHERE id=$1', [id,values.role??'student',values.verified??false,values.suspended??false,values.college_id===undefined?campus:values.college_id]);
 return id;
}
async function asUser<T>(id:string|null, work:()=>Promise<T>):Promise<T> {
 await db.exec('BEGIN; SET LOCAL ROLE unicirq_app;');
 try { if(id)await db.query("SELECT set_config('app.user_id',$1,true)",[id]); const result=await work(); await db.exec('COMMIT'); return result; }
 catch(error) { await db.exec('ROLLBACK'); throw error; }
}
async function command(id:string|null, input:object) {
 return asUser(id,async()=> (await db.query<{result:{id:string}}>('SELECT unicirq_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result);
}
async function request(id:string, kind:'campus'|'business'='campus') {
 return command(id,{type:'request_verification',college_id:campus,kind,detail:'Please independently review the information with the campus office.'});
}
function review(target_id:string, overrides:Record<string,unknown>={}) {
 return {type:'moderate',entity:'verification',target_id,decision:'approve',reason:'Enrollment checked independently with the campus office.',review_method:'campus_office',evidence_checked:true,...overrides};
}
before(async()=> {
 for(const file of (await readdir('database/migrations')).filter(name=>/^\d+_.+\.sql$/.test(name)).sort()) await db.exec(await readFile('database/migrations/'+file,'utf8'));
 for(const [id,name] of [[campus,'Test campus'],[otherCampus,'Other campus']]) await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$2,$3,$4)',[id,name,id+'.example.test','Test city']);
 admin=await user({role:'admin',verified:true}); otherAdmin=await user({role:'admin',verified:true});
 await db.exec(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  CREATE ROLE verification_runtime LOGIN;
  GRANT USAGE ON SCHEMA public TO verification_runtime;
  GRANT SELECT,INSERT,UPDATE,DELETE ON "user","session",account,verification,"rateLimit" TO verification_runtime;
  GRANT unicirq_app,unicirq_billing_backend TO verification_runtime;`);
});
after(async()=>{ await db.close(); });

test('SQL rejects anonymous, suspended, and non-admin review and keeps requests private', async()=> {
 const applicant=await user(), stranger=await user(), suspendedAdmin=await user({role:'admin',suspended:true});
 const application=await request(applicant);
 for(const actor of [null,stranger,suspendedAdmin]) await assert.rejects(()=>command(actor,review(application.id)),/active account|Admin access/);
 assert.equal((await asUser(stranger,()=>db.query('SELECT * FROM verification_requests WHERE id=$1',[application.id]))).rows.length,0);
 assert.equal((await asUser(applicant,()=>db.query('SELECT * FROM verification_requests WHERE id=$1',[application.id]))).rows.length,1);
 assert.equal((await asUser(admin,()=>db.query('SELECT * FROM verification_requests WHERE id=$1',[application.id]))).rows.length,1);
 await assert.rejects(()=>asUser(applicant,()=>db.query("UPDATE verification_requests SET status='approved',reviewed_by=$1 WHERE id=$2",[applicant,application.id])),/permission denied/);
});

test('SQL requires independent evidence and a method appropriate to campus enrollment', async()=> {
 const applicant=await user(), application=await request(applicant);
 for(const overrides of [{evidence_checked:undefined},{evidence_checked:false},{evidence_checked:'true'},{review_method:undefined},{review_method:'public_business'},{review_method:'uploaded_document'}])
  await assert.rejects(()=>command(admin,review(application.id,overrides)),/evidence|review method/);
 assert.equal((await db.query<{status:string}>('SELECT status FROM verification_requests WHERE id=$1',[application.id])).rows[0].status,'pending');
 assert.equal((await db.query<{verified:boolean}>('SELECT verified FROM profiles WHERE id=$1',[applicant])).rows[0].verified,false);
});

test('SQL owns reviewer identity and time, creates a single audit, and preserves campus', async()=> {
 const applicant=await user(), application=await request(applicant), before=Date.now();
 await command(admin,review(application.id,{reviewed_by:otherAdmin,reviewed_at:'2000-01-01T00:00:00Z',user_id:otherAdmin,college_id:otherCampus}));
 const row=(await db.query<{status:string;reviewed_by:string;reviewed_at:Date;review_method:string}>('SELECT * FROM verification_requests WHERE id=$1',[application.id])).rows[0];
 assert.equal(row.status,'approved'); assert.equal(row.reviewed_by,admin); assert.equal(row.review_method,'campus_office'); assert.ok(new Date(row.reviewed_at).getTime()>=before-1000);
 const profile=(await db.query<{verified:boolean;college_id:string;role:string}>('SELECT verified,college_id,role FROM profiles WHERE id=$1',[applicant])).rows[0];
 assert.deepEqual(profile,{verified:true,college_id:campus,role:'student'});
 await assert.rejects(()=>command(otherAdmin,review(application.id)),/already been reviewed/);
 const audit=await asUser(admin,()=>db.query<{actor_id:string}>('SELECT actor_id FROM audit_logs WHERE target_id=$1',[application.id])); assert.deepEqual(audit.rows.map(row=>row.actor_id),[admin]);
 assert.equal((await asUser(applicant,()=>db.query('SELECT * FROM audit_logs WHERE target_id=$1',[application.id]))).rows.length,0);
 assert.equal((await asUser(applicant,()=>db.query('SELECT * FROM notifications WHERE user_id=$1 AND title=$2',[applicant,'Verification reviewed']))).rows.length,1);
});

test('SQL blocks self-review and decisions on a promoted or suspended applicant', async()=> {
 const applicant=await user(), application=await request(applicant);
 await db.query("UPDATE profiles SET role='admin' WHERE id=$1",[applicant]);
 await assert.rejects(()=>command(applicant,review(application.id)),/own verification/);
 for(const decision of ['approve','reject']) await assert.rejects(()=>command(admin,review(application.id,{decision})),/active student/);
 assert.equal((await db.query<{role:string}>('SELECT role FROM profiles WHERE id=$1',[applicant])).rows[0].role,'admin');
 await db.query("UPDATE profiles SET role='student',suspended=true WHERE id=$1",[applicant]);
 await assert.rejects(()=>command(admin,review(application.id)),/active student/);
});

test('SQL never changes the selected campus on approval and can reject obsolete requests', async()=> {
 const applicant=await user(), application=await request(applicant);
 await db.query('UPDATE profiles SET college_id=$1 WHERE id=$2',[otherCampus,applicant]);
 await assert.rejects(()=>command(admin,review(application.id)),/selected university/);
 await command(admin,review(application.id,{decision:'reject',reason:'Your selected campus changed. Contact support to correct your details.',review_method:undefined,evidence_checked:undefined}));
 const row=(await db.query<{status:string;reviewed_by:string;review_method:string|null}>('SELECT * FROM verification_requests WHERE id=$1',[application.id])).rows[0];
 assert.equal(row.status,'rejected');assert.equal(row.reviewed_by,admin);assert.equal(row.review_method,null);
 assert.equal((await db.query<{college_id:string}>('SELECT college_id FROM profiles WHERE id=$1',[applicant])).rows[0].college_id,otherCampus);
});

test('SQL rejection needs a useful reason and permits a new submission with a clean review record', async()=> {
 const applicant=await user(), application=await request(applicant);
 await assert.rejects(()=>request(applicant),/already pending/);
 await assert.rejects(()=>command(admin,review(application.id,{decision:'reject',reason:' no '})),/reason/);
 await command(admin,review(application.id,{decision:'reject',reason:'Please arrange an enrollment check with the campus office.',review_method:undefined,evidence_checked:undefined}));
 const next=await request(applicant); assert.notEqual(next.id,application.id);
 const pending=(await db.query<{reviewed_by:string|null;reviewed_at:Date|null;review_method:string|null}>('SELECT reviewed_by,reviewed_at,review_method FROM verification_requests WHERE id=$1',[next.id])).rows[0];
 assert.deepEqual(pending,{reviewed_by:null,reviewed_at:null,review_method:null});
 assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM verification_requests WHERE user_id=$1 AND status=$2',[applicant,'pending'])).rows[0].count,1);
});

test('SQL business applications require existing campus verification and the same campus', async()=> {
 const unverified=await user(), verified=await user({verified:true});
 await assert.rejects(()=>request(unverified,'business'),/campus verification/);
 await assert.rejects(()=>command(verified,{type:'request_verification',college_id:otherCampus,kind:'business',detail:'A public shop near the other campus gate.'}),/selected university/);
 const application=await request(verified,'business');
 await db.query('UPDATE profiles SET verified=false WHERE id=$1',[verified]);
 await assert.rejects(()=>command(admin,review(application.id,{review_method:'public_business'})),/Campus verification/);
 await db.query('UPDATE profiles SET verified=true WHERE id=$1',[verified]);
 await command(admin,review(application.id,{review_method:'public_business',reason:'Shop address and public business details checked independently.'}));
 const profile=(await db.query<{role:string;college_id:string}>('SELECT role,college_id FROM profiles WHERE id=$1',[verified])).rows[0];
 assert.deepEqual(profile,{role:'business',college_id:campus});
 const business=(await asUser(verified,()=>db.query<{college_id:string;verified:boolean}>('SELECT college_id,verified FROM business_profiles WHERE owner_id=$1',[verified]))).rows[0];
 assert.deepEqual(business,{college_id:campus,verified:true});
});

test('SQL business approval waits for unfinished student exchanges before changing roles', async()=> {
 const applicant=await user({verified:true}), seller=await user({verified:true});
 const listing=await command(seller,{type:'create_listing',title:'Campus calculator',description:'A working calculator available for a campus pickup.',kind:'sale',category:'Electronics',price:30000,unit:'item',condition:'Good',location:'Main library entrance'});
 const order=await command(applicant,{type:'create_order',listing_id:listing.id});
 const application=await request(applicant,'business');
 await assert.rejects(()=>command(admin,review(application.id,{review_method:'public_business'})),/active student transactions/);
 assert.equal((await db.query<{role:string}>('SELECT role FROM profiles WHERE id=$1',[applicant])).rows[0].role,'student');
 assert.equal((await db.query<{status:string}>('SELECT status FROM verification_requests WHERE id=$1',[application.id])).rows[0].status,'pending');
 await command(applicant,{type:'transition_order',order_id:order.id,status:'cancelled'});
 await command(admin,review(application.id,{review_method:'public_business'}));
 assert.equal((await db.query<{role:string}>('SELECT role FROM profiles WHERE id=$1',[applicant])).rows[0].role,'business');
});

test('SQL preserves historical decisions without inventing reviewer evidence', async()=> {
 const applicant=await user({verified:true}), id=randomUUID();
 await db.query("INSERT INTO verification_requests(id,user_id,college_id,kind,detail,status,reason) VALUES($1,$2,$3,'campus','Legacy independently reviewed enrollment.','approved','Historical campus approval.')",[id,applicant,campus]);
 const row=(await asUser(applicant,()=>db.query<{reviewed_by:string|null;reviewed_at:Date|null;review_method:string|null}>('SELECT reviewed_by,reviewed_at,review_method FROM verification_requests WHERE id=$1',[id]))).rows[0];
 assert.deepEqual(row,{reviewed_by:null,reviewed_at:null,review_method:null});
});

test('SQL closes the legacy bypass while preserving other commands and auditing accidental grants', async()=> {
 const applicant=await user();
 await assert.rejects(()=>asUser(admin,()=>db.query('SELECT app_command_before_verification_reviews($1::jsonb)',[JSON.stringify({type:'read_notifications'})])),/permission denied/);
 await command(applicant,{type:'update_profile',name:'Changed display name',bio:'A short profile.',course:'Engineering',year:'Year 2',role:'admin',verified:true});
 assert.equal((await db.query<{role:string}>('SELECT role FROM profiles WHERE id=$1',[applicant])).rows[0].role,'student');
 const audit=async()=>{await db.exec('SET SESSION AUTHORIZATION verification_runtime;');try{return await auditRuntimeDatabase({query:(sql,params)=>db.query(sql,params)});}finally{await db.exec('SET SESSION AUTHORIZATION postgres;');}};
 assert.equal((await audit()).ok,true);
 for(const role of ['PUBLIC','unicirq_app','verification_runtime']) {
  await db.exec('GRANT EXECUTE ON FUNCTION app_command_before_verification_reviews(jsonb) TO '+role+';');
  try{const report=await audit();const check=report.checks.find(item=>item.name==='protected-function-grants');assert.equal(check?.ok,false);assert.ok(check?.items?.includes('app_command_before_verification_reviews(jsonb)'));}
  finally{await db.exec('REVOKE ALL ON FUNCTION app_command_before_verification_reviews(jsonb) FROM '+role+';');}
 }
});

function demoFixture(){const state=seedState();state.verifications=[];const applicant=state.profiles.find(p=>p.id===ids.unverified)!,admin=state.profiles.find(p=>p.id===ids.admin)!;applicant.college_id=ids.campus;return {state,applicant,admin};}
function demoReview(target_id:string,overrides:Partial<Extract<Command,{type:'moderate'}>>={}):Extract<Command,{type:'moderate'}>{return {type:'moderate',entity:'verification',target_id,decision:'approve',reason:'Enrollment checked independently with the campus office.',review_method:'campus_office',evidence_checked:true,...overrides};}

test('demo mirrors evidence, role, self-review, campus and privacy guards without partial mutation',()=> {
 const {state,applicant,admin}=demoFixture();
 const application=applyCommand(state,applicant,{type:'request_verification',college_id:ids.campus,kind:'campus',detail:'Please review my enrollment with the campus office.'});
 for(const overrides of [{evidence_checked:undefined},{evidence_checked:false},{review_method:undefined},{review_method:'public_business' as const}]) assert.throws(()=>applyCommand(state,admin,demoReview(application.id!,overrides)),/evidence|review method/);
 const outsider=state.profiles.find(p=>p.id===ids.tutor)!;assert.equal(snapshotFor(state,outsider).verifications.length,0);
 assert.throws(()=>applyCommand(state,outsider,demoReview(application.id!)),/access/);
 applicant.role='admin';assert.throws(()=>applyCommand(state,applicant,demoReview(application.id!)),/own verification/);assert.throws(()=>applyCommand(state,admin,demoReview(application.id!)),/active student/);applicant.role='student';
 applicant.suspended=true;assert.throws(()=>applyCommand(state,admin,demoReview(application.id!)),/active student/);applicant.suspended=false;
 applicant.college_id=ids.otherCampus;assert.throws(()=>applyCommand(state,admin,demoReview(application.id!)),/selected university/);applicant.college_id=ids.campus;
 assert.equal(state.verifications[0].status,'pending');assert.equal(state.audit.length,0);assert.equal(applicant.verified,false);
 applyCommand(state,admin,demoReview(application.id!));
 const completed=state.verifications[0];assert.equal(completed.reviewed_by,admin.id);assert.ok(completed.reviewed_at);assert.equal(completed.review_method,'campus_office');assert.equal(applicant.college_id,ids.campus);assert.equal(applicant.verified,true);
 assert.throws(()=>applyCommand(state,admin,demoReview(application.id!)),/Already reviewed/);assert.equal(state.audit.length,1);
});

test('demo business prerequisites and rejected resubmission agree with SQL',()=> {
 const {state,applicant,admin}=demoFixture();
 const request={type:'request_verification',college_id:ids.campus,kind:'business',detail:'A public campus shop with an address and opening hours.'} as const;
 assert.throws(()=>applyCommand(state,applicant,request),/campus verification/);applicant.verified=true;
 assert.throws(()=>applyCommand(state,applicant,{...request,college_id:ids.otherCampus}),/selected university/);
 const first=applyCommand(state,applicant,request);assert.throws(()=>applyCommand(state,applicant,request),/already pending/);
 applyCommand(state,admin,demoReview(first.id!,{decision:'reject',reason:'Please provide public opening hours for an independent check.',review_method:undefined,evidence_checked:undefined}));
 const next=applyCommand(state,applicant,request);assert.equal(state.verifications[0].reviewed_by,null);assert.equal(state.verifications[0].reviewed_at,null);
 // An active exchange must be closed before moving from Student to Business.
 const activeOrder={...state.orders[0],buyer_id:applicant.id};state.orders.push(activeOrder);
 assert.throws(()=>applyCommand(state,admin,demoReview(next.id!,{review_method:'public_business'})),/active student transactions/);state.orders.pop();
 applyCommand(state,admin,demoReview(next.id!,{review_method:'public_business'}));assert.equal(applicant.role,'business');assert.equal(state.businesses.find(b=>b.owner_id===applicant.id)?.college_id,ids.campus);
});

test('verification command schema strips forged reviewer metadata and validates evidence types',()=> {
 const payload=review(randomUUID(),{reviewed_by:randomUUID(),reviewed_at:'2000-01-01T00:00:00Z'}), parsed=commandSchema.parse(payload);
 assert.equal('reviewed_by' in parsed,false);assert.equal('reviewed_at' in parsed,false);
 assert.equal(commandSchema.safeParse({...payload,evidence_checked:'true'}).success,false);
 assert.equal(commandSchema.safeParse({...payload,review_method:'uploaded_document'}).success,false);
});
