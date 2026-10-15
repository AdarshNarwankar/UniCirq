import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminPaths, adminCaseHref, isAdminPage, adminRecordPages, adminSearchPages } from '../src/lib/admin-workspaces';
import { buildTrustSafety } from '../src/lib/trust-safety';
import { seedState, ids } from '../src/lib/seed';
import type { Snapshot } from '../src/lib/domain';
const now=Date.parse('2026-10-15T18:00:00Z');
function fixture():Snapshot{const state=seedState();return{...state,user:state.profiles.find(person=>person.id===ids.admin)!,demo:true}}

test('admin queue, catalogue, safety, case inbox and help have distinct guarded destinations',()=>{
 const paths=[adminPaths.catalogue,adminPaths.queue,adminPaths.safety,adminPaths.support,adminPaths.help];
 assert.equal(new Set(paths).size,5);assert.ok(paths.every(path=>!path.includes('#')));
 for(const path of Object.values(adminPaths))assert.equal(isAdminPage(path.slice('/admin'.length).split('/').filter(Boolean)),true);
 for(const path of [['unknown'],['trust-safety','private'],['moderation-queue','extra']])assert.equal(isAdminPage(path),false);
 assert.ok(adminSearchPages.includes(adminPaths.queue)&&adminSearchPages.includes(adminPaths.help));
 assert.ok(adminRecordPages.includes(adminPaths.support)&&!adminRecordPages.includes(adminPaths.help));
 assert.equal(adminCaseHref('case?one','dispute'),'/admin/support?ticket=case%3Fone&type=dispute');
});

test('current safety concerns remain visible when old record creation dates fall outside the period',()=>{
 const data=fixture();const old='2025-01-01T00:00:00Z';
 data.tickets=[{id:'report-one',owner_id:ids.student,college_id:ids.campus,order_id:null,listing_id:data.listings[0].id,subject:'Reported device',body:'A concern to check with the participants.',type:'report',status:'open',resolution:'',created_at:old}];
 data.profiles.find(person=>person.id===ids.seller)!.suspended=true;
 data.orders[0].status='disputed';data.orders[0].created_at=old;
 const result=buildTrustSafety(data,{campus:ids.campus,days:'7',search:''},now);
 assert.equal(result.reports.length,1);assert.equal(result.disputed.length,1);assert.equal(result.suspended.length,1);
 data.tickets[0].status='resolved';assert.equal(buildTrustSafety(data,{campus:'all',days:'all',search:''},now).reports.length,0);
 assert.equal(buildTrustSafety(data,{campus:ids.otherCampus,days:'all',search:''},now).reports.length,0);
 assert.equal(buildTrustSafety(data,{campus:'all',days:'all',search:'unmatched concern'},now).disputed.length,0);
});

test('safety audit history scopes by target campus and decision time without changing any records',()=>{
 const data=fixture(),listing=data.listings[0];
 data.audit=[{id:'recent',actor_id:ids.admin,action:'listing.remove',target_id:listing.id,reason:'Recent recorded decision.',created_at:'2026-10-14T16:00:00Z'},{id:'old',actor_id:ids.admin,action:'listing.approve',target_id:listing.id,reason:'Older recorded decision.',created_at:'2026-01-01T16:00:00Z'},{id:'future',actor_id:ids.admin,action:'listing.remove',target_id:listing.id,reason:'Future invalid event.',created_at:'2027-01-01T00:00:00Z'}];
 const before=structuredClone(data);
 assert.deepEqual(buildTrustSafety(data,{campus:ids.campus,days:'7',search:''},now).audit.map(event=>event.id),['recent']);
 assert.equal(buildTrustSafety(data,{campus:ids.otherCampus,days:'all',search:''},now).audit.length,0);
 assert.equal(buildTrustSafety(data,{campus:'all',days:'all',search:'Older recorded'},now).audit.length,1);
 assert.deepEqual(data,before);
});


test('safety search combines independent terms across member and concern fields',()=>{
 const data=fixture();
 data.profiles.find(person=>person.id===ids.student)!.name='Riya Student';
 data.tickets=[{id:'report-search',owner_id:ids.student,college_id:ids.campus,order_id:null,listing_id:null,subject:'Headphones concern',body:'Please check this item.',type:'report',status:'open',resolution:'',created_at:'2026-10-14T16:00:00Z'}];
 assert.equal(buildTrustSafety(data,{campus:'all',days:'all',search:'Riya headphones'},now).reports.length,1);
 assert.equal(buildTrustSafety(data,{campus:'all',days:'all',search:'Riya calculator'},now).reports.length,0);
});
