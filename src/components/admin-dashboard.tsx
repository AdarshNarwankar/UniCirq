'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowRight, Box, CalendarDays, ChartNoAxesCombined, Check, ClipboardCheck, Clock3, Flag, LifeBuoy, LockKeyhole, MapPin, ShieldCheck, Store, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useApp } from './provider';
import { Modal } from './primitives';
import { VerificationReview } from './verification-review';
import { moneyLabel } from '@/lib/domain';
import { adminPaths, adminRecordPages } from '@/lib/admin-workspaces';
import { moderationAttention } from '@/lib/moderation-workspace';
import { buildAdminAnalytics } from '@/lib/admin-analytics';
import { AdminFilters, useAdminFilters } from './admin-filters';
import { BarChart, TrendChart } from './admin-charts';
import { activitySeries, AnalyticsCoverage, campusSeries } from './admin-analytics';
import { WorkspaceShell } from './workspace-shell';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data } = useApp();
  const pathname = usePathname();
  const [campus, setCampus] = useState('all'), [days, setDays] = useState('all');
  const filters = adminRecordPages.includes(pathname) ? <>
    <label className="workspace-select"><MapPin size={15} /><select aria-label="Dashboard campus" value={campus} onChange={e => setCampus(e.target.value)}><option value="all">All campuses</option>{data.colleges.map(c => <option key={c.id} value={c.id}>{c.short_name}</option>)}</select></label>
    <label className="workspace-select"><CalendarDays size={15} /><select aria-label="Dashboard period" value={days} onChange={e => setDays(e.target.value)}><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
  </> : undefined;
  return <AdminFilters.Provider value={{ campus, days, search: '' }}><WorkspaceShell tools={filters}>{children}</WorkspaceShell></AdminFilters.Provider>;
}
function Panel({ title, subtitle, icon: Icon, count, href, id, children, className = '' }: { title: string; subtitle: string; icon: LucideIcon; count?: number; href?: string; id?: string; children: React.ReactNode; className?: string }) {
  return <section id={id} className={`ops-panel ${className}`}><header className="ops-panel-heading"><div><span className="ops-section-label"><Icon size={15} />{subtitle}</span><h2>{title}{count !== undefined && <span className="ops-count">{count}</span>}</h2></div>{href && <Link href={href} aria-label={`View all ${title.toLowerCase()}`}><ArrowRight size={19} /></Link>}</header>{children}</section>;
}
function Quiet({ children }: { children: React.ReactNode }) { return <div className="ops-clear"><span><Check size={20} /></span><p>{children}</p></div>; }
function age(date: string) { const hours = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 3600000)); return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`; }
type Decision = { id: string; title: string };

export function AdminOverview() {
  const { data } = useApp(), filters = useAdminFilters();
  const [tab, setTab] = useState('all'), [decision, setDecision] = useState<Decision | null>(null);
  const analytics = useMemo(() => buildAdminAnalytics(data, { campus: filters.campus, days: filters.days }), [data, filters.campus, filters.days]);
  const { listings, profiles: people, orders, tickets, verifications } = analytics.scoped;
  const pending = verifications.filter(item => item.status === 'pending');
  const open = tickets.filter(item => item.status === 'open');
  const disputes = open.filter(item => item.type === 'dispute');
  const reports = open.filter(item => item.type === 'report');
  const students = people.filter(person => person.role === 'student');
  const verified = students.filter(person => person.verified);
  const campusMatches = (record: { college_id: string | null }) => filters.campus === 'all' || record.college_id === filters.campus;
  const attention = moderationAttention({ ...data, listings: data.listings.filter(campusMatches), deals: data.deals.filter(campusMatches), tickets: data.tickets.filter(campusMatches) });
  const reportedIds = new Set(data.tickets.filter(ticket => ticket.type === 'report' && ticket.status === 'open').map(ticket => ticket.listing_id));
  const queue = attention.listings.filter(listing => tab === 'all' || (tab === 'pending' && listing.status === 'pending') || (tab === 'reported' && reportedIds.has(listing.id))).slice(0, 5);
  const offerQueue = tab === 'reported' ? [] : attention.deals.slice(0, Math.max(0, 5 - queue.length));
  const audit = data.audit.filter(event => filters.campus === 'all' || [...data.listings, ...data.verifications, ...data.tickets, ...data.deals, ...data.profiles].find(record => record.id === event.target_id)?.college_id === filters.campus).filter(event => {
    const instant = Date.parse(event.created_at);
    return Number.isFinite(instant) && instant <= analytics.window.end && (filters.days === 'all' || instant >= analytics.window.start);
  }).toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const campusLabel = filters.campus === 'all' ? 'Every campus' : data.colleges.find(campus => campus.id === filters.campus)?.short_name ?? 'Your campus';
  const workstreams = [
    { number: '01', title: 'Moderation', count: attention.count, detail: 'Submissions and reported content', href: adminPaths.queue, icon: ClipboardCheck },
    { number: '02', title: 'Verification', count: pending.length, detail: 'Campus and business applications', href: '/admin/verifications', icon: ShieldCheck },
    { number: '03', title: 'Member support', count: open.length, detail: 'Questions, disputes and reports', href: '/admin/support?status=open', icon: LifeBuoy },
  ];

  return <div className="ops-overview admin-studio-workspace">
    <header className="ops-masthead"><div><span className="ops-kicker">CAMPUS OPERATIONS <span>/</span> OVERVIEW</span><h1>Keep your campus<br /><em>in good hands.</em></h1><p>A clear place to review, resolve, and help your community move forward.</p></div><div className="ops-scope-stamp"><span><MapPin size={16} />{campusLabel}</span><strong>{analytics.periodLabel}</strong><small>Campus records · India Standard Time</small><Link href="/admin/analytics">Explore the numbers <ArrowRight size={15} /></Link></div></header>

    <section className="ops-workstreams" aria-label="Your review workspaces">{workstreams.map(({ number, title, count, detail, href, icon: Icon }) => <Link href={href} className="ops-workstream" key={title}><span className="ops-workstream-top"><span>{number} / WORKSPACE</span><Icon size={21} /></span><div><h2>{title}</h2><strong>{count.toLocaleString('en-IN')}<small>to review</small></strong></div><footer><span>{detail}</span><span className="ops-link-circle"><ArrowRight size={19} /></span></footer></Link>)}</section>

    <section className="ops-community-strip" aria-label="Campus summary"><div><span>Campus members</span><strong>{people.length.toLocaleString('en-IN')}</strong></div><div><span>Students verified</span><strong>{verified.length.toLocaleString('en-IN')}<small>of {students.length}</small></strong></div><Link href="/admin/moderation"><span>Active listings</span><strong>{listings.filter(item => item.status === 'active').length.toLocaleString('en-IN')}<ArrowRight size={18} /></strong></Link><Link href="/admin/analytics"><span>Requested order value</span><strong>{moneyLabel(orders.filter(order => order.status !== 'cancelled').reduce((sum, order) => sum + order.amount, 0))}</strong><small>Recorded requests, before any payment</small></Link></section>

    <div className="ops-primary-grid">
      <Panel id="moderation" title="The review desk" subtitle="Marketplace moderation" icon={ClipboardCheck} count={attention.count} href={adminPaths.queue} className="ops-review-panel">
        <div className="ops-tabs" aria-label="Filter moderation listings">{[['all', 'All attention', attention.count], ['pending', 'New submissions', attention.listings.filter(item => item.status === 'pending').length + attention.deals.length], ['reported', 'Reported', attention.listings.filter(item => reportedIds.has(item.id)).length]].map(([value, label, count]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(String(value))}>{label}<span>{count}</span></button>)}</div>
        <div className="ops-review-list">{queue.map(listing => <Link href={`${adminPaths.queue}?listing=${listing.id}`} className="ops-review-row" key={listing.id}><span className="ops-thumbnail">{listing.image ? <img src={listing.image} alt="" /> : <Box size={23} />}</span><div><strong>{listing.title}</strong><small>{listing.category} · {age(listing.created_at)}</small></div><span className={`ops-status ${listing.status === 'pending' ? 'pending' : 'reported'}`}>{listing.status === 'pending' ? 'New' : 'Reported'}</span><ArrowRight size={17} /></Link>)}{offerQueue.map(deal => <Link href={`${adminPaths.queue}?deal=${deal.id}`} className="ops-review-row" key={deal.id}><span className="ops-thumbnail"><Store size={23} /></span><div><strong>{deal.title}</strong><small>Business offer · {age(deal.created_at)}</small></div><span className="ops-status pending">New</span><ArrowRight size={17} /></Link>)}{!queue.length && !offerQueue.length && <Quiet>This desk is clear. New submissions and reports will appear here.</Quiet>}</div><Link className="ops-panel-action" href={adminPaths.queue}>Open moderation workspace <ArrowRight size={15} /></Link>
      </Panel>
      <Panel id="analytics" title="A community in motion" subtitle={`${analytics.periodLabel} · ${analytics.bucketLabel}`} icon={ChartNoAxesCombined} href="/admin/analytics" className="ops-activity-panel"><div className="ops-chart-summary"><span><strong>{analytics.totals.listings}</strong>new listings</span><span><strong>{analytics.totals.orders}</strong>order requests</span><span><strong>{analytics.totals.users}</strong>new members</span></div><TrendChart title="Campus activity analytics" data={analytics.activity} series={activitySeries} /></Panel>
    </div>

    <div className="ops-secondary-grid">
      <Panel title="People joining the circle" subtitle="Verification applications" icon={Users} count={pending.length} href="/admin/verifications"><div className="ops-applicants">{pending.slice(0, 4).map(application => { const person = data.profiles.find(item => item.id === application.user_id); return <button type="button" className="ops-applicant" key={application.id} onClick={() => setDecision({ id: application.id, title: 'Review verification application' })}><span className="avatar">{person?.avatar ?? 'UC'}</span><span><strong>{person?.name ?? 'Campus member'}</strong><small>{data.colleges.find(campus => campus.id === application.college_id)?.short_name} · {application.kind === 'campus' ? 'Student' : 'Business'}</small></span><ArrowRight size={17} /></button>; })}{!pending.length && <Quiet>No applications are waiting for a review.</Quiet>}</div></Panel>
      <Panel id="safety" title="Community safeguards" subtitle="Trust & safety" icon={ShieldCheck} href={adminPaths.safety}><div className="ops-safety-list">{[{ title: 'Community reports', count: reports.length, href: '/admin/trust-safety?view=reports', icon: Flag }, { title: 'Restricted accounts', count: people.filter(person => person.suspended).length, href: '/admin/trust-safety?view=accounts', icon: LockKeyhole }, { title: 'Open dispute cases', count: disputes.length, href: '/admin/support?type=dispute&status=open', icon: Wallet }].map(({ title, count, href, icon: Icon }) => <Link href={href} key={title}><Icon size={18} /><span>{title}</span><strong>{count}</strong><ArrowRight size={15} /></Link>)}</div><p className="ops-panel-note">Signals from submitted reports and recorded account activity.</p></Panel>
      <Panel title="A record of every decision" subtitle="Recent admin activity" icon={Clock3} href="/admin/audit"><ol className="ops-audit-list">{audit.slice(0, 4).map(event => <li key={event.id}><span className="ops-audit-point" /><div><strong>{event.action.replaceAll('_', ' ').replaceAll('.', ' · ')}</strong><small>{data.profiles.find(person => person.id === event.actor_id)?.name ?? 'Administrator'}</small></div><time dateTime={event.created_at}>{age(event.created_at)}</time></li>)}</ol>{!audit.length && <Quiet>Review decisions will appear here with their author and reason.</Quiet>}</Panel>
    </div>
    <section className="ops-campus-band"><div><span className="ops-section-label"><Store size={15} />Across your campuses</span><h2>See where the connection happens.</h2><p>Compare the members, listings and requests created in your selected period.</p><Link className="text-link" href="/admin/analytics#campuses">Campus insights <ArrowRight size={16} /></Link></div><BarChart title="Campus performance" data={analytics.campuses} series={campusSeries} compact /></section>
    <AnalyticsCoverage demo={data.demo} />
    {decision && <Modal title={decision.title} onClose={() => setDecision(null)}><VerificationReview id={decision.id} /></Modal>}
  </div>;
}
