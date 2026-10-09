import type { Profile, Listing, Order, OrderStatus, Role } from './domain';
export class AppError extends Error { constructor(message:string, public status=400){super(message)} }
export function assert(condition:unknown,message:string,status=403):asserts condition { if(!condition)throw new AppError(message,status) }
export function requireActive(actor:Profile){assert(!actor.suspended,'This account is suspended. Contact support.')}
export function requireRole(actor:Profile,...roles:Role[]){ requireActive(actor); assert(roles.includes(actor.role),'You do not have access to this action.') }
export function requireStudent(actor:Profile){ requireRole(actor,'student'); assert(actor.verified&&actor.college_id,'Verify your campus before taking part.') }
export function requireUniversityChoice(actor:Profile,college:string){requireRole(actor,'student');assert(!actor.verified,'Your university is already verified.',409);assert(!actor.college_id||actor.college_id===college,'Your university is already selected. Contact support to request a change.',409)}
export function requireCampus(actor:Profile,college:string){requireActive(actor); assert(actor.role==='admin'||actor.college_id===college,'This item belongs to another campus.')}
export function visibleListing(actor:Profile,listing:Listing|undefined):asserts listing is Listing {assert(listing,'Listing not found.',404);requireCampus(actor,listing.college_id);assert(listing.status==='active'||listing.owner_id===actor.id||actor.role==='admin','Listing is unavailable.',404)}
export function orderTransition(actor:Profile,order:Order,next:OrderStatus){
 requireStudent(actor); requireCampus(actor,order.college_id);
 assert(actor.id===order.buyer_id||actor.id===order.seller_id,'This activity is private.');
 const seller=actor.id===order.seller_id;
 const ok=(next==='accepted'&&seller&&order.status==='requested')||
   (next==='handed_over'&&!seller&&order.status==='accepted')||
   (next==='completed'&&order.status==='handed_over'&&(order.kind==='rental'?seller:!seller))||
   (next==='cancelled'&&['requested','accepted'].includes(order.status));
 assert(ok,'This activity cannot move to that state.',409);
}
