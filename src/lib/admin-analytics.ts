import type { Snapshot, Profile, Listing, Order, Ticket, Verification } from './domain';

export interface AnalyticsRow { label: string; detail?: string; values: Record<string, number> }
export interface AnalyticsDatum { label: string; value: number }
export interface AdminAnalytics {
 periodLabel: string; rangeLabel: string; bucketLabel: string;
 window: { start: number; end: number };
 activity: AnalyticsRow[]; listingMix: AnalyticsDatum[]; orderStatus: AnalyticsDatum[];
 verificationStatus: AnalyticsDatum[]; support: AnalyticsRow[]; campuses: AnalyticsRow[];
 totals: { users: number; students: number; verifiedStudents: number; listings: number; orders: number; completedOrders: number; orderValue: number; openTickets: number; pendingVerifications: number };
 scoped: { profiles: Profile[]; listings: Listing[]; orders: Order[]; tickets: Ticket[]; verifications: Verification[] };
}

const dayMilliseconds = 86400000;
const indiaOffset = 330 * 60000;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const indiaDay = (timestamp: number) => Math.floor((timestamp + indiaOffset) / dayMilliseconds);
function dayLabel(day: number, withYear = false) {
 const date = new Date(day * dayMilliseconds);
 return String(date.getUTCDate()) + ' ' + months[date.getUTCMonth()] + (withYear ? ' ' + date.getUTCFullYear() : '');
}
function rangeLabel(first: number, last: number) {
 return dayLabel(first, true) + (first === last ? '' : ' – ' + dayLabel(last, true)) + ' (IST)';
}

// Repository timestamps are ISO instants. Reject missing timezones and normalized
// invalid calendar dates so chart boundaries cannot depend on the server timezone.
function timestamp(value: string): number | undefined {
 if (typeof value !== 'string') return;
 const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
 if (!match) return;
 const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
 if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return;
 const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day);
 if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return;
 const parsed = Date.parse(value);
 return Number.isFinite(parsed) ? parsed : undefined;
}
const requestedValue = (order: Order) => order.status !== 'cancelled' && Number.isSafeInteger(order.amount) && order.amount >= 0 ? order.amount : 0;

export function buildAdminAnalytics(data: Snapshot, filters: { campus: string; days: string }, now: number = Date.now()): AdminAnalytics {
 if (!Number.isFinite(now)) throw new Error('Analytics requires a valid current instant.');
 const today = indiaDay(now);
 const validScoped = <T extends { college_id: string | null; created_at: string }>(rows: T[]) => rows.filter(row => {
  const instant = timestamp(row.created_at);
  return (filters.campus === 'all' || row.college_id === filters.campus) && instant !== undefined && instant <= now;
 });
 const valid = {
  profiles: validScoped(data.profiles), listings: validScoped(data.listings), orders: validScoped(data.orders),
  tickets: validScoped(data.tickets), verifications: validScoped(data.verifications)
 };
 const all = filters.days === 'all';
 const calendarDays = filters.days === '7' ? 7 : 30;
 const loadedDays = Object.values(valid).flatMap(rows => rows.map(row => indiaDay(timestamp(row.created_at)!)));
 const firstDay = all ? (loadedDays.length ? Math.min(today, ...loadedDays) : today - 6) : today - calendarDays + 1;
 const since = <T extends { created_at: string }>(rows: T[]) => rows.filter(row => indiaDay(timestamp(row.created_at)!) >= firstDay);
 const scoped = {
  profiles: since(valid.profiles), listings: since(valid.listings), orders: since(valid.orders),
  tickets: since(valid.tickets), verifications: since(valid.verifications)
 };
 const totalDays = today - firstDay + 1;
 const daysPerBucket = all ? Math.max(1, Math.ceil(totalDays / 12)) : 1;
 const bucketCount = Math.ceil(totalDays / daysPerBucket);
 const activity: AnalyticsRow[] = Array.from({ length: bucketCount }, (_, index) => {
  const first = firstDay + index * daysPerBucket, last = Math.min(today, first + daysPerBucket - 1);
  return { label: dayLabel(first) + (first === last ? '' : ' – ' + dayLabel(last)), detail: rangeLabel(first, last), values: { users: 0, listings: 0, orders: 0, orderValue: 0 } };
 });
 const bucket = (createdAt: string) => activity[Math.floor((indiaDay(timestamp(createdAt)!) - firstDay) / daysPerBucket)].values;
 for (const profile of scoped.profiles) bucket(profile.created_at).users++;
 for (const listing of scoped.listings) bucket(listing.created_at).listings++;
 for (const order of scoped.orders) { const values = bucket(order.created_at); values.orders++; values.orderValue += requestedValue(order); }
 const listingKinds: [Listing['kind'], string][] = [['sale', 'Buy & sell'], ['rental', 'Rentals'], ['hardware', 'Project hardware'], ['service', 'Services']];
 const statuses: [Order['status'], string][] = [['requested', 'Requested'], ['accepted', 'Accepted'], ['handed_over', 'Handed over'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['disputed', 'Disputed']];
 const verificationStatuses: [Verification['status'], string][] = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']];
 const supportTypes: [Ticket['type'], string][] = [['support', 'Support'], ['dispute', 'Disputes'], ['report', 'Reports'], ['managed_sale', 'Managed sales']];
 const students = scoped.profiles.filter(profile => profile.role === 'student');
 return {
  periodLabel: all ? 'All loaded history' : 'Last ' + calendarDays + ' days',
  rangeLabel: rangeLabel(firstDay, today), bucketLabel: daysPerBucket === 1 ? 'Daily' : daysPerBucket + '-day groups',
  window: { start: firstDay * dayMilliseconds - indiaOffset, end: now },
  activity,
  listingMix: listingKinds.map(([kind, label]) => ({ label, value: scoped.listings.filter(listing => listing.kind === kind).length })),
  orderStatus: statuses.map(([status, label]) => ({ label, value: scoped.orders.filter(order => order.status === status).length })),
  verificationStatus: verificationStatuses.map(([status, label]) => ({ label, value: scoped.verifications.filter(verification => verification.status === status).length })),
  support: supportTypes.map(([type, label]) => ({ label, values: { open: scoped.tickets.filter(ticket => ticket.type === type && ticket.status === 'open').length, resolved: scoped.tickets.filter(ticket => ticket.type === type && ticket.status === 'resolved').length } })),
  campuses: data.colleges.filter(college => filters.campus === 'all' || college.id === filters.campus).map(college => ({
   label: college.short_name, detail: college.name, values: { users: scoped.profiles.filter(profile => profile.college_id === college.id).length, listings: scoped.listings.filter(listing => listing.college_id === college.id).length, orders: scoped.orders.filter(order => order.college_id === college.id).length }
  })),
  totals: { users: scoped.profiles.length, students: students.length, verifiedStudents: students.filter(profile => profile.verified).length, listings: scoped.listings.length, orders: scoped.orders.length, completedOrders: scoped.orders.filter(order => order.status === 'completed').length, orderValue: scoped.orders.reduce((sum, order) => sum + requestedValue(order), 0), openTickets: scoped.tickets.filter(ticket => ticket.status === 'open').length, pendingVerifications: scoped.verifications.filter(verification => verification.status === 'pending').length },
  scoped
 };
}
