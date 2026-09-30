import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState,ids,seedId } from '../src/lib/seed';
import { applyCommand,snapshotFor } from '../src/lib/demo';
import { commandSchema, moneyLabel } from '../src/lib/domain';
const command={type:'create_listing' as const,title:'Test listing',description:'A useful item in good condition.',kind:'sale' as const,category:'Electronics',price:120000,unit:'item' as const,condition:'Good' as const,location:'Library entrance'};
test('unverified students and business users cannot publish student listings',()=>{for(const id of [ids.unverified,ids.business]){const s=seedState();assert.throws(()=>applyCommand(s,s.profiles.find(p=>p.id===id)!,command),/verified|Verify|access/)}});
test('student cannot invoke moderation even with a valid target',()=>{const s=seedState();assert.throws(()=>applyCommand(s,s.profiles[0],{type:'moderate',entity:'listing',target_id:s.listings[0].id,decision:'remove',reason:'Pretend moderation'}),/access/);assert.equal(s.listings[0].status,'active')});
test('campus isolation prevents reads and writes',()=>{const s=seedState(),p=s.profiles.find(p=>p.id===ids.outsider)!;assert.equal(snapshotFor(s,p).listings.length,0);assert.throws(()=>applyCommand(s,p,{type:'save_listing',listing_id:s.listings[0].id}),/campus/)});
test('private conversations stay private even to unrelated admins',()=>{const s=seedState();for(const id of [ids.tutor,ids.admin]){const p=s.profiles.find(p=>p.id===id)!;assert.equal(snapshotFor(s,p).messages.length,0);assert.throws(()=>applyCommand(s,p,{type:'send_message',conversation_id:s.conversations[0].id,body:'Unauthorized message'}))}});
test('order transitions reject wrong participant and invalid progression',()=>{const s=seedState(),o=s.orders[0];assert.throws(()=>applyCommand(s,s.profiles[1],{type:'transition_order',order_id:o.id,status:'handed_over'}));assert.throws(()=>applyCommand(s,s.profiles[0],{type:'transition_order',order_id:o.id,status:'completed'}));applyCommand(s,s.profiles[0],{type:'transition_order',order_id:o.id,status:'handed_over'});assert.throws(()=>applyCommand(s,s.profiles[0],{type:'transition_order',order_id:o.id,status:'completed'}));applyCommand(s,s.profiles[1],{type:'transition_order',order_id:o.id,status:'completed'});assert.equal(o.status,'completed')});
test('duplicate purchases and overlapping rentals are rejected',()=>{const s=seedState(),p=s.profiles[0];applyCommand(s,p,{type:'create_order',listing_id:s.listings[0].id});assert.throws(()=>applyCommand(s,p,{type:'create_order',listing_id:s.listings[0].id}),/active request/);assert.throws(()=>applyCommand(s,s.profiles[2],{type:'create_order',listing_id:seedId(3,3),starts_on:s.orders.find(o=>o.kind==='rental')!.starts_on!,ends_on:s.orders.find(o=>o.kind==='rental')!.ends_on!}),/unavailable/)});
test('profile payload cannot grant roles and invalid money is rejected',()=>{const safe=commandSchema.parse({type:'update_profile',name:'Student',bio:'',course:'',year:'',role:'admin',verified:true});assert.equal('role' in safe,false);assert.equal('verified' in safe,false);assert.equal(commandSchema.safeParse({...command,price:-1}).success,false);assert.equal(commandSchema.safeParse({...command,price:5.5}).success,false)});
test('disputes require participant ownership',()=>{const s=seedState();assert.throws(()=>applyCommand(s,s.profiles[2],{type:'create_ticket',kind:'dispute',order_id:s.orders[0].id,subject:'False dispute',body:'Not a participant in this order.'}));applyCommand(s,s.profiles[0],{type:'create_ticket',kind:'dispute',order_id:s.orders[0].id,subject:'Condition mismatch',body:'The camera condition did not match the description.'});assert.equal(s.orders[0].status,'disputed')});
test('moderation stores the actor and reason',()=>{const s=seedState();applyCommand(s,s.profiles.find(p=>p.id===ids.admin)!,{type:'moderate',entity:'listing',target_id:s.listings[0].id,decision:'remove',reason:'Prohibited item confirmed'});assert.equal(s.audit[0].actor_id,ids.admin);assert.equal(s.audit[0].reason,'Prohibited item confirmed')});
test('a negative/invalid rental date is rejected by validation',()=>{assert.equal(commandSchema.safeParse({type:'create_order',listing_id:seedId(3,3),starts_on:'2026-02-30',ends_on:'2026-03-01'}).success,false)});

test('demo activity preserves original terms and records participant events',()=>{
 const s=seedState(),buyer=s.profiles.find(p=>p.id===ids.student)!,seller=s.profiles.find(p=>p.id===ids.seller)!,l=s.listings[0];
 const result=applyCommand(s,buyer,{type:'create_order',listing_id:l.id}),order=s.orders.find(o=>o.id===result.id)!;
 const original=structuredClone(order.terms_snapshot);l.title='Changed after request';l.price=1;l.location='Changed location';
 assert.deepEqual(order.terms_snapshot,original);assert.equal(order.amount,original.price);assert.equal(original.protected,false);
 applyCommand(s,seller,{type:'transition_order',order_id:order.id,status:'accepted'});
 applyCommand(s,buyer,{type:'transition_order',order_id:order.id,status:'handed_over'});
 applyCommand(s,buyer,{type:'transition_order',order_id:order.id,status:'completed'});
 assert.deepEqual(s.orderEvents.filter(e=>e.order_id===order.id).map(e=>[e.status,e.actor_id]),[['requested',buyer.id],['accepted',seller.id],['handed_over',buyer.id],['completed',buyer.id]]);
 for(const id of [ids.tutor,ids.outsider,ids.business,ids.unverified])assert.equal(snapshotFor(s,s.profiles.find(p=>p.id===id)!).orderEvents.length,0);
 assert.equal(snapshotFor(s,buyer).orderEvents.length,6);assert.equal(snapshotFor(s,s.profiles.find(p=>p.id===ids.admin)!).orderEvents.length,6);
});

test('demo existing chat retains closed listing context and rejects new unrelated conversations',()=>{
 const s=seedState(),buyer=s.profiles.find(p=>p.id===ids.student)!,seller=s.profiles.find(p=>p.id===ids.seller)!,listing=s.listings[0];
 applyCommand(s,seller,{type:'close_listing',listing_id:listing.id});
 assert.equal(applyCommand(s,buyer,{type:'start_conversation',listing_id:listing.id}).id,s.conversations[0].id);
 assert.ok(snapshotFor(s,buyer).listings.some(l=>l.id===listing.id));
 assert.equal(snapshotFor(s,s.profiles.find(p=>p.id===ids.tutor)!).listings.some(l=>l.id===listing.id),false);
 assert.throws(()=>applyCommand(s,s.profiles.find(p=>p.id===ids.tutor)!,{type:'start_conversation',listing_id:listing.id}),/available/);
});

test('demo activity chat creates only its exact participants and survives archived inventory',()=>{
 const s=seedState(),buyer=s.profiles.find(p=>p.id===ids.student)!,seller=s.profiles.find(p=>p.id===ids.seller)!,order=s.orders[0];
 applyCommand(s,seller,{type:'close_listing',listing_id:order.listing_id});
 for(const id of [ids.tutor,ids.admin,ids.business,ids.unverified,ids.outsider])assert.throws(()=>applyCommand(s,s.profiles.find(p=>p.id===id)!,{type:'start_order_conversation',order_id:order.id}));
 const a=applyCommand(s,seller,{type:'start_order_conversation',order_id:order.id}),b=applyCommand(s,buyer,{type:'start_order_conversation',order_id:order.id});
 assert.equal(a.id,b.id);const cv=s.conversations.find(c=>c.id===a.id)!;assert.deepEqual([cv.member_a,cv.member_b],[buyer.id,seller.id]);assert.equal(cv.listing_id,order.listing_id);
 assert.equal(applyCommand(s,buyer,{type:'start_conversation',listing_id:order.listing_id}).id,a.id);
 const payload=commandSchema.parse({type:'start_order_conversation',order_id:order.id,member_b:ids.admin});assert.equal('member_b' in payload,false);
 const changedCampus={...buyer,college_id:ids.otherCampus};assert.throws(()=>applyCommand(s,changedCampus,{type:'start_order_conversation',order_id:order.id}),/campus/);
});

test('demo notifications link directly to the affected activity or conversation',()=>{
 const s=seedState(),buyer=s.profiles.find(p=>p.id===ids.student)!,seller=s.profiles.find(p=>p.id===ids.seller)!;
 const result=applyCommand(s,buyer,{type:'create_order',listing_id:s.listings[0].id});assert.equal(s.notifications[0].href,'/student/activity?order='+result.id);
 applyCommand(s,seller,{type:'transition_order',order_id:result.id!,status:'accepted'});assert.equal(s.notifications[0].href,'/student/activity?order='+result.id);
 const cv=s.conversations[0];applyCommand(s,buyer,{type:'send_message',conversation_id:cv.id,body:'Can we meet by the library?'});assert.equal(s.notifications[0].href,'/student/messages?conversation='+cv.id);
});

test('demo disputes append history and non-rental requests discard irrelevant dates',()=>{
 const s=seedState(),buyer=s.profiles.find(p=>p.id===ids.student)!;
 const result=applyCommand(s,buyer,{type:'create_order',listing_id:s.listings[0].id,starts_on:'2030-01-01',ends_on:'2030-01-02'}),order=s.orders.find(o=>o.id===result.id)!;
 assert.equal(order.starts_on,null);assert.equal(order.ends_on,null);
 applyCommand(s,buyer,{type:'create_ticket',kind:'dispute',order_id:order.id,subject:'Listing disagreement',body:'The condition differs from the original description.'});
 assert.deepEqual(s.orderEvents.filter(e=>e.order_id===order.id).map(e=>e.status),['requested','disputed']);
 assert.equal(moneyLabel(1001),'₹10.01');assert.equal(moneyLabel(1000),'₹10');
});
