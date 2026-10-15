import type { Deal, Listing, Snapshot } from './domain';

export type ModerationStatus = 'attention' | 'pending' | 'reported' | 'all' | 'active' | 'removed' | 'closed';
export interface ModerationRow {
  id: string;
  entity: 'listing' | 'deal';
  kind: Listing['kind'] | 'deal';
  title: string;
  description: string;
  college_id: string;
  owner_id: string;
  status: Listing['status'];
  created_at: string;
  openReports: number;
  latestReportAt?: string;
  activityAt: string;
}

// A pending offer or an unresolved listing report needs a human decision.
// Active inventory without reports belongs in the catalogue, not this queue.
export function moderationAttention(data: Snapshot): { listings: Listing[]; deals: Deal[]; count: number } {
  const reported = new Set(data.tickets.filter(ticket => ticket.type === 'report' && ticket.status === 'open' && ticket.listing_id).map(ticket => ticket.listing_id));
  const listings = data.listings.filter(listing => listing.status === 'pending' || reported.has(listing.id));
  const deals = data.deals.filter(deal => deal.status === 'pending');
  return { listings, deals, count: listings.length + deals.length };
}

export function buildModerationWorkspace(data: Snapshot, filters: { campus: string; days: string; status?: ModerationStatus; kind?: string; query?: string; globalSearch?: string }, now = Date.now()) {
  const indiaDay = Math.floor((now + 19800000) / 86400000);
  const since = filters.days === 'all' ? -Infinity : (indiaDay - (filters.days === '7' ? 6 : 29)) * 86400000 - 19800000;
  const validTime = (value: string) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
  const inRange = (value: string) => validTime(value) && Date.parse(value) >= since;
  const reports = new Map<string, { count: number; latest: string; inRange: boolean }>();
  for (const ticket of data.tickets) {
    if (ticket.type !== 'report' || ticket.status !== 'open' || !ticket.listing_id || !validTime(ticket.created_at) || (filters.campus !== 'all' && ticket.college_id !== filters.campus)) continue;
    const previous = reports.get(ticket.listing_id);
    reports.set(ticket.listing_id, { count: (previous?.count ?? 0) + 1, latest: previous && Date.parse(previous.latest) > Date.parse(ticket.created_at) ? previous.latest : ticket.created_at, inRange: Boolean(previous?.inRange) || inRange(ticket.created_at) });
  }
  const scoped: ModerationRow[] = [];
  for (const listing of data.listings) {
    if (!validTime(listing.created_at) || (filters.campus !== 'all' && listing.college_id !== filters.campus)) continue;
    const report = reports.get(listing.id);
    if (!inRange(listing.created_at) && !report?.inRange) continue;
    scoped.push({ ...listing, entity: 'listing', openReports: report?.count ?? 0, latestReportAt: report?.latest, activityAt: report && Date.parse(report.latest) > Date.parse(listing.created_at) ? report.latest : listing.created_at });
  }
  for (const deal of data.deals) {
    if ((filters.campus === 'all' || deal.college_id === filters.campus) && inRange(deal.created_at)) scoped.push({ ...deal, entity: 'deal', kind: 'deal', openReports: 0, activityAt: deal.created_at });
  }
  const people = new Map(data.profiles.map(profile => [profile.id, profile.name]));
  const campuses = new Map(data.colleges.map(campus => [campus.id, `${campus.name} ${campus.short_name}`]));
  const queries = [filters.globalSearch, filters.query].map(query => query?.trim().toLowerCase()).filter(Boolean) as string[];
  const status = filters.status ?? 'attention';
  const records = scoped.filter(record => {
    const statusMatches = status === 'all' || (status === 'attention' ? record.status === 'pending' || record.openReports > 0 : status === 'reported' ? record.openReports > 0 : record.status === status);
    const text = `${record.title} ${record.description} ${people.get(record.owner_id) ?? ''} ${campuses.get(record.college_id) ?? ''} ${record.id}`.toLowerCase();
    return statusMatches && (!filters.kind || filters.kind === 'all' || (filters.kind === 'listing' ? record.entity === 'listing' : record.kind === filters.kind)) && queries.every(query => text.includes(query));
  }).toSorted((a, b) => Number(b.openReports > 0) - Number(a.openReports > 0) || Date.parse(a.activityAt) - Date.parse(b.activityAt) || a.id.localeCompare(b.id));
  return {
    records, scoped,
    attentionCount: scoped.filter(record => record.status === 'pending' || record.openReports > 0).length,
    pendingListingCount: scoped.filter(record => record.entity === 'listing' && record.status === 'pending').length,
    pendingDealCount: scoped.filter(record => record.entity === 'deal' && record.status === 'pending').length,
    reportedListingCount: scoped.filter(record => record.openReports > 0).length,
  };
}

export function moderationDecisions(status: Listing['status'] | Deal['status'], expired = false): ('approve' | 'remove')[] {
  if (status === 'pending') return expired ? ['remove'] : ['approve', 'remove'];
  return status === 'active' ? ['remove'] : [];
}
