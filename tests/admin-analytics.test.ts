import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminAnalytics } from '../src/lib/admin-analytics';
import { seedState, ids } from '../src/lib/seed';
import type { Snapshot, Profile, Listing, Order, Ticket, Verification, State } from '../src/lib/domain';

const seed=seedState();
const now=Date.parse('2026-10-10T04:30:00Z'); // 10 October, 10:00 IST.
const atNow=new Date(now).toISOString();
function snapshot(patch:Partial<State>={}):Snapshot{return {...seed,user:seed.profiles.find(profile=>profile.role==='admin')!,demo:true,profiles:[],listings:[],orders:[],tickets:[],verifications:[],requests:[],conversations:[],messages:[],orderEvents:[],saved:[],notifications:[],businesses:[],deals:[],audit:[],...patch}}
function person(id:string,created_at=atNow,patch:Partial<Profile>={}):Profile{return {...seed.profiles[0],id,created_at,verified:false,...patch}}
function listing(id:string,created_at=atNow,patch:Partial<Listing>={}):Listing{return {...seed.listings[0],id,created_at,...patch}}
function order(id:string,created_at=atNow,patch:Partial<Order>={}):Order{return {...seed.orders[0],id,created_at,kind:'sale',status:'requested',amount:1001,starts_on:null,ends_on:null,...patch}}
function ticket(id:string,created_at=atNow,patch:Partial<Ticket>={}):Ticket{return {...seed.tickets[0],id,created_at,...patch}}
function verification(id:string,created_at=atNow,patch:Partial<Verification>={}):Verification{return {...seed.verifications[0],id,created_at,...patch}}
const sum=(rows:{values:Record<string,number>}[],key:string)=>rows.reduce((total,row)=>total+row.values[key],0);

test('seven days includes today and six previous India calendar days with exact boundaries',()=>{
 const data=snapshot({profiles:[
  person('before','2026-10-03T18:29:59.999Z'),person('first','2026-10-03T18:30:00.000Z'),
  person('now',atNow),person('future',new Date(now+1).toISOString()),person('invalid','not-a-date')
 ]});
 const result=buildAdminAnalytics(data,{campus:'all',days:'7'},now);
 assert.equal(result.activity.length,7);assert.equal(result.activity[0].label,'4 Oct');assert.equal(result.activity.at(-1)!.label,'10 Oct');
 assert.equal(result.periodLabel,'Last 7 days');assert.equal(result.rangeLabel,'4 Oct 2026 – 10 Oct 2026 (IST)');
 assert.deepEqual(result.scoped.profiles.map(profile=>profile.id),['first','now']);
 assert.equal(result.activity[0].values.users,1);assert.equal(result.activity.at(-1)!.values.users,1);
});

test('India midnight and explicit timezone offsets produce the same daily bucket',()=>{
 const instant=Date.parse('2026-10-10T18:31:00Z');
 const data=snapshot({profiles:[person('previous','2026-10-10T18:29:59Z'),person('utc','2026-10-10T18:30:00Z'),person('india','2026-10-11T00:00:00+05:30'),person('western','2026-10-10T14:30:00-04:00')]});
 const result=buildAdminAnalytics(data,{campus:'all',days:'7'},instant);
 assert.equal(result.activity.at(-1)!.label,'11 Oct');assert.equal(result.activity.at(-1)!.values.users,3);
 assert.equal(result.activity.at(-2)!.label,'10 Oct');assert.equal(result.activity.at(-2)!.values.users,1);
 assert.equal(result.totals.users,4);
});

test('thirty days spans a year boundary using calendar days rather than elapsed hours',()=>{
 const instant=Date.parse('2026-01-03T01:00:00Z');
 const result=buildAdminAnalytics(snapshot({listings:[listing('before','2025-12-04T18:29:59Z'),listing('first','2025-12-04T18:30:00Z'),listing('today','2026-01-03T00:00:00Z')]}),{campus:'all',days:'30'},instant);
 assert.equal(result.activity.length,30);assert.equal(result.activity[0].label,'5 Dec');assert.equal(result.activity.at(-1)!.label,'3 Jan');
 assert.equal(result.rangeLabel,'5 Dec 2025 – 3 Jan 2026 (IST)');assert.equal(result.totals.listings,2);assert.equal(result.bucketLabel,'Daily');
});

test('campus and submission cohorts constrain totals and every current-state chart',()=>{
 const data=snapshot({
  profiles:[person('student'),person('verified',atNow,{verified:true}),person('admin',atNow,{role:'admin'}),person('other',atNow,{college_id:ids.otherCampus}),person('unassigned',atNow,{college_id:null})],
  listings:[listing('sale',atNow,{kind:'sale',status:'removed'}),listing('rental',atNow,{kind:'rental',status:'closed'}),listing('hardware',atNow,{kind:'hardware',status:'pending'}),listing('service',atNow,{kind:'service'}),listing('other',atNow,{college_id:ids.otherCampus})],
  orders:[order('complete',atNow,{status:'completed',amount:2500}),order('request'),order('cancelled',atNow,{status:'cancelled',amount:999999}),order('free',atNow,{status:'accepted',amount:0}),order('other',atNow,{college_id:ids.otherCampus,amount:500000})],
  tickets:[ticket('support'),ticket('dispute',atNow,{type:'dispute',status:'resolved'}),ticket('managed',atNow,{type:'managed_sale'}),ticket('other',atNow,{college_id:ids.otherCampus})],
  verifications:[verification('pending'),verification('approved',atNow,{status:'approved'}),verification('other',atNow,{college_id:ids.otherCampus,status:'rejected'})]
 });
 const before=JSON.stringify(data);
 const result=buildAdminAnalytics(data,{campus:ids.campus,days:'7'},now);
 assert.deepEqual(result.totals,{users:3,students:2,verifiedStudents:1,listings:4,orders:4,completedOrders:1,orderValue:3501,openTickets:2,pendingVerifications:1});
 assert.deepEqual(result.listingMix.map(item=>[item.label,item.value]),[['Buy & sell',1],['Rentals',1],['Project hardware',1],['Services',1]]);
 assert.equal(result.orderStatus.length,6);assert.equal(result.orderStatus.find(item=>item.label==='Cancelled')!.value,1);
 assert.deepEqual(result.verificationStatus.map(item=>item.value),[1,1,0]);
 assert.deepEqual(result.support.map(row=>[row.label,row.values]),[['Support',{open:1,resolved:0}],['Disputes',{open:0,resolved:1}],['Reports',{open:0,resolved:0}],['Managed sales',{open:1,resolved:0}]]);
 assert.equal(result.campuses.length,1);assert.deepEqual(result.campuses[0].values,{users:3,listings:4,orders:4});assert.equal(result.campuses[0].label,seed.colleges[0].short_name);
 assert.equal(sum(result.activity,'orders'),4);assert.equal(sum(result.activity,'orderValue'),3501);assert.equal(JSON.stringify(data),before);
});

test('all history starts at the earliest scoped record and caps conserved activity at twelve buckets',()=>{
 const data=snapshot({profiles:[],listings:[],orders:[],tickets:[ticket('old-ticket',new Date(now-60*86400000).toISOString())],verifications:[verification('old-review',new Date(now-65*86400000).toISOString())]});
 for(let offset=0;offset<45;offset++){
  const created=new Date(now-offset*86400000).toISOString();
  data.profiles.push(person('person-'+offset,created));
  data.listings.push(listing('listing-'+offset,created));
  data.orders.push(order('request-'+offset,created,{amount:offset+1}),order('cancelled-'+offset,created,{status:'cancelled',amount:1000000}));
 }
 data.profiles.push(person('outside-scope','2020-01-01T00:00:00Z',{college_id:ids.otherCampus}));
 const result=buildAdminAnalytics(data,{campus:ids.campus,days:'all'},now);
 assert.ok(result.activity.length<=12);assert.ok(result.activity.length>1);
 assert.equal(result.periodLabel,'All loaded history');assert.equal(result.bucketLabel,'6-day groups');
 assert.equal(result.rangeLabel,'6 Aug 2026 – 10 Oct 2026 (IST)');
 assert.equal(result.activity[0].detail,'6 Aug 2026 – 11 Aug 2026 (IST)');
 assert.equal(result.activity.at(-1)!.detail,'5 Oct 2026 – 10 Oct 2026 (IST)');
 assert.equal(sum(result.activity,'users'),45);assert.equal(sum(result.activity,'listings'),45);assert.equal(sum(result.activity,'orders'),90);assert.equal(sum(result.activity,'orderValue'),1035);
 assert.equal(result.totals.orderValue,1035);assert.equal(result.totals.openTickets,1);assert.equal(result.totals.pendingVerifications,1);
});

test('future and invalid timestamps are excluded across all source cohorts',()=>{
 const invalid=['not-a-date','2026-02-30T12:00:00Z','2026-04-31T12:00:00Z','2026-10-10T24:00:00Z','2026-10-10T01:00:00','2026-10-10',new Date(now+1).toISOString()];
 const result=buildAdminAnalytics(snapshot({
  profiles:invalid.map((time,i)=>person('p'+i,time)),listings:invalid.map((time,i)=>listing('l'+i,time)),
  orders:invalid.map((time,i)=>order('o'+i,time)),tickets:invalid.map((time,i)=>ticket('t'+i,time)),verifications:invalid.map((time,i)=>verification('v'+i,time))
 }),{campus:'all',days:'all'},now);
 assert.equal(result.activity.length,7);assert.equal(result.totals.users,0);assert.equal(result.totals.listings,0);assert.equal(result.totals.orders,0);assert.equal(result.totals.openTickets,0);assert.equal(result.totals.pendingVerifications,0);
});

test('empty snapshots provide stable zero charts and the all-history seven-day fallback',()=>{
 const result=buildAdminAnalytics(snapshot(),{campus:'all',days:'all'},now);
 assert.deepEqual(result.totals,{users:0,students:0,verifiedStudents:0,listings:0,orders:0,completedOrders:0,orderValue:0,openTickets:0,pendingVerifications:0});
 assert.equal(result.activity.length,7);assert.equal(result.rangeLabel,'4 Oct 2026 – 10 Oct 2026 (IST)');assert.equal(result.bucketLabel,'Daily');
 for(const row of [...result.activity,...result.support,...result.campuses])for(const value of Object.values(row.values))assert.equal(value,0);
 for(const item of [...result.listingMix,...result.orderStatus,...result.verificationStatus])assert.equal(item.value,0);
 const missing=buildAdminAnalytics(snapshot({profiles:[person('known')]}),{campus:'unsupported-campus',days:'7'},now);assert.equal(missing.totals.users,0);assert.equal(missing.campuses.length,0);
});

test('one-day history handles free requests and rejects malformed money without changing request counts',()=>{
 const result=buildAdminAnalytics(snapshot({orders:[order('free',atNow,{amount:0}),order('invalid',atNow,{amount:Number.NaN}),order('negative',atNow,{amount:-1}),order('cancelled',atNow,{status:'cancelled',amount:12345})]}),{campus:'all',days:'all'},now);
 assert.equal(result.activity.length,1);assert.equal(result.rangeLabel,'10 Oct 2026 (IST)');assert.equal(result.totals.orders,4);assert.equal(result.totals.orderValue,0);
 assert.equal(result.activity[0].values.orders,4);assert.equal(result.activity[0].values.orderValue,0);
});
