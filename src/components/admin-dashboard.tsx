'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowRight, Bell, BookOpen, Box, CalendarDays, ChartNoAxesCombined, Check, ChevronRight, CircleHelp, ClipboardCheck, Clock3, FileClock, Flag, LayoutDashboard, LifeBuoy, LockKeyhole, LogOut, MapPin, Menu, MessageSquare, Search, ShieldCheck, ShoppingBag, Store, TriangleAlert, Users, Wallet, X, type LucideIcon } from 'lucide-react';
import { useApp } from './provider';
import { Modal } from './primitives';
import { Form } from './forms';
import { moneyLabel, type Listing } from '@/lib/domain';

const Filters = createContext({ campus: 'all', days: 'all', search: '' });
const sections = [
  { title: 'OPERATIONS', links: [
    { label: 'Student verification', href: '/admin/verifications', icon: ClipboardCheck },
    { label: 'Listings & services', href: '/admin/moderation', icon: ShoppingBag },
    { label: 'Campus performance', href: '/admin#campuses', icon: Store },
    { label: 'Disputes & support', href: '/admin/support', icon: LifeBuoy },
  ] },
  { title: 'MONITORING', links: [
    { label: 'Moderation queue', href: '/admin#moderation', icon: Flag },
    { label: 'Trust & safety', href: '/admin#safety', icon: ShieldCheck },
    { label: 'Activity analytics', href: '/admin#analytics', icon: ChartNoAxesCombined },
    { label: 'Audit log', href: '/admin/audit', icon: FileClock },
    { label: 'Notifications', href: '/admin/notifications', icon: Bell },
  ] },
  { title: 'ADMIN', links: [
    { label: 'My account', href: '/admin/profile', icon: Users },
    { label: 'Support center', href: '/admin/support', icon: CircleHelp },
  ] },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data } = useApp();
  const pathname = usePathname(), router = useRouter();
  const [open, setOpen] = useState(false), [campus, setCampus] = useState('all'), [days, setDays] = useState('all');
  const [draft, setDraft] = useState(''), [search, setSearch] = useState('');
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const unread = data.notifications.filter(n => !n.read).length;
  const pending = data.listings.filter(l => l.status === 'pending').length + data.deals.filter(d => d.status === 'pending').length;
  return <Filters.Provider value={{ campus, days, search }}><div className="control-center">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {open && <button className="admin-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside id="admin-navigation" className={`admin-sidebar ${open ? 'is-open' : ''}`} aria-label="Admin sidebar">
      <Link href="/admin" className="admin-brand" onClick={() => setOpen(false)}><span className="circle-mark" /><span>UniCirq<small>Admin Control Center</small></span></Link>
      <button className="admin-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={20} /></button>
      <nav aria-label="Admin navigation"><Link onClick={() => setOpen(false)} href="/admin" className={`admin-nav-link ${pathname === '/admin' ? 'selected' : ''}`}><LayoutDashboard size={18} />Dashboard</Link>
        {sections.map(section => <div className="admin-nav-group" key={section.title}><span>{section.title}</span>{section.links.map(({ href, label, icon: Icon }) => <Link key={label} href={href} onClick={() => setOpen(false)} className={`admin-nav-link ${pathname === href ? 'selected' : ''}`}><Icon size={17} />{label}{label === 'Moderation queue' && pending > 0 && <b>{pending}</b>}{label === 'Notifications' && unread > 0 && <b>{unread}</b>}</Link>)}</div>)}
      </nav>
      <div className="admin-sidebar-help"><span className="help-orbit"><ShieldCheck size={27} /></span><strong>A safer campus circle.</strong><p>Review with care. Keep your community connected.</p><Link href="/admin/support" onClick={() => setOpen(false)}>Open support center <ArrowRight size={13} /></Link></div>
      <button className="admin-signout" onClick={async () => { await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); window.location.assign('/login'); }}><LogOut size={15} />Sign out</button>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar">
      <button className="admin-menu" aria-label="Open navigation" aria-controls="admin-navigation" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={21} /></button>
      <form className="admin-search" role="search" onSubmit={e => { e.preventDefault(); setSearch(draft); router.push('/admin'); }}><Search size={17} /><input aria-label="Search dashboard records" placeholder="Search listings, verifications, support cases…" value={draft} onChange={e => { setDraft(e.target.value); if (!e.target.value) setSearch(''); }} /><button aria-label="Search dashboard" type="submit">↵</button></form>
      <label className="admin-select"><MapPin size={16} /><select aria-label="Dashboard campus" value={campus} onChange={e => { setCampus(e.target.value); router.push('/admin'); }}><option value="all">All campuses</option>{data.colleges.map(c => <option key={c.id} value={c.id}>{c.short_name}</option>)}</select></label>
      <label className="admin-select period-select"><CalendarDays size={16} /><select aria-label="Dashboard period" value={days} onChange={e => { setDays(e.target.value); router.push('/admin'); }}><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
      <Link className="admin-bell" href="/admin/notifications" aria-label={`Notifications, ${unread} unread`}><Bell size={21} />{unread > 0 && <b>{unread}</b>}</Link>
      <Link href="/admin/profile" className="admin-user"><span className="avatar">{data.user.avatar}</span><span><strong>{data.user.name}</strong><small>Administrator</small></span></Link>
    </header>
    {data.demo && <div className="admin-demo"><span><i />LOCAL DEMO <span>· Sample campus data</span></span><Link href="/login">Switch account <ArrowRight size={12} /></Link></div>}
    <main id="main-content" className="admin-main">{children}</main><footer className="admin-footer"><span>UniCirq — Your Campus, Connected.</span><span>Campus operations workspace</span></footer></div>
  </div></Filters.Provider>;
}

function Panel({ title, subtitle, icon: Icon, count, href, id, children, className = '' }: { title: string; subtitle: string; icon: LucideIcon; count?: number; href?: string; id?: string; children: React.ReactNode; className?: string }) {
  return <section id={id} className={`control-panel ${className}`}><header><Icon size={21} /><div><h2>{title}{count !== undefined && <span className="count-dot">{count}</span>}</h2><p>{subtitle}</p></div>{href && <Link href={href}>View all <ArrowRight size={12} /></Link>}</header>{children}</section>;
}
function Quiet({ children }: { children: React.ReactNode }) { return <div className="admin-quiet"><Check size={20} /><p>{children}</p></div>; }
function age(date: string) { const hours = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 3600000)); return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`; }
type Decision = { entity: 'listing' | 'verification' | 'ticket'; id: string; decision: 'approve' | 'remove' | 'reject' | 'resolve'; title: string };

export function AdminOverview() {
  const { data, run } = useApp(), filters = useContext(Filters);
  const [tab, setTab] = useState('all'), [decision, setDecision] = useState<Decision | null>(null);
  const scope = (row: { college_id: string | null; created_at?: string }) => (filters.campus === 'all' || row.college_id === filters.campus) && (filters.days === 'all' || !row.created_at || Date.parse(row.created_at) >= Date.now() - Number(filters.days) * 86400000);
  const listings = data.listings.filter(scope), people = data.profiles.filter(scope), orders = data.orders.filter(scope), tickets = data.tickets.filter(scope), verifications = data.verifications.filter(scope);
  const pending = verifications.filter(v => v.status === 'pending'), open = tickets.filter(t => t.status === 'open'), disputes = open.filter(t => t.type === 'dispute');
  const reports = open.filter(t => t.type === 'report'), held = listings.filter(l => l.status === 'pending');
  const students = people.filter(p => p.role === 'student'), verified = students.filter(p => p.verified);
  const audit = data.audit.filter(a => filters.campus === 'all' || [...data.listings, ...data.verifications, ...data.tickets, ...data.deals].find(record => record.id === a.target_id)?.college_id === filters.campus).filter(a => filters.days === 'all' || Date.parse(a.created_at) >= Date.now() - Number(filters.days) * 86400000);
  const q = filters.search.toLowerCase();
  const queue = [...listings].filter(l => ['active', 'pending'].includes(l.status) && (tab === 'all' || l.status === tab) && (!q || `${l.title} ${data.profiles.find(p => p.id === l.owner_id)?.name}`.toLowerCase().includes(q))).sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending')).slice(0, 5);
  const metrics: { label: string; value: string | number; note: string; icon: LucideIcon; tone: string; href?: string }[] = [
    { label: 'Total users', value: people.length, note: 'In selected campus scope', icon: Users, tone: 'blue' },
    { label: 'Verified students', value: verified.length, note: `${students.length ? Math.round(verified.length / students.length * 100) : 0}% verification rate`, icon: ShieldCheck, tone: 'green', href: '/admin/verifications' },
    { label: 'Active listings', value: listings.filter(l => l.status === 'active').length, note: `${held.length} awaiting review`, icon: Box, tone: 'blue', href: '/admin/moderation' },
    { label: 'Rental listings', value: listings.filter(l => l.kind === 'rental' && l.status === 'active').length, note: 'Available on campus', icon: ShoppingBag, tone: 'purple', href: '/admin/moderation' },
    { label: 'Open disputes', value: disputes.length, note: `${open.length} total support cases`, icon: TriangleAlert, tone: 'red', href: '/admin/support' },
    { label: 'Platform revenue', value: '—', note: 'Payments not connected', icon: Wallet, tone: 'blue' },
    { label: 'Recorded order value', value: moneyLabel(orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.amount, 0)), note: 'Requested value · not GMV', icon: ChartNoAxesCombined, tone: 'blue' },
    { label: 'Open reports', value: reports.length, note: 'Community-reported concerns', icon: Flag, tone: 'red', href: '/admin/support' },
  ];
  const reviewListing = (l: Listing) => setDecision({ entity: 'listing', id: l.id, decision: l.status === 'pending' ? 'approve' : 'remove', title: l.title });
  const dayBuckets = Array.from({ length: 7 }, (_, i) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - 6 + i); const end = date.getTime() + 86400000; return { label: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), listings: listings.filter(l => Date.parse(l.created_at) >= +date && Date.parse(l.created_at) < end).length, orders: orders.filter(o => Date.parse(o.created_at) >= +date && Date.parse(o.created_at) < end).length }; });
  const max = Math.max(1, ...dayBuckets.flatMap(b => [b.listings, b.orders]));
  const points = (key: 'listings' | 'orders') => dayBuckets.map((b, i) => `${40 + i * 67},${126 - b[key] / max * 100}`).join(' ');
  return <div className="admin-dashboard">
    <section className="admin-hero"><div><span className="admin-eyebrow">CONNECTED CAMPUSES. STRONGER COMMUNITIES.</span><h1>Admin Control Center</h1><p>A safer campus marketplace starts with you.</p><small>Monitor. Moderate. Verify. Protect. Keep UniCirq safe.</small></div><div className="admin-health"><ShieldCheck size={32} /><div><span>Community safeguards</span><strong>Moderation is enabled</strong></div><div className="health-bottom"><span><LockKeyhole size={15} />Role-protected access</span><span><FileClock size={15} />Audited decisions</span></div></div></section>
    <div className="admin-metrics">{metrics.map(({ label, value, note, icon: Icon, tone, href }) => { const content = <><span className={`metric-icon ${tone}`}><Icon size={23} /></span><div><strong>{value}</strong><span>{label}</span><small>{note}</small></div></>; return href ? <Link key={label} href={href} className="admin-metric">{content}</Link> : <div key={label} className="admin-metric">{content}</div>; })}</div>
    {q && <div className="admin-search-note"><Search size={16} />Showing matching listings, verification requests and support cases for “{filters.search}”.</div>}
    <div className="admin-panel-grid">
      <Panel id="moderation" title="Moderation queue" subtitle="Listing oversight and items awaiting review" icon={ClipboardCheck} count={held.length} href="/admin/moderation" className="queue-panel">
        <div className="admin-tabs" aria-label="Filter moderation listings">{[['all', 'All', listings.filter(l => ['active', 'pending'].includes(l.status)).length], ['pending', 'Pending', held.length], ['active', 'Active', listings.filter(l => l.status === 'active').length]].map(([value, label, count]) => <button key={value} aria-pressed={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(String(value))}>{label}<span>{count}</span></button>)}</div>
        <div className="admin-records">{queue.map(l => <div className="listing-review-row" key={l.id}><div className="review-thumb">{l.image ? <img src={l.image} alt="" /> : <Box size={21} />}</div><div className="record-title"><strong>{l.title}</strong><small>{l.category} <span>· {l.kind}</span></small></div><span className={`admin-tag ${l.status === 'pending' ? 'amber' : 'green'}`}>{l.status === 'pending' ? 'Needs review' : l.status}</span><span className="record-age">{age(l.created_at)}</span><button className="admin-mini-button" onClick={() => reviewListing(l)}>Review</button></div>)}{!queue.length && <Quiet>No listings match this view.</Quiet>}</div>
      </Panel>
      <Panel id="safety" title="Trust & safety monitoring" subtitle="Signals from your campus records" icon={ShieldCheck} href="/admin/support">
        <div className="safety-records">{[
          { title: 'Community reports', note: 'Flagged by campus members', count: reports.length, icon: Flag, tone: 'red', href: '/admin/support' },
          { title: 'Suspended accounts', note: 'Accounts with restricted access', count: people.filter(p => p.suspended).length, icon: LockKeyhole, tone: 'amber', href: '/admin/audit' },
          { title: 'Disputed transactions', note: 'Participant concerns to resolve', count: orders.filter(o => o.status === 'disputed').length, icon: Wallet, tone: 'purple', href: '/admin/support' },
          { title: 'Pending listing reviews', note: 'Waiting for a moderation decision', count: held.length, icon: ClipboardCheck, tone: 'blue', href: '/admin/moderation' },
        ].map(row => <Link href={row.href} key={row.title} className="safety-record"><span className={`metric-icon ${row.tone}`}><row.icon size={19} /></span><b>{row.count}</b><div><strong>{row.title}</strong><small>{row.note}</small></div><ChevronRight size={15} /></Link>)}</div><p className="panel-footnote">Automated fraud detection is not connected.</p>
      </Panel>
      <Panel title="Pending student verifications" subtitle="New campus and business applications" icon={Users} count={pending.length} href="/admin/verifications">
        <div className="verification-records">{pending.filter(v => !q || `${data.profiles.find(p => p.id === v.user_id)?.name} ${v.detail}`.toLowerCase().includes(q)).slice(0, 4).map(v => { const person = data.profiles.find(p => p.id === v.user_id); return <div className="verification-record" key={v.id}><span className="avatar small-avatar">{person?.avatar ?? '?'}</span><div><strong>{person?.name ?? 'Campus member'}</strong><small>{data.colleges.find(c => c.id === v.college_id)?.short_name}</small><small>{v.kind} · {age(v.created_at)}</small></div><button className="admin-mini-button approve" onClick={() => setDecision({ entity: 'verification', id: v.id, decision: 'approve', title: `Verify ${person?.name ?? 'member'}` })}>Approve</button><button className="admin-mini-button reject" onClick={() => setDecision({ entity: 'verification', id: v.id, decision: 'reject', title: 'Reject verification' })}>Reject</button></div>; })}{!pending.length && <Quiet>You’re all caught up on verifications.</Quiet>}</div><div className="verification-note"><ShieldCheck size={26} /><strong>Trust starts with a real check.</strong><p>Confirm campus eligibility independently before approving an application.</p><Link href="/admin/verifications">Open verification workspace <ArrowRight size={13} /></Link></div>
      </Panel>
      <Panel id="analytics" title="Campus activity analytics" subtitle="New listings and transaction requests · last 7 days" icon={ChartNoAxesCombined}>
        <div className="chart-totals"><div><strong>{dayBuckets.reduce((n, b) => n + b.listings, 0)}</strong><small>New listings</small></div><div><strong>{dayBuckets.reduce((n, b) => n + b.orders, 0)}</strong><small>Transaction requests</small></div><div><strong>{orders.filter(o => o.status === 'completed').length}</strong><small>Recorded completions</small></div></div>
        <div className="chart-legend"><span>● Listings</span><span>● Requests</span></div><svg className="activity-chart" viewBox="0 0 465 158" role="img" aria-label={`Listings and transaction requests by day. ${dayBuckets.map(b => `${b.label}: ${b.listings} listings, ${b.orders} requests`).join('; ')}`}><defs><linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1762ff" stopOpacity=".2" /><stop offset="100%" stopColor="#1762ff" stopOpacity=".02" /></linearGradient></defs>{[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="40" x2="442" y1={26 + i * 25} y2={26 + i * 25} stroke="#e7edf9" strokeDasharray="3 3" /><text x="28" y={30 + i * 25} textAnchor="end">{Math.round(max * (1 - i / 4))}</text></g>)}<polygon points={`40,126 ${points('listings')} 442,126`} fill="url(#activityFill)" /><polyline points={points('listings')} stroke="#1762ff" strokeWidth="2.5" fill="none" /><polyline points={points('orders')} stroke="#12b886" strokeWidth="2.5" fill="none" />{dayBuckets.map((b, i) => <g key={b.label}><circle cx={40 + i * 67} cy={126 - b.listings / max * 100} r="3" fill="#1762ff" /><text x={40 + i * 67} y="150" textAnchor="middle">{b.label}</text></g>)}</svg>
      </Panel>
      <Panel id="campuses" title="Campus performance" subtitle="Community activity by campus · selected period" icon={Store}>
        <div className="admin-table-scroll"><table className="control-table"><thead><tr><th>Campus</th><th>Users</th><th>Listings</th><th>Orders</th></tr></thead><tbody>{data.colleges.filter(c => filters.campus === 'all' || c.id === filters.campus).map((c, i) => <tr key={c.id}><td><span className={`campus-dot tone-${i % 3}`}><BookOpen size={13} /></span>{c.short_name}</td><td>{people.filter(p => p.college_id === c.id).length}</td><td>{listings.filter(l => l.college_id === c.id).length}</td><td>{orders.filter(o => o.college_id === c.id).length}</td></tr>)}</tbody></table></div><div className="campus-summary"><MapPin size={23} /><div><strong>{data.colleges.filter(c => filters.campus === 'all' || c.id === filters.campus).length} campuses in view</strong><small>Small communities. Meaningful connections.</small></div></div>
      </Panel>
      <Panel title="Dispute management" subtitle="Open participant concerns and resolution status" icon={LifeBuoy} count={disputes.length} href="/admin/support"><div className="admin-tabs"><span className="active">Open <b>{disputes.length}</b></span><span>Resolved <b>{tickets.filter(t => t.type === 'dispute' && t.status === 'resolved').length}</b></span></div>{disputes.length ? disputes.slice(0, 4).map(t => <Link className="support-record" href="/admin/support" key={t.id}><span className="admin-tag amber">Open</span><div><strong>{t.subject}</strong><small>{age(t.created_at)}</small></div><ChevronRight size={15} /></Link>) : <div className="dispute-clear"><span><ShieldCheck size={32} /></span><strong>No open disputes</strong><p>New participant concerns will appear here for your team to review.</p><Link href="/admin/support">Go to support <ArrowRight size={13} /></Link></div>}</Panel>
      <Panel title="Security & incident feed" subtitle="Moderation outcomes and reported concerns" icon={ShieldCheck} href="/admin/audit"><div className="incident-summary"><span className="status-led" />Server-side role checks enabled</div>{reports.slice(0, 3).map(t => <Link className="incident-record" href="/admin/support" key={t.id}><span className="admin-tag amber">Report</span><strong>{t.subject}</strong><small>{age(t.created_at)}</small></Link>)}{audit.slice(0, 3).map(a => <div className="incident-record" key={a.id}><span className="admin-tag blue">Audit</span><strong>{a.action.replaceAll('_', ' ')}</strong><small>{age(a.created_at)}</small></div>)}{!reports.length && !audit.length && <Quiet>No recorded incidents or moderation decisions yet.</Quiet>}<p className="panel-footnote">Authentication event streaming is not connected.</p></Panel>
      <Panel title="Recent admin actions" subtitle="Decisions recorded by the moderation team" icon={Clock3} href="/admin/audit">{audit.slice(0, 5).map(a => <div className="action-record" key={a.id}><span className="avatar tiny">{data.profiles.find(p => p.id === a.actor_id)?.avatar ?? 'AD'}</span><div><strong>{data.profiles.find(p => p.id === a.actor_id)?.name ?? 'Administrator'}</strong><small>{a.action.replaceAll('_', ' ')}</small></div><small>{age(a.created_at)}</small></div>)}{!audit.length && <Quiet>Your first review decision will appear here with its author and reason.</Quiet>}</Panel>
      <Panel title="Support tickets" subtitle="Campus questions and requests for assistance" icon={MessageSquare} count={open.length} href="/admin/support">{tickets.filter(t => !q || `${t.subject} ${t.body}`.toLowerCase().includes(q)).slice(0, 4).map(t => <Link className="support-record" href="/admin/support" key={t.id}><span className={`admin-tag ${t.status === 'open' ? 'amber' : 'green'}`}>{t.status}</span><div><strong>{t.subject}</strong><small>{t.type.replaceAll('_', ' ')} · {age(t.created_at)}</small></div><ChevronRight size={14} /></Link>)}{!tickets.length && <Quiet>No support tickets in this view.</Quiet>}</Panel>
    </div>
    {decision && <Modal title={decision.title} onClose={() => setDecision(null)}><Form label={decision.decision === 'approve' ? 'Approve & record decision' : decision.decision === 'remove' ? 'Remove & record decision' : 'Record decision'} onSubmit={async f => { await run({ type: 'moderate', entity: decision.entity, target_id: decision.id, decision: decision.decision, reason: String(f.get('reason')) }, 'Decision recorded in the audit log'); setDecision(null); }}><p className="muted">{decision.entity === 'verification' ? 'Independently confirm eligibility before approval. Explain the check performed.' : 'Review this record and explain your decision. Your identity and reason will be recorded.'}</p>{decision.entity === 'listing' && <p className="notice">{data.listings.find(l => l.id === decision.id)?.description}</p>}{decision.entity === 'verification' && <p className="notice">{data.verifications.find(v => v.id === decision.id)?.detail}</p>}<label>Decision reason<textarea name="reason" required minLength={5} maxLength={500} rows={4} /></label></Form></Modal>}
  </div>;
}


