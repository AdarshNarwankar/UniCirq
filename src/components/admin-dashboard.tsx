'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, Box, CalendarDays, ChartNoAxesCombined, Check, ChevronRight, CircleHelp, ClipboardCheck, Clock3, FileClock, Flag, LayoutDashboard, LifeBuoy, LockKeyhole, LogOut, MapPin, Menu, MessageSquare, Search, Settings, ShieldCheck, ShoppingBag, Store, TriangleAlert, Users, Wallet, X, type LucideIcon } from 'lucide-react';
import { useApp } from './provider';
import { Modal } from './primitives';
import { VerificationReview } from './verification-review';
import { moneyLabel } from '@/lib/domain';
import { adminPaths, adminCaseHref, adminRecordPages } from '@/lib/admin-workspaces';
import { moderationAttention } from '@/lib/moderation-workspace';
import { buildAdminAnalytics } from '@/lib/admin-analytics';
import { AdminFilters, useAdminFilters } from './admin-filters';
import { BarChart, DonutChart, TrendChart } from './admin-charts';
import { activitySeries, AnalyticsCoverage, campusSeries } from './admin-analytics';
import { ThemeToggle } from './theme';

const sections = [
  { title: 'OPERATIONS', links: [
    { label: 'Student verification', href: '/admin/verifications', icon: ClipboardCheck },
    { label: 'Listings & services', href: '/admin/moderation', icon: ShoppingBag },
    { label: 'Campus performance', href: '/admin/analytics#campuses', icon: Store },
    { label: 'Disputes & support', href: '/admin/support', icon: LifeBuoy },
  ] },
  { title: 'MONITORING', links: [
    { label: 'Moderation queue', href: adminPaths.queue, icon: Flag },
    { label: 'Trust & safety', href: adminPaths.safety, icon: ShieldCheck },
    { label: 'Activity analytics', href: '/admin/analytics', icon: ChartNoAxesCombined },
    { label: 'Audit log', href: '/admin/audit', icon: FileClock },
    { label: 'Notifications', href: '/admin/notifications', icon: Bell },
  ] },
  { title: 'ADMIN', links: [
    { label: 'My account', href: '/admin/profile', icon: Users },
    { label: 'Settings', href: '/admin/settings', icon: Settings },
    { label: 'Support center', href: adminPaths.help, icon: CircleHelp },
  ] },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data, toast } = useApp();
  const pathname = usePathname();
  const [open, setOpen] = useState(false), [campus, setCampus] = useState('all'), [days, setDays] = useState('all');
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const unread = data.notifications.filter(n => !n.read).length;
  const pending = moderationAttention(data).count;
  return <AdminFilters.Provider value={{ campus, days, search: '' }}><div className="control-center">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {open && <button className="admin-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside id="admin-navigation" className={`admin-sidebar ${open ? 'is-open' : ''}`} aria-label="Admin sidebar">
      <Link href="/admin" className="admin-brand" onClick={() => setOpen(false)}><span className="circle-mark" /><span>UniCirq<small>Admin Control Center</small></span></Link>
      <button className="admin-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={20} /></button>
      <nav aria-label="Admin navigation"><Link onClick={() => setOpen(false)} href="/admin" className={`admin-nav-link ${pathname === '/admin' ? 'selected' : ''}`} aria-current={pathname === '/admin' ? 'page' : undefined}><LayoutDashboard size={18} />Dashboard</Link>
        {sections.map(section => <div className="admin-nav-group" key={section.title}><span>{section.title}</span>{section.links.map(({ href, label, icon: Icon }) => <Link key={label} href={href} onClick={() => setOpen(false)} className={`admin-nav-link ${pathname === href ? 'selected' : ''}`} aria-current={pathname === href ? 'page' : undefined}><Icon size={17} />{label}{label === 'Moderation queue' && pending > 0 && <b>{pending}</b>}{label === 'Notifications' && unread > 0 && <b>{unread}</b>}</Link>)}</div>)}
      </nav>
      <div className="admin-sidebar-help"><span className="help-orbit"><ShieldCheck size={27} /></span><strong>A safer campus circle.</strong><p>Review with care. Keep your community connected.</p><Link href={adminPaths.help} onClick={() => setOpen(false)}>Open support center <ArrowRight size={13} /></Link></div>
      <button className="admin-signout" onClick={async () => { try { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); if (!response.ok) throw new Error(); window.location.assign('/login'); } catch { toast('Unable to sign out. Please try again.'); } }}><LogOut size={15} />Sign out</button>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar">
      <button className="admin-menu" aria-label="Open navigation" aria-controls="admin-navigation" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={21} /></button>
      {adminRecordPages.includes(pathname) && <><label className="admin-select"><MapPin size={16} /><select aria-label="Dashboard campus" value={campus} onChange={e => { setCampus(e.target.value); }}><option value="all">All campuses</option>{data.colleges.map(c => <option key={c.id} value={c.id}>{c.short_name}</option>)}</select></label>
      <label className="admin-select period-select"><CalendarDays size={16} /><select aria-label="Dashboard period" value={days} onChange={e => { setDays(e.target.value); }}><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label></>}
      <ThemeToggle />
      <Link className="admin-bell" href="/admin/notifications" aria-label={`Notifications, ${unread} unread`}><Bell size={21} />{unread > 0 && <b>{unread}</b>}</Link>
      <Link href="/admin/profile" className="admin-user"><span className="avatar">{data.user.avatar}</span><span><strong>{data.user.name}</strong><small>Administrator</small></span></Link>
    </header>
    {data.demo && <div className="admin-demo"><span><i />LOCAL DEMO <span>· Sample campus data</span></span><Link href="/login">Switch account <ArrowRight size={12} /></Link></div>}
    <main id="main-content" className="admin-main">{children}</main><footer className="admin-footer"><span>UniCirq — Your Campus, Connected.</span><span>Campus operations workspace</span></footer></div>
  </div></AdminFilters.Provider>;
}

function Panel({ title, subtitle, icon: Icon, count, href, id, children, className = '' }: { title: string; subtitle: string; icon: LucideIcon; count?: number; href?: string; id?: string; children: React.ReactNode; className?: string }) {
  return <section id={id} className={`control-panel ${className}`}><header><Icon size={21} /><div><h2>{title}{count !== undefined && <span className="count-dot">{count}</span>}</h2><p>{subtitle}</p></div>{href && <Link href={href}>View all <ArrowRight size={12} /></Link>}</header>{children}</section>;
}
function Quiet({ children }: { children: React.ReactNode }) { return <div className="admin-quiet"><Check size={20} /><p>{children}</p></div>; }
function age(date: string) { const hours = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 3600000)); return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`; }
type Decision = { id: string; title: string };

export function AdminOverview() {
  const { data } = useApp(), filters = useAdminFilters();
  const [tab, setTab] = useState('all'), [decision, setDecision] = useState<Decision | null>(null);
  const analytics = useMemo(() => buildAdminAnalytics(data, { campus: filters.campus, days: filters.days }), [data, filters.campus, filters.days]);
  const { listings, profiles: people, orders, tickets, verifications } = analytics.scoped;
  const pending = verifications.filter(v => v.status === 'pending'), open = tickets.filter(t => t.status === 'open'), disputes = open.filter(t => t.type === 'dispute');
  const reports = open.filter(t => t.type === 'report'), held = listings.filter(l => l.status === 'pending');
  const students = people.filter(p => p.role === 'student'), verified = students.filter(p => p.verified);
  const audit = data.audit.filter(a => filters.campus === 'all' || [...data.listings, ...data.verifications, ...data.tickets, ...data.deals, ...data.profiles].find(record => record.id === a.target_id)?.college_id === filters.campus).filter(a => {
    const instant = Date.parse(a.created_at);
    return Number.isFinite(instant) && instant <= analytics.window.end && (filters.days === 'all' || instant >= analytics.window.start);
  });
  const q = filters.search.toLowerCase();
  const campusMatches = (record: {college_id:string|null}) => filters.campus === 'all' || record.college_id === filters.campus;
  const attention = moderationAttention({...data, listings:data.listings.filter(campusMatches), deals:data.deals.filter(campusMatches), tickets:data.tickets.filter(campusMatches)});
  const reportedIds = new Set(data.tickets.filter(ticket=>ticket.type==='report'&&ticket.status==='open').map(ticket=>ticket.listing_id));
  const queue = attention.listings.filter(listing=>(tab==='all'||(tab==='pending'&&listing.status==='pending')||(tab==='reported'&&reportedIds.has(listing.id)))&&(!q||`${listing.title} ${data.profiles.find(person=>person.id===listing.owner_id)?.name}`.toLowerCase().includes(q))).slice(0,5);
  const offerQueue = tab==='reported'?[]:attention.deals.filter(deal=>!q||deal.title.toLowerCase().includes(q)).slice(0,Math.max(0,5-queue.length));
  const metrics: { label: string; value: string | number; note: string; icon: LucideIcon; tone: string; href?: string }[] = [
    { label: 'Total users', value: people.length, note: 'In selected campus scope', icon: Users, tone: 'blue' },
    { label: 'Verified students', value: verified.length, note: `${students.length ? Math.round(verified.length / students.length * 100) : 0}% verification rate`, icon: ShieldCheck, tone: 'green', href: '/admin/verifications' },
    { label: 'Active listings', value: listings.filter(l => l.status === 'active').length, note: `${held.length} awaiting review`, icon: Box, tone: 'blue', href: '/admin/moderation' },
    { label: 'Rental listings', value: listings.filter(l => l.kind === 'rental' && l.status === 'active').length, note: 'Available on campus', icon: ShoppingBag, tone: 'purple', href: '/admin/moderation' },
    { label: 'Open disputes', value: disputes.length, note: `${open.length} total support cases`, icon: TriangleAlert, tone: 'red', href: '/admin/support?type=dispute&status=open' },
    { label: 'Platform revenue', value: '—', note: 'Payments not connected', icon: Wallet, tone: 'blue' },
    { label: 'Recorded order value', value: moneyLabel(orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.amount, 0)), note: 'Requested value · not GMV', icon: ChartNoAxesCombined, tone: 'blue' },
    { label: 'Open reports', value: reports.length, note: 'Community-reported concerns', icon: Flag, tone: 'red', href: '/admin/trust-safety?view=reports' },
  ];
  return <div className="admin-dashboard">
    <section className="admin-hero"><div><span className="admin-eyebrow">CONNECTED CAMPUSES. STRONGER COMMUNITIES.</span><h1>Admin Control Center</h1><p>A safer campus marketplace starts with you.</p><small>Monitor. Moderate. Verify. Protect. Keep UniCirq safe.</small></div><div className="admin-health"><ShieldCheck size={32} /><div><span>Community safeguards</span><strong>Moderation is enabled</strong></div><div className="health-bottom"><span><LockKeyhole size={15} />Role-protected access</span><span><FileClock size={15} />Audited decisions</span></div></div></section>
    <div className="admin-metrics">{metrics.map(({ label, value, note, icon: Icon, tone, href }) => { const content = <><span className={`metric-icon ${tone}`}><Icon size={23} /></span><div><strong>{value}</strong><span>{label}</span><small>{note}</small></div></>; return href ? <Link key={label} href={href} className="admin-metric">{content}</Link> : <div key={label} className="admin-metric">{content}</div>; })}</div>
    <AnalyticsCoverage demo={data.demo} />
    {q && <div className="admin-search-note"><Search size={16} />Showing matching listings, verification requests and support cases for “{filters.search}”.</div>}
    <div className="admin-panel-grid">
      <Panel id="moderation" title="Moderation queue" subtitle="Pending content and community-reported listings" icon={ClipboardCheck} count={attention.count} href={adminPaths.queue} className="queue-panel">
        <div className="admin-tabs" aria-label="Filter moderation listings">{[['all', 'All', attention.count], ['pending', 'Pending', attention.listings.filter(item=>item.status==='pending').length+attention.deals.length], ['reported', 'Reported', attention.listings.filter(item=>reportedIds.has(item.id)).length]].map(([value, label, count]) => <button key={value} aria-pressed={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(String(value))}>{label}<span>{count}</span></button>)}</div>
        <div className="admin-records">{queue.map(l => <div className="listing-review-row" key={l.id}><div className="review-thumb">{l.image ? <img src={l.image} alt="" /> : <Box size={21} />}</div><div className="record-title"><strong>{l.title}</strong><small>{l.category} <span>· {l.kind}</span></small></div><span className={`admin-tag ${l.status === 'pending' ? 'amber' : l.status === 'removed' ? 'red' : l.status === 'closed' ? 'blue' : 'green'}`}>{l.status === 'pending' ? 'Needs review' : l.status}</span><span className="record-age">{age(l.created_at)}</span><Link className="admin-mini-button" href={`${adminPaths.queue}?listing=${l.id}`}>Review</Link></div>)}{offerQueue.map(deal=><div className="listing-review-row" key={deal.id}><span className="review-thumb"><Store size={20}/></span><div className="record-title"><strong>{deal.title}</strong><small>Business offer</small></div><span className="admin-tag amber">Needs review</span><Link className="admin-mini-button" href={`${adminPaths.queue}?deal=${deal.id}`}>Review</Link></div>)}{!queue.length&&!offerQueue.length&&<Quiet>No items need review in this view.</Quiet>}</div>
      </Panel>
      <Panel id="safety" title="Trust & safety monitoring" subtitle="Signals from your campus records" icon={ShieldCheck} href={adminPaths.safety}>
        <div className="safety-records">{[
          { title: 'Community reports', note: 'Flagged by campus members', count: reports.length, icon: Flag, tone: 'red', href: '/admin/trust-safety?view=reports' },
          { title: 'Suspended accounts', note: 'Accounts with restricted access', count: people.filter(p => p.suspended).length, icon: LockKeyhole, tone: 'amber', href: '/admin/trust-safety?view=accounts' },
          { title: 'Disputed transactions', note: 'Participant concerns to resolve', count: orders.filter(o => o.status === 'disputed').length, icon: Wallet, tone: 'purple', href: '/admin/trust-safety?view=disputes' },
          { title: 'Pending listing reviews', note: 'Waiting for a moderation decision', count: held.length, icon: ClipboardCheck, tone: 'blue', href: '/admin/moderation-queue' },
        ].map(row => <Link href={row.href} key={row.title} className="safety-record"><span className={`metric-icon ${row.tone}`}><row.icon size={19} /></span><b>{row.count}</b><div><strong>{row.title}</strong><small>{row.note}</small></div><ChevronRight size={15} /></Link>)}</div><p className="panel-footnote">Automated fraud detection is not connected.</p>
      </Panel>
      <Panel title="Pending student verifications" subtitle="New campus and business applications" icon={Users} count={pending.length} href="/admin/verifications">
        <div className="verification-records">{pending.filter(v => !q || `${data.profiles.find(p => p.id === v.user_id)?.name} ${v.detail}`.toLowerCase().includes(q)).slice(0, 4).map(v => { const person = data.profiles.find(p => p.id === v.user_id); return <div className="verification-record" key={v.id}><span className="avatar small-avatar">{person?.avatar ?? '?'}</span><div><strong>{person?.name ?? 'Campus member'}</strong><small>{data.colleges.find(c => c.id === v.college_id)?.short_name}</small><small>{v.kind} · {age(v.created_at)}</small></div><button className="admin-mini-button" onClick={() => setDecision({ id: v.id, title: 'Review verification application' })}>Review</button></div>; })}{!pending.length && <Quiet>You’re all caught up on verifications.</Quiet>}</div><div className="verification-note"><ShieldCheck size={26} /><strong>Trust starts with a real check.</strong><p>Confirm campus eligibility independently before approving an application.</p><Link href="/admin/verifications">Open verification workspace <ArrowRight size={13} /></Link></div>
      </Panel>
      <Panel id="analytics" title="Campus activity analytics" subtitle={`${analytics.periodLabel} · ${analytics.bucketLabel} · IST`} icon={ChartNoAxesCombined} href="/admin/analytics">
        <div className="chart-totals"><div><strong>{analytics.totals.listings}</strong><small>New listings</small></div><div><strong>{analytics.totals.orders}</strong><small>Order requests</small></div><div><strong>{analytics.totals.users}</strong><small>New members</small></div></div>
        <TrendChart title="Campus activity analytics" data={analytics.activity} series={activitySeries} compact />
      </Panel>
      <Panel id="campuses" title="Campus performance" subtitle={`Records created · ${analytics.periodLabel}`} icon={Store} href="/admin/analytics#campuses">
        <BarChart title="Campus performance" data={analytics.campuses} series={campusSeries} compact />
      </Panel>
      <Panel title="Dispute management" subtitle={`Current case status · ${analytics.periodLabel}`} icon={LifeBuoy} count={disputes.length} href="/admin/support?type=dispute">
        <DonutChart title="Dispute resolution" data={[{ label: 'Open', value: disputes.length, color: '#f59e0b' }, { label: 'Resolved', value: tickets.filter(t => t.type === 'dispute' && t.status === 'resolved').length, color: '#059669' }]} centerLabel="disputes" compact />
        {disputes.slice(0, 2).map(t => <Link className="support-record" href={adminCaseHref(t.id,t.type)} key={t.id}><span className="admin-tag amber">Open</span><div><strong>{t.subject}</strong><small>{age(t.created_at)}</small></div><ChevronRight size={15} /></Link>)}
      </Panel>
      <Panel title="Security & incident feed" subtitle="Moderation outcomes and reported concerns" icon={ShieldCheck} href="/admin/audit"><div className="incident-summary"><span className="status-led" />Server-side role checks enabled</div>{reports.slice(0, 3).map(t => <Link className="incident-record" href={adminCaseHref(t.id,'report')} key={t.id}><span className="admin-tag amber">Report</span><strong>{t.subject}</strong><small>{age(t.created_at)}</small></Link>)}{audit.slice(0, 3).map(a => <div className="incident-record" key={a.id}><span className="admin-tag blue">Audit</span><strong>{a.action.replaceAll('_', ' ')}</strong><small>{age(a.created_at)}</small></div>)}{!reports.length && !audit.length && <Quiet>No recorded incidents or moderation decisions yet.</Quiet>}<p className="panel-footnote">Authentication event streaming is not connected.</p></Panel>
      <Panel title="Recent admin actions" subtitle="Decisions recorded by the moderation team" icon={Clock3} href="/admin/audit">{audit.slice(0, 5).map(a => <div className="action-record" key={a.id}><span className="avatar tiny">{data.profiles.find(p => p.id === a.actor_id)?.avatar ?? 'AD'}</span><div><strong>{data.profiles.find(p => p.id === a.actor_id)?.name ?? 'Administrator'}</strong><small>{a.action.replaceAll('_', ' ')}</small></div><small>{age(a.created_at)}</small></div>)}{!audit.length && <Quiet>Your first review decision will appear here with its author and reason.</Quiet>}</Panel>
      <Panel title="Support tickets" subtitle="Campus questions and requests for assistance" icon={MessageSquare} count={open.length} href="/admin/support">{tickets.filter(t => !q || `${t.subject} ${t.body}`.toLowerCase().includes(q)).slice(0, 4).map(t => <Link className="support-record" href={adminCaseHref(t.id,t.type)} key={t.id}><span className={`admin-tag ${t.status === 'open' ? 'amber' : 'green'}`}>{t.status}</span><div><strong>{t.subject}</strong><small>{t.type.replaceAll('_', ' ')} · {age(t.created_at)}</small></div><ChevronRight size={14} /></Link>)}{!tickets.length && <Quiet>No support tickets in this view.</Quiet>}</Panel>
    </div>
    {decision && <Modal title={decision.title} onClose={() => setDecision(null)}><VerificationReview id={decision.id} /></Modal>}
  </div>;
}


