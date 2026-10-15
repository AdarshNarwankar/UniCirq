import { buildAdminAnalytics } from './admin-analytics';
import type { Snapshot, Ticket } from './domain';

export const supportTypeLabels: Record<Ticket['type'], string> = {
  support: 'Support request', dispute: 'Dispute', report: 'Community report', managed_sale: 'Managed sale interest',
};
export type SupportTypeFilter = Ticket['type'] | 'all';
export type SupportStatusFilter = Ticket['status'] | 'all';
export function supportTypeFilter(value: string | null): SupportTypeFilter {
  return value === 'support' || value === 'dispute' || value === 'report' || value === 'managed_sale' ? value : 'all';
}
export function supportStatusFilter(value: string | null): SupportStatusFilter {
  return value === 'open' || value === 'resolved' ? value : 'all';
}

export function supportCaseContext(data: Snapshot, ticket: Ticket) {
  const order = data.orders.find(item => item.id === ticket.order_id);
  const listing = data.listings.find(item => item.id === (ticket.listing_id ?? order?.listing_id));
  return {
    owner: data.profiles.find(item => item.id === ticket.owner_id),
    college: data.colleges.find(item => item.id === ticket.college_id),
    order, listing,
    buyer: data.profiles.find(item => item.id === order?.buyer_id),
    seller: data.profiles.find(item => item.id === order?.seller_id),
    events: data.orderEvents.filter(item => item.order_id === order?.id).toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    reviews: data.audit.filter(item => item.target_id === ticket.id && item.action.startsWith('ticket.')).toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
  };
}

export function supportCases(data: Snapshot, filters: { campus: string; days: string; search: string; query: string; type: SupportTypeFilter; status: SupportStatusFilter }, now?: number) {
  const scoped = buildAdminAnalytics(data, filters, now).scoped.tickets;
  const terms = `${filters.search} ${filters.query}`.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const records = scoped.filter(ticket => {
    if (filters.type !== 'all' && ticket.type !== filters.type) return false;
    if (filters.status !== 'all' && ticket.status !== filters.status) return false;
    const context = supportCaseContext(data, ticket);
    const text = [ticket.id, ticket.subject, ticket.body, ticket.resolution, supportTypeLabels[ticket.type], context.owner?.name, context.college?.name, context.college?.short_name, context.listing?.title, context.order?.id, context.order?.terms_snapshot.title].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return { scoped, records };
}
