import type { Snapshot } from './domain';
import { buildAdminAnalytics } from './admin-analytics';

// Outstanding work is scoped by campus, not the account/listing creation date.
// Date filters apply to the decision log; current unresolved risks stay visible.
export function buildTrustSafety(data: Snapshot, filters: { campus: string; days: string; search: string }, now = Date.now()) {
  const terms = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const inCampus = (row: { college_id: string | null }) => filters.campus === 'all' || row.college_id === filters.campus;
  const matches = (...values: (string | undefined)[]) => {
    const text = values.filter(Boolean).join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  };
  const person = (id: string) => data.profiles.find(profile => profile.id === id);
  const reports = data.tickets.filter(ticket => ticket.type === 'report' && ticket.status === 'open' && inCampus(ticket) && matches(ticket.subject, ticket.body, ticket.id, person(ticket.owner_id)?.name));
  const suspended = data.profiles.filter(profile => profile.suspended && inCampus(profile) && matches(profile.name, profile.id, profile.role));
  const disputed = data.orders.filter(order => order.status === 'disputed' && inCampus(order) && matches(order.terms_snapshot.title, order.id, person(order.buyer_id)?.name, person(order.seller_id)?.name));
  const pendingListings = data.listings.filter(listing => listing.status === 'pending' && inCampus(listing) && matches(listing.title, listing.id, person(listing.owner_id)?.name));
  const pendingDeals = data.deals.filter(deal => deal.status === 'pending' && inCampus(deal) && matches(deal.title, deal.id, person(deal.owner_id)?.name));
  const pendingVerifications = data.verifications.filter(request => request.status === 'pending' && inCampus(request) && matches(request.id, request.kind, person(request.user_id)?.name));
  const window = buildAdminAnalytics(data, { campus: filters.campus, days: filters.days }, now).window;
  const targets = [...data.listings, ...data.deals, ...data.tickets, ...data.verifications, ...data.profiles];
  const audit = data.audit.filter(event => {
    const time = Date.parse(event.created_at), target = targets.find(record => record.id === event.target_id);
    return (filters.campus === 'all' || Boolean(target && inCampus(target))) && Number.isFinite(time) && time <= now &&
      (filters.days === 'all' || time >= window.start) && matches(event.action, event.reason, event.target_id, person(event.actor_id)?.name);
  }).toSorted((a, b) => b.created_at.localeCompare(a.created_at));
  return { reports, suspended, disputed, pendingListings, pendingDeals, pendingVerifications, audit };
}
