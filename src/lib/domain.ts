import { z } from 'zod';
export type Role = 'student' | 'business' | 'admin';
export type Kind = 'sale' | 'rental' | 'hardware' | 'service';
export type OrderStatus = 'requested' | 'accepted' | 'handed_over' | 'completed' | 'cancelled' | 'disputed';
export interface College { id:string; name:string; short_name:string; domain:string; city:string }
export interface Profile { id:string; name:string; role:Role; college_id:string|null; verified:boolean; bio:string; course:string; year:string; avatar:string; suspended:boolean; created_at:string }
export interface Listing { id:string; owner_id:string; college_id:string; title:string; description:string; kind:Kind; category:string; price:number; unit:string; condition:string; image:string; location:string; status:'active'|'pending'|'removed'|'closed'; created_at:string }
export interface StudentRequest { id:string; owner_id:string; college_id:string; title:string; description:string; category:string; budget:number; status:'open'|'fulfilled'; created_at:string }
export interface Conversation { id:string; member_a:string; member_b:string; listing_id:string|null; request_id:string|null; created_at:string }
export interface Message { id:string; conversation_id:string; sender_id:string; body:string; created_at:string }
export interface OrderTerms { title:string; description:string; unit:string; price:number; condition:string; location:string; payment_mode:'direct'; protected:false }
export interface Order { id:string; listing_id:string; buyer_id:string; seller_id:string; college_id:string; status:OrderStatus; amount:number; kind:Kind; starts_on:string|null; ends_on:string|null; terms_snapshot:OrderTerms; created_at:string }
export interface OrderEvent { id:string; order_id:string; actor_id:string; status:OrderStatus; created_at:string }
export interface SavedItem { user_id:string; listing_id:string }
export interface Ticket { id:string; owner_id:string; college_id:string|null; order_id:string|null; listing_id:string|null; subject:string; body:string; type:'support'|'dispute'|'report'|'managed_sale'; status:'open'|'resolved'; resolution:string; created_at:string }
export interface Notification { id:string; user_id:string; title:string; body:string; href:string; read:boolean; created_at:string }
export interface Verification { id:string; user_id:string; college_id:string; kind:'campus'|'business'; detail:string; status:'pending'|'approved'|'rejected'; reason:string; created_at:string }
export interface Business { id:string; owner_id:string; college_id:string; name:string; category:string; description:string; location:string; verified:boolean }
export interface Deal { id:string; business_id:string; owner_id:string; college_id:string; title:string; description:string; code:string; expires_on:string; status:'pending'|'active'|'removed'; created_at:string }
export interface Audit { id:string; actor_id:string; action:string; target_id:string; reason:string; created_at:string }
export interface State { colleges:College[]; profiles:Profile[]; listings:Listing[]; requests:StudentRequest[]; conversations:Conversation[]; messages:Message[]; orders:Order[]; orderEvents:OrderEvent[]; saved:SavedItem[]; tickets:Ticket[]; notifications:Notification[]; verifications:Verification[]; businesses:Business[]; deals:Deal[]; audit:Audit[] }
export interface Snapshot extends State { user:Profile; demo:boolean }
const id = z.string().uuid();
const short = z.string().trim().min(3).max(100);
const detail = z.string().trim().min(10).max(2000);
const money = z.number().int().min(0).max(100000000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v, 'Use a valid date');
export const commandSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('create_listing'),title:short,description:detail,kind:z.enum(['sale','rental','hardware','service']),category:short,price:money,unit:z.enum(['item','day','hour','session','project']),condition:z.enum(['Like new','Good','Fair','New','Service']),location:short}).refine(v=>v.kind==='rental'?v.unit==='day':v.kind==='service'?['hour','session','project'].includes(v.unit):v.unit==='item','Choose a valid pricing unit'),
 z.object({type:z.literal('save_listing'),listing_id:id}),
 z.object({type:z.literal('close_listing'),listing_id:id}),
 z.object({type:z.literal('create_request'),title:short,description:detail,category:short,budget:money}),
 z.object({type:z.literal('fulfill_request'),request_id:id}),
 z.object({type:z.literal('start_conversation'),listing_id:id.optional(),request_id:id.optional()}).refine(v=>Boolean(v.listing_id)!==Boolean(v.request_id),'Choose one conversation context'),
 z.object({type:z.literal('start_order_conversation'),order_id:id}),
 z.object({type:z.literal('send_message'),conversation_id:id,body:z.string().trim().min(1).max(2000)}),
 z.object({type:z.literal('create_order'),listing_id:id,starts_on:date.optional(),ends_on:date.optional()}),
 z.object({type:z.literal('transition_order'),order_id:id,status:z.enum(['accepted','handed_over','completed','cancelled'])}),
 z.object({type:z.literal('create_ticket'),subject:short,body:detail,kind:z.enum(['support','dispute','report','managed_sale']),order_id:id.optional(),listing_id:id.optional()}),
 z.object({type:z.literal('update_profile'),name:z.string().trim().min(2).max(60),bio:z.string().trim().max(500),course:z.string().trim().max(80),year:z.string().max(20)}),
 z.object({type:z.literal('request_verification'),college_id:id,kind:z.enum(['campus','business']),detail}),
 z.object({type:z.literal('read_notifications')}),
 z.object({type:z.literal('create_deal'),title:short,description:detail,code:z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9-]+$/),expires_on:date}),
 z.object({type:z.literal('moderate'),entity:z.enum(['listing','deal','verification','ticket']),target_id:id,decision:z.enum(['approve','remove','reject','resolve']),reason:z.string().trim().min(5).max(500)})
]);
export type Command = z.infer<typeof commandSchema>;
export const moneyLabel = (paise:number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2}).format(paise/100);
export const roleHome = (role:Role) => '/'+role;
export const initials = (name:string) => name.split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase();
export const categories = ['Electronics','Books & notes','Room essentials','Cycles & sports','Creative','Project hardware','Tutoring','Freelancing'];
