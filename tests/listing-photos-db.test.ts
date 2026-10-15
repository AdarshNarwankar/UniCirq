import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { auditRuntimeDatabase } from '../src/lib/database-readiness';

// An isolated PostgreSQL engine; never reads environment files or hosted records.
const db = new PGlite();
const campus = randomUUID(), otherCampus = randomUUID();
let seller: string, peer: string, outsider: string, admin: string;
// Database guards validate the bounded RIFF container. The server's image decoder
// separately validates and normalizes real image pixels before this entry point.
function webp(length = 24) {
 const bytes = Buffer.alloc(length);
 bytes.write('RIFF'); bytes.writeUInt32LE(length - 8, 4); bytes.write('WEBP', 8);
 return bytes;
}
async function user(values: {role?:string; verified?:boolean; suspended?:boolean; college_id?:string|null} = {}) {
 const id = randomUUID();
 await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [id,'Photo test member',id+'@example.test']);
 await db.query('UPDATE profiles SET role=$2,verified=$3,suspended=$4,college_id=$5 WHERE id=$1', [id,values.role??'student',values.verified??true,values.suspended??false,values.college_id===undefined?campus:values.college_id]);
 return id;
}
async function asUser<T>(id:string|null, work:()=>Promise<T>):Promise<T> {
 await db.exec('BEGIN; SET LOCAL ROLE unicirq_app;');
 try { if(id)await db.query("SELECT set_config('app.user_id',$1,true)",[id]); const result=await work(); await db.exec('COMMIT'); return result; }
 catch(error) { await db.exec('ROLLBACK'); throw error; }
}
const input = (overrides:Record<string,unknown>={}) => ({type:'create_listing',title:'Campus camera case',description:'A padded camera case available for a campus pickup.',kind:'sale',category:'Electronics',price:30000,unit:'item',condition:'Good',location:'Main library entrance',...overrides});
async function create(id:string|null, command:object=input(), bytes:Uint8Array|null=webp()) {
 return asUser(id,async()=> (await db.query<{result:{id:string}}>('SELECT app_create_listing_with_photo($1::jsonb,$2::bytea) AS result',[JSON.stringify(command),bytes])).rows[0].result);
}
async function command(id:string, payload:object) {
 return asUser(id,async()=> (await db.query<{result:{id:string}}>('SELECT unicirq_command($1::jsonb) AS result',[JSON.stringify(payload)])).rows[0].result);
}
async function visible(id:string|null, listing:string) {
 return asUser(id,()=>db.query<{listing_id:string;bytes:Uint8Array;content_type:string}>('SELECT listing_id,bytes,content_type FROM listing_photos WHERE listing_id=$1',[listing]));
}
async function runtimeAudit() {
 await db.exec('SET SESSION AUTHORIZATION photo_runtime;');
 try { return await auditRuntimeDatabase({query:(sql,params)=>db.query(sql,params)}); }
 finally { await db.exec('SET SESSION AUTHORIZATION postgres;'); }
}
before(async()=> {
 for(const file of (await readdir('database/migrations')).filter(name=>/^\d+_.+\.sql$/.test(name)).sort()) await db.exec(await readFile('database/migrations/'+file,'utf8'));
 for(const [id,name] of [[campus,'Photo test campus'],[otherCampus,'Other photo campus']]) await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$2,$3,$4)',[id,name,id+'.example.test','Test city']);
 seller=await user(); peer=await user(); outsider=await user({college_id:otherCampus}); admin=await user({role:'admin'});
 await db.exec(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  CREATE ROLE photo_runtime LOGIN;
  GRANT USAGE ON SCHEMA public TO photo_runtime;
  GRANT SELECT,INSERT,UPDATE,DELETE ON "user","session",account,verification,"rateLimit" TO photo_runtime;
  GRANT unicirq_app TO photo_runtime;`);
});
after(async()=>{ await db.close(); });

test('photo creation owns listing identity, campus and image URL and stores bytes outside metadata', async()=> {
 const listing=await create(seller,input({owner_id:admin,college_id:otherCampus,image:'https://untrusted.example/track'}));
 const metadata=(await db.query<{owner_id:string;college_id:string;image:string}>('SELECT owner_id,college_id,image FROM listings WHERE id=$1',[listing.id])).rows[0];
 assert.deepEqual(metadata,{owner_id:seller,college_id:campus,image:'/api/listings/'+listing.id+'/image'});
 const photo=(await visible(seller,listing.id)).rows[0];
 assert.equal(photo.content_type,'image/webp'); assert.deepEqual(Buffer.from(photo.bytes),webp());
 assert.equal((await visible(peer,listing.id)).rows.length,1); assert.equal((await visible(admin,listing.id)).rows.length,1);
 assert.equal((await visible(outsider,listing.id)).rows.length,0); assert.equal((await visible(null,listing.id)).rows.length,0);
});

test('photo entry point rejects anonymous, suspended, unverified, missing-campus and non-student actors', async()=> {
 for(const actor of [null,await user({suspended:true}),await user({verified:false}),await user({college_id:null,verified:false}),admin,await user({role:'business'})]) {
  await assert.rejects(()=>create(actor),/active account|Verified student/);
 }
});

test('archived photo reads follow listing ownership, order and conversation privacy', async()=> {
 const owner=await user(), buyer=await user(), member=await user();
 const listing=await create(owner);
 await command(buyer,{type:'create_order',listing_id:listing.id});
 await command(member,{type:'start_conversation',listing_id:listing.id});
 await command(owner,{type:'close_listing',listing_id:listing.id});
 for(const actor of [owner,buyer,member,admin]) assert.equal((await visible(actor,listing.id)).rows.length,1);
 for(const actor of [peer,outsider,null]) assert.equal((await visible(actor,listing.id)).rows.length,0);
 await db.query('UPDATE profiles SET suspended=true WHERE id=$1',[member]);
 assert.equal((await visible(member,listing.id)).rows.length,0);
 await db.query('UPDATE profiles SET college_id=$1 WHERE id=$2',[otherCampus,buyer]);
 assert.equal((await visible(buyer,listing.id)).rows.length,0);
});

test('pending and removed photos are hidden from campus browsers while owners and admins retain access', async()=> {
 const listing=await create(seller);
 for(const status of ['pending','removed']) {
  await db.query('UPDATE listings SET status=$2 WHERE id=$1',[listing.id,status]);
  assert.equal((await visible(peer,listing.id)).rows.length,0);
  assert.equal((await visible(seller,listing.id)).rows.length,1);
  assert.equal((await visible(admin,listing.id)).rows.length,1);
 }
 const suspended=await user({suspended:true}); assert.equal((await visible(suspended,listing.id)).rows.length,0);
});

test('photo API rejects non-listing commands, oversize, null, short, bad magic and incorrect RIFF size without inserts', async()=> {
 const owner=await user();
 const malformed=webp(); malformed.write('NOPE');
 const wrongFormat=webp(); wrongFormat.write('JPEG',8);
 const wrongSize=webp(); wrongSize.writeUInt32LE(0,4);
 for(const bytes of [null,Buffer.alloc(0),Buffer.alloc(11),webp(819201),malformed,wrongFormat,wrongSize]) await assert.rejects(()=>create(owner,input(),bytes),/Photo must/);
 for(const payload of [{type:'read_notifications'},input({type:undefined}),input({type:'moderate'}),input({kind:'unsupported'})]) await assert.rejects(()=>create(owner,payload),/Only listing|check constraint/);
 assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM listings WHERE owner_id=$1',[owner])).rows[0].count,0);
});

test('listing and rate-counter changes roll back if photo attachment fails', async()=> {
 const owner=await user();
 await db.exec(`CREATE FUNCTION reject_photo_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated photo persistence failure'; END $$;
  CREATE TRIGGER reject_photo_for_test BEFORE INSERT ON listing_photos FOR EACH ROW EXECUTE FUNCTION reject_photo_for_test();`);
 try { await assert.rejects(()=>create(owner),/Simulated photo persistence failure/); }
 finally { await db.exec('DROP TRIGGER reject_photo_for_test ON listing_photos; DROP FUNCTION reject_photo_for_test();'); }
 assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM listings WHERE owner_id=$1',[owner])).rows[0].count,0);
 assert.equal((await db.query('SELECT * FROM action_limits WHERE user_id=$1',[owner])).rows.length,0);
});

test('rolling photo quota permits twenty per member and resets after twenty-four hours', async()=> {
 const owner=await user();
 for(let index=0;index<20;index++) await create(owner,input({title:'Campus camera case '+index}));
 await assert.rejects(()=>create(owner),/Daily photo limit/);
 assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM listings WHERE owner_id=$1',[owner])).rows[0].count,20);
 // Metadata-only listings remain independent of the image storage quota.
 await command(owner,input());
 await db.query("UPDATE listing_photos SET created_at=now()-interval '25 hours' WHERE listing_id IN(SELECT id FROM listings WHERE owner_id=$1)",[owner]);
 await create(owner); await create(await user());
});

test('runtime cannot write photo rows and deleting a listing cascades its photo', async()=> {
 const listing=await create(seller);
 for(const sql of ['UPDATE listing_photos SET bytes=$2 WHERE listing_id=$1','INSERT INTO listing_photos(listing_id,bytes) VALUES($1,$2)','DELETE FROM listing_photos WHERE listing_id=$1 AND $2::bytea IS NOT NULL']) {
  await assert.rejects(()=>asUser(seller,()=>db.query(sql,[listing.id,webp()])),/permission denied/);
 }
 await db.query('DELETE FROM listings WHERE id=$1',[listing.id]);
 assert.equal((await db.query('SELECT * FROM listing_photos WHERE listing_id=$1',[listing.id])).rows.length,0);
});

test('readiness verifies photo RLS, definer search path and restricted function grants', async()=> {
 assert.equal((await runtimeAudit()).ok,true);
 await db.exec('ALTER TABLE listing_photos DISABLE ROW LEVEL SECURITY;');
 try { assert.equal((await runtimeAudit()).checks.find(check=>check.name==='application-row-security')?.ok,false); }
 finally { await db.exec('ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;'); }
 await db.exec('ALTER FUNCTION app_create_listing_with_photo(jsonb,bytea) SET search_path=public;');
 try { assert.equal((await runtimeAudit()).checks.find(check=>check.name==='protected-function-grants')?.ok,false); }
 finally { await db.exec('ALTER FUNCTION app_create_listing_with_photo(jsonb,bytea) SET search_path=public,pg_temp;'); }
 await db.exec('GRANT EXECUTE ON FUNCTION app_create_listing_with_photo(jsonb,bytea) TO PUBLIC;');
 try { assert.equal((await runtimeAudit()).checks.find(check=>check.name==='protected-function-grants')?.ok,false); }
 finally { await db.exec('REVOKE ALL ON FUNCTION app_create_listing_with_photo(jsonb,bytea) FROM PUBLIC;'); }
 await db.exec('GRANT UPDATE(bytes) ON listing_photos TO photo_runtime;');
 try { assert.equal((await runtimeAudit()).checks.find(check=>check.name==='application-write-grants')?.ok,false); }
 finally { await db.exec('REVOKE UPDATE(bytes) ON listing_photos FROM photo_runtime;'); }
});
