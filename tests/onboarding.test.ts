import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { commandSchema } from '../src/lib/domain';
import { applyCommand, snapshotFor } from '../src/lib/demo';
import { seedState, ids, seedId } from '../src/lib/seed';

const db=new PGlite();
const campus=ids.campus,otherCampus=ids.otherCampus;
let nextUser=80;
async function student(overrides:{role?:string;verified?:boolean;college_id?:string|null;suspended?:boolean}={}){
 const id=seedId(2,nextUser++);
 await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[id,'Initial name',id+'@example.test']);
 await db.query('UPDATE profiles SET role=$2,verified=$3,college_id=$4,suspended=$5 WHERE id=$1',[id,overrides.role??'student',overrides.verified??false,overrides.college_id??null,overrides.suspended??false]);
 return id;
}
async function run(userId:string,command:object){
 return db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE unicirq_app');
  await tx.query("SELECT set_config('app.user_id',$1,true)",[userId]);
  const choose=(command as {type?:string}).type==='choose_university';
  const result=await tx.query<{result:{id:string}}>(choose?'SELECT app_choose_university($1::jsonb) AS result':'SELECT unicirq_command($1::jsonb) AS result',[JSON.stringify(command)]);
  return result.rows[0].result;
 });
}
async function profile(id:string){return(await db.query<{college_id:string|null;name:string;role:string;verified:boolean;course:string;year:string}>('SELECT college_id,name,role,verified,course,year FROM profiles WHERE id=$1',[id])).rows[0]}
const choice=(college_id=campus)=>({type:'choose_university',college_id,name:'Campus Student'});
before(async()=>{
 for(const name of(await readdir('database/migrations')).filter(name=>/^\d+_.+\.sql$/.test(name)).sort())await db.exec(await readFile('database/migrations/'+name,'utf8'));
 await db.exec(await readFile('database/seed.example.sql','utf8'));
});
after(async()=>{await db.close()});

test('university command strips privilege fields and validates its small contract',()=>{
 const parsed=commandSchema.parse({...choice(),name:'  Campus Student  ',course:'  Computer Science  ',year:'  1st year  ',role:'admin',verified:true,user_id:ids.admin});
 assert.deepEqual(parsed,{...choice(),name:'Campus Student',course:'Computer Science',year:'1st year'});
 for(const invalid of [{college_id:'invalid-uuid'},{name:'A'},{name:'x'.repeat(61)},{course:'x'.repeat(81)},{year:'x'.repeat(21)}])assert.equal(commandSchema.safeParse({...choice(),...invalid}).success,false);
});

test('SQL choice persists the supported university and display details without verification or role changes',async()=>{
 const id=await student();
 const result=await run(id,{...choice(),name:'  Anaya Rao  ',course:'  Computer Science  ',year:'  1st year  ',role:'admin',verified:true,user_id:ids.admin});
 assert.equal(result.id,id);
 assert.deepEqual(await profile(id),{college_id:campus,name:'Anaya Rao',role:'student',verified:false,course:'Computer Science',year:'1st year'});
 const rows=await db.query('SELECT id FROM verification_requests WHERE user_id=$1',[id]);assert.equal(rows.rows.length,0);
});

test('SQL choice rejects unsupported universities, invalid payloads and missing identities atomically',async()=>{
 const id=await student(),original=await profile(id);
 for(const invalid of [{college_id:'invalid-uuid'},{college_id:seedId(1,99)},{name:'A'},{name:'\t\t'},{name:'\n\t\n'},{name:'x'.repeat(61)},{name:42},{course:null},{course:'x'.repeat(81)},{year:'x'.repeat(21)}]){
  await assert.rejects(()=>run(id,{...choice(),...invalid}));assert.deepEqual(await profile(id),original);
 }
 await assert.rejects(()=>run(seedId(2,999),choice()),/Active student/);
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE unicirq_app');return tx.query('SELECT app_choose_university($1::jsonb)',[JSON.stringify(choice())])}),/Active student/);
});

test('SQL choice rejects business, admin, suspended and already verified profiles',async()=>{
 for(const overrides of [{role:'business'},{role:'admin'},{suspended:true},{verified:true,college_id:campus}]){
  const id=await student(overrides),original=await profile(id);
  await assert.rejects(()=>run(id,choice()),/Active student|already verified/);assert.deepEqual(await profile(id),original);
 }
});

test('SQL choice permits same-campus retries and blocks subsequent campus reassignment',async()=>{
 const id=await student();const a=await run(id,choice()),b=await run(id,choice());assert.equal(a.id,b.id);
 await assert.rejects(()=>run(id,choice(otherCampus)),/already selected/);assert.equal((await profile(id)).college_id,campus);
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE unicirq_app');await tx.query("SELECT set_config('app.user_id',$1,true)",[id]);return tx.query('UPDATE profiles SET college_id=$1 WHERE id=$2',[otherCampus,id])}),/permission denied/);
});

test('serialized concurrent signup choices produce one campus and idempotent retries',async()=>{
 const id=await student();
 const race=await Promise.allSettled([run(id,choice(campus)),run(id,choice(otherCampus))]);
 assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.equal(race.filter(result=>result.status==='rejected').length,1);
 const chosen=(await profile(id)).college_id!;
 const retry=await Promise.all([run(id,choice(chosen)),run(id,choice(chosen))]);assert.equal(retry[0].id,retry[1].id);assert.equal((await profile(id)).college_id,chosen);
});

test('SQL campus verification requires the selected university and leaves onboarding unverified',async()=>{
 const id=await student();
 const verification={type:'request_verification',kind:'campus',college_id:campus,detail:'Enrollment must be independently checked by the campus team.'};
 await assert.rejects(()=>run(id,verification),/selected university/);
 await run(id,choice());
 await assert.rejects(()=>run(id,{...verification,college_id:otherCampus}),/selected university/);
 const requested=await run(id,verification);assert.ok(requested.id);assert.equal((await profile(id)).verified,false);
});

test('SQL initial choice detects legacy pending conflicts and stale campus approval cannot reassign',async()=>{
 const id=await student(),admin=await student({role:'admin',verified:true,college_id:campus});
 await run(id,choice());
 const requested=await run(id,{type:'request_verification',kind:'campus',college_id:campus,detail:'Enrollment needs an independent review by campus operations.'});
 // A trusted operator can maintain legacy profiles; the command cannot exploit it.
 await db.query('UPDATE profiles SET college_id=NULL WHERE id=$1',[id]);
 await assert.rejects(()=>run(id,choice(otherCampus)),/pending verification/);assert.equal((await profile(id)).college_id,null);
 await run(id,choice());
 await db.query('UPDATE profiles SET college_id=$1 WHERE id=$2',[otherCampus,id]);
 await assert.rejects(()=>run(admin,{type:'moderate',entity:'verification',target_id:requested.id,decision:'approve',reason:'Independent enrollment review complete.'}),/selected university/);
 assert.equal((await profile(id)).college_id,otherCampus);assert.equal((await profile(id)).verified,false);
 assert.equal((await db.query<{status:string}>('SELECT status FROM verification_requests WHERE id=$1',[requested.id])).rows[0].status,'pending');
});

test('SQL selected university drives row-policy discovery and catalog reads remain authenticated',async()=>{
 const owner=await student({verified:true,college_id:campus});
 await run(owner,{type:'create_listing',title:'Campus calculator',description:'A working scientific calculator for engineering classes.',kind:'sale',category:'Electronics',price:30000,unit:'item',condition:'Good',location:'Library entrance'});
 const id=await student();await run(id,choice(otherCampus));
 await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE unicirq_app');await tx.query("SELECT set_config('app.user_id',$1,true)",[id]);assert.equal((await tx.query('SELECT id FROM listings')).rows.length,0);assert.equal((await tx.query('SELECT id,name,short_name,city FROM colleges ORDER BY name,city,id')).rows.length,2)});
 await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE unicirq_app');assert.equal((await tx.query('SELECT id FROM colleges')).rows.length,0)});
});

test('demo university choice matches SQL campus, role, validation and verification guards',()=>{
 const state=seedState(),actor=state.profiles.find(p=>p.id===ids.unverified)!;
 // Fresh signups have no pending request; legacy conflict is covered separately.
 state.verifications=state.verifications.filter(v=>v.user_id!==actor.id);
 assert.equal(actor.college_id,null);
 applyCommand(state,actor,{...choice(),type:'choose_university',name:'  Anaya Rao  ',course:'  CSE  '});
 assert.equal(actor.college_id,campus);assert.equal(actor.name,'Anaya Rao');assert.equal(actor.course,'CSE');assert.equal(actor.verified,false);assert.equal(actor.role,'student');
 applyCommand(state,actor,{...choice(),type:'choose_university'});
 assert.throws(()=>applyCommand(state,actor,{...choice(otherCampus),type:'choose_university'}),/already selected/);
 assert.throws(()=>applyCommand(state,actor,{type:'request_verification',kind:'campus',college_id:otherCampus,detail:'Please review my enrollment with the campus office.'}),/selected university/);
 assert.throws(()=>applyCommand(state,state.profiles.find(p=>p.id===ids.business)!,{...choice(),type:'choose_university'}),/access/);
 assert.throws(()=>applyCommand(state,state.profiles.find(p=>p.id===ids.student)!,{...choice(),type:'choose_university'}),/already verified/);
 assert.equal(snapshotFor(state,actor).user.college_id,campus);
});

test('demo pending contradictions and stale verification approval are rejected before mutation',()=>{
 const state=seedState(),actor=state.profiles.find(p=>p.id===ids.unverified)!;
 const request={...state.verifications[0],id:seedId(8,90),user_id:actor.id};state.verifications.push(request);
 assert.throws(()=>applyCommand(state,actor,{...choice(otherCampus),type:'choose_university'}),/pending verification/);assert.equal(actor.college_id,null);
 applyCommand(state,actor,{...choice(),type:'choose_university'});
 actor.college_id=otherCampus;
 assert.throws(()=>applyCommand(state,state.profiles.find(p=>p.id===ids.admin)!,{type:'moderate',entity:'verification',target_id:request.id,decision:'approve',reason:'Independent enrollment review complete.'}),/selected university/);
 assert.equal(request.status,'pending');assert.equal(actor.verified,false);
});
