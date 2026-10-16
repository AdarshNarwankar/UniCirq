'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCheck, ClipboardCheck, Clock3, FileText, Flag, GraduationCap, LifeBuoy, LockKeyhole, MessagesSquare, Scale, Search, ShieldCheck } from 'lucide-react';
import { moneyLabel, type Ticket } from '@/lib/domain';
import { supportCaseContext, supportCases, supportStatusFilter, supportTypeFilter, supportTypeLabels } from '@/lib/admin-support';
import { useAdminFilters } from './admin-filters';
import { Form } from './forms';
import { useApp } from './provider';
import { Badge, Empty } from './primitives';

const displayDate = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const types = ['all', 'dispute', 'support', 'report', 'managed_sale'] as const;
const statuses = ['all', 'open', 'resolved'] as const;
const humanize = (value: string) => value.replaceAll('_', ' ');
const typeTitle = (value: typeof types[number]) => value === 'all' ? 'All case types' : supportTypeLabels[value];

export function AdminSupport() {
  const { data } = useApp();
  const filters = useAdminFilters();
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const [query, setQuery] = useState('');
  const type = supportTypeFilter(params.get('type')), status = supportStatusFilter(params.get('status'));
  const selectedId = params.get('ticket');
  const selected = data.tickets.find(item => item.id === selectedId);
  const { scoped, records } = useMemo(() => supportCases(data, { ...filters, query, type, status }), [data, filters, query, type, status]);
  function filterHref(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    if (key !== 'ticket') next.delete('ticket');
    return `${pathname}${next.size ? '?' + next.toString() : ''}`;
  }
  return <div className="admin-support-workspace admin-studio-workspace">
    <header className="admin-support-heading"><div><span className="eyebrow">CASE MANAGEMENT</span><h1>Disputes & support</h1><p>Read the concern, check its marketplace context, and record a clear response.</p></div><Link className="button secondary" href="/admin/support-center"><BookOpen size={17} />Support Center</Link></header>
    {selectedId ? <>
      <Link className="text-link admin-support-back" href={filterHref('ticket', null)}><ArrowLeft size={16} />Back to cases</Link>
      {selected ? <>
        {!records.some(item => item.id === selected.id) && <p className="admin-support-note">This linked case is outside the current list filters. Its complete record is shown below.</p>}
        <SupportCaseDetail key={selected.id} ticket={selected} />
      </> : <Empty title="Case unavailable." body="This reference was not found in the case records available to your account." action={<Link className="button secondary" href="/admin/support">View all cases</Link>} />}
    </> : <>
      <div className="admin-support-metrics" aria-label="Support case summary">
        {[{ label: 'Open cases', value: scoped.filter(item => item.status === 'open').length, Icon: Clock3, tone: 'amber' }, { label: 'Open disputes', value: scoped.filter(item => item.status === 'open' && item.type === 'dispute').length, Icon: Scale, tone: 'red' }, { label: 'Open reports', value: scoped.filter(item => item.status === 'open' && item.type === 'report').length, Icon: Flag, tone: 'purple' }, { label: 'Resolved cases', value: scoped.filter(item => item.status === 'resolved').length, Icon: CheckCheck, tone: 'green' }].map(({ label, value, Icon, tone }) => <div key={label}><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><strong>{value}</strong><span>{label}</span></div></div>)}
      </div>
      <div className="admin-support-links"><Link href="/admin/moderation-queue"><ClipboardCheck size={17} />Review listings & offers<ArrowRight size={15} /></Link><Link href="/admin/trust-safety"><ShieldCheck size={17} />Trust & safety overview<ArrowRight size={15} /></Link></div>
      <section className="admin-support-list" aria-label="Support case inbox">
        <div className="admin-support-toolbar">
          <div className="admin-support-tabs" aria-label="Case status">{statuses.map(value => <button key={value} type="button" aria-pressed={status === value} onClick={() => router.replace(filterHref('status', value), { scroll: false })}>{value === 'all' ? 'All cases' : value === 'open' ? 'Open' : 'Resolved'}<span>{value === 'all' ? scoped.length : scoped.filter(item => item.status === value).length}</span></button>)}</div>
          <div className="admin-support-filters"><label><Search size={17} /><input aria-label="Search support cases" placeholder="Search subject, member, listing or reference" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Case type" value={type} onChange={event => router.replace(filterHref('type', event.target.value), { scroll: false })}>{types.map(value => <option key={value} value={value}>{typeTitle(value)}</option>)}</select></div>
        </div>
        <p className="admin-support-results" role="status">{records.length} {records.length === 1 ? 'case' : 'cases'} · Campus and date filters apply to case submission dates.</p>
        {records.length ? <div className="admin-support-records">{records.map(ticket => {
          const { owner, college, order, listing } = supportCaseContext(data, ticket);
          return <article className="admin-support-record" key={ticket.id}><div className="admin-support-record-top"><div><span className="admin-support-kind">{supportTypeLabels[ticket.type]} · #{ticket.id.slice(0, 8).toUpperCase()}</span><h2><Link href={filterHref('ticket', ticket.id)}>{ticket.subject}</Link></h2></div><Badge tone={ticket.status === 'open' ? 'amber' : 'green'}>{ticket.status === 'open' ? 'Open' : 'Resolved'}</Badge></div><p className="admin-support-preview">{ticket.body}</p><div className="admin-support-record-context"><span>{owner?.name ?? 'Campus member'}</span><span>{college?.short_name ?? 'No campus recorded'}</span>{listing && <span>{listing.title}</span>}{order && <span>Activity #{order.id.slice(0, 8).toUpperCase()}</span>}</div><footer><time dateTime={ticket.created_at}>{displayDate(ticket.created_at)} IST</time><Link className="button secondary" href={filterHref('ticket', ticket.id)}>{ticket.status === 'open' ? 'Review case' : 'View resolution'}<ArrowRight size={15} /></Link></footer></article>;
        })}</div> : <Empty title="No cases match this view." body="Try another case type, status, search or campus filter." />}
      </section>
    </>}
  </div>;
}

function SupportCaseDetail({ ticket }: { ticket: Ticket }) {
  const { data, run } = useApp();
  const { owner, college, order, listing, buyer, seller, events, reviews } = supportCaseContext(data, ticket);
  const resolver = reviews.filter(item => item.action === 'ticket.resolve').at(-1);
  return <div className="admin-support-detail">
    <section className="admin-support-card admin-support-case-intro"><div className="admin-support-record-top"><div><span className="admin-support-kind">{supportTypeLabels[ticket.type]} · #{ticket.id.slice(0, 8).toUpperCase()}</span><h2>{ticket.subject}</h2></div><Badge tone={ticket.status === 'open' ? 'amber' : 'green'}>{ticket.status === 'open' ? 'Open' : 'Resolved'}</Badge></div><dl className="admin-support-facts"><div><dt>Submitted by</dt><dd>{owner?.name ?? 'Campus member'}{owner?.suspended && <span className="pill red">Account suspended</span>}</dd></div><div><dt>Campus</dt><dd>{college?.name ?? 'No campus recorded'}</dd></div><div><dt>Submitted</dt><dd><time dateTime={ticket.created_at}>{displayDate(ticket.created_at)} IST</time></dd></div><div><dt>Case reference</dt><dd>{ticket.id}</dd></div></dl><h3>Member’s concern</h3><p className="admin-support-fulltext">{ticket.body}</p></section>
    <div className="admin-support-detail-grid"><div className="admin-support-column">
      {listing && <section className="admin-support-card"><div className="admin-support-section-heading"><FileText size={19} /><h3>Associated listing</h3></div><h4>{listing.title}</h4><p className="admin-support-fulltext">{listing.description}</p><dl className="admin-support-facts"><div><dt>Owner</dt><dd>{data.profiles.find(item => item.id === listing.owner_id)?.name ?? 'Campus member'}</dd></div><div><dt>Current status</dt><dd>{humanize(listing.status)}</dd></div><div><dt>Type & category</dt><dd>{humanize(listing.kind)} · {listing.category}</dd></div><div><dt>Current price</dt><dd>{moneyLabel(listing.price)} / {listing.unit}</dd></div></dl><Link className="text-link" href={`/admin/moderation-queue?listing=${encodeURIComponent(listing.id)}`}>Inspect listing & moderation history<ArrowRight size={15} /></Link></section>}
      {order && <section className="admin-support-card"><div className="admin-support-section-heading"><Scale size={19} /><h3>Exchange context</h3></div><dl className="admin-support-facts"><div><dt>Buyer</dt><dd>{buyer?.name ?? 'Campus member'}</dd></div><div><dt>Seller / provider</dt><dd>{seller?.name ?? 'Campus member'}</dd></div><div><dt>Recorded amount</dt><dd>{moneyLabel(order.amount)}</dd></div><div><dt>Current activity status</dt><dd>{humanize(order.status)}</dd></div><div><dt>Activity reference</dt><dd>{order.id}</dd></div><div><dt>Created</dt><dd>{displayDate(order.created_at)} IST</dd></div>{order.starts_on && <div><dt>Rental dates</dt><dd>{order.starts_on} to {order.ends_on ?? 'Not recorded'}</dd></div>}</dl><details className="admin-support-disclosure" open><summary>Terms saved when the activity was requested</summary><div><h4>{order.terms_snapshot.title}</h4><p className="admin-support-fulltext">{order.terms_snapshot.description}</p><dl className="admin-support-facts"><div><dt>Price at request</dt><dd>{moneyLabel(order.terms_snapshot.price)} / {order.terms_snapshot.unit}</dd></div><div><dt>Condition</dt><dd>{order.terms_snapshot.condition}</dd></div><div><dt>Public meet-up location</dt><dd>{order.terms_snapshot.location}</dd></div></dl></div></details><div className="admin-support-note"><Scale size={18} /><p>Payment is arranged directly between members. The recorded amount comes from the request; UniCirq cannot confirm collection or issue a refund.</p></div><h4 className="admin-support-timeline-title">Activity timeline</h4>{events.length ? <ol className="admin-support-timeline">{events.map(event => <li key={event.id}><span><strong>{humanize(event.status)}</strong><small>{data.profiles.find(item => item.id === event.actor_id)?.name ?? 'Campus member'}</small></span><time dateTime={event.created_at}>{displayDate(event.created_at)} IST</time></li>)}</ol> : <p className="admin-support-small">No activity events are available for this exchange.</p>}</section>}
      {!listing && !order && <section className="admin-support-card"><div className="admin-support-section-heading"><FileText size={19} /><h3>Case context</h3></div><p className="admin-support-small">{ticket.type === 'managed_sale' ? 'This is an interest request. Collection, storage, managed selling and sale agreements are not enabled.' : ticket.listing_id || ticket.order_id ? 'The associated listing or activity record is unavailable in this workspace.' : 'This case has no linked listing or exchange. Review the member’s submitted concern above.'}</p></section>}
    </div><div className="admin-support-column">
      <section className="admin-support-card"><div className="admin-support-section-heading"><MessagesSquare size={19} /><h3>{ticket.status === 'open' ? 'Respond & resolve' : 'Recorded resolution'}</h3></div>{ticket.status === 'open' ? <Form label="Resolve case & notify member" onSubmit={async form => { await run({ type: 'moderate', entity: 'ticket', target_id: ticket.id, decision: 'resolve', reason: String(form.get('reason') ?? '') }, 'Resolution recorded and member notified'); }}><p className="admin-support-small">Explain what you checked, the outcome, and any next steps. This response is shared with the member and recorded in the audit log.</p><label>Resolution response<textarea name="reason" required minLength={5} maxLength={500} rows={6} placeholder="Checks performed, outcome, and the next steps for the member." /></label><label className="checkbox"><input type="checkbox" required />I reviewed the case and the available context.</label><p className="admin-support-small">Resolving the support case does not change the activity’s status or transfer money.</p></Form> : <><p className="admin-support-fulltext admin-support-resolution">{ticket.resolution || 'No resolution response was recorded.'}</p>{resolver ? <p className="admin-support-small">Resolved by {data.profiles.find(item => item.id === resolver.actor_id)?.name ?? 'an administrator'} · {displayDate(resolver.created_at)} IST</p> : <p className="admin-support-small">Reviewer and resolution time were not recorded for this historical case.</p>}</>}</section>
      <section className="admin-support-card"><div className="admin-support-section-heading"><Clock3 size={19} /><h3>Review history</h3></div>{reviews.length ? <ol className="admin-support-review-history">{reviews.map(review => <li key={review.id}><div><strong>{humanize(review.action.replace('ticket.', ''))}</strong><time dateTime={review.created_at}>{displayDate(review.created_at)} IST</time></div><small>{data.profiles.find(item => item.id === review.actor_id)?.name ?? 'Administrator'}</small><p className="admin-support-fulltext">{review.reason}</p></li>)}</ol> : <p className="admin-support-small">No administrative decisions have been recorded for this case.</p>}</section>
      <div className="admin-support-note"><LockKeyhole size={18} /><p>Use submitted case details and exchange records for review. Members’ private conversations are not available in this workspace.</p></div>
      <Link className="text-link" href="/admin/support-center">Open case handling guide<ArrowRight size={15} /></Link>
    </div></div>
  </div>;
}

const guides = [
  { title: 'Handle a dispute', icon: Scale, href: '/admin/support?type=dispute&status=open', text: 'Review the concern, saved terms and activity timeline. Record the outcome and next steps for the member.' },
  { title: 'Review reported content', icon: Flag, href: '/admin/support?type=report&status=open', text: 'Read the member’s report, inspect the linked listing, and record any listing decision in the moderation queue.' },
  { title: 'Verify campus membership', icon: GraduationCap, href: '/admin/verifications', text: 'Check eligibility independently, choose the evidence method, and explain the decision. Another admin reviews your own application.' },
  { title: 'Moderate listings & offers', icon: ClipboardCheck, href: '/admin/moderation-queue', text: 'Inspect the content, owner, campus and prior decisions before approving or removing a listing or offer.' },
];
const faqs = [
  { title: 'Where should I review a new case?', category: 'Triage', body: 'Open Disputes & support. Filter by case type and open status, then select Review case. Use Support request for general help, Dispute for an exchange concern, Community report for reported content, and Managed sale interest for an interest form.', href: '/admin/support?status=open', link: 'Open case inbox' },
  { title: 'What should a resolution include?', category: 'Triage', body: 'State the checks performed, the outcome, and the member’s next steps. Keep the response between 5 and 500 characters. The response is sent as an in-app notification and saved with your identity in the audit log. Resolve only after reviewing the concern and available context.', href: '/admin/support?status=open', link: 'Review open cases' },
  { title: 'Does resolving a dispute complete or refund the exchange?', category: 'Exchanges', body: 'Resolving the support case records the response. It does not change the exchange status, collect payment, release funds or issue a refund. Members arrange payments directly, and a recorded amount does not prove that payment occurred.', href: '/admin/support?type=dispute', link: 'View disputes' },
  { title: 'Can admins read members’ private chat?', category: 'Privacy', body: 'Private conversations are restricted to their participants. Review the case text submitted to support, the associated listing, saved exchange terms and activity events. This workspace does not provide a private message viewer.', href: '/admin/support', link: 'Open support workspace' },
  { title: 'Where do I moderate a reported listing?', category: 'Moderation', body: 'Open the community report, then use Inspect listing & moderation history. The moderation queue is a separate workspace for listing and offer reviews. Resolving a report does not automatically remove its associated listing.', href: '/admin/moderation-queue', link: 'Open moderation queue' },
  { title: 'How do campus and date filters work?', category: 'Triage', body: 'The case inbox uses the campus and date controls above the workspace. The date filter refers to when the case was submitted. Search and case type narrow the list further. A direct case link can show a record outside these list filters, with a notice explaining this.', href: '/admin/support', link: 'Open case inbox' },
  { title: 'What belongs in Trust & safety?', category: 'Safety', body: 'Trust & safety brings together community reports, suspended accounts and open disputes. Use that overview to inspect the underlying records, then open the relevant review workspace. Signals come from recorded campus activity; automated fraud detection is not connected.', href: '/admin/trust-safety', link: 'Open trust & safety' },
  { title: 'How are verification decisions checked?', category: 'Verification', body: 'Use the student verification workspace for campus and business applications. Approval needs an independent eligibility check, a suitable review method, confirmation that evidence was checked, and a reason. You cannot review your own application.', href: '/admin/verifications', link: 'Open verification applications' },
  { title: 'Is managed selling available?', category: 'Exchanges', body: 'Managed sale submissions currently record interest only. Item collection, storage, pricing agreements and payments are not enabled. Respond to the interest request without promising collection or a completed sale.', href: '/admin/support?type=managed_sale', link: 'View managed sale interest' },
  { title: 'Where can I check a previous decision?', category: 'Moderation', body: 'Open a resolved support case for its full resolution and review history. The audit log shows recorded administrative actions across the app, including the actor, reason and time when available.', href: '/admin/audit', link: 'Open audit log' },
];

export function AdminSupportCenter() {
  const filters = useAdminFilters();
  const [query, setQuery] = useState('');
  const terms = `${filters.search} ${query}`.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = faqs.filter(item => {
    const text = `${item.title} ${item.category} ${item.body}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
  return <div className="admin-support-workspace admin-support-center admin-studio-workspace"><header className="admin-support-heading"><div><span className="eyebrow">ADMIN HELP & GUIDES</span><h1>Support Center</h1><p>Find the right workspace and follow a clear review process.</p></div><Link className="button primary" href="/admin/support?status=open"><LifeBuoy size={17} />Open case inbox</Link></header><section className="admin-support-guide-grid" aria-label="Admin handling guides">{guides.map(({ title, icon: Icon, href, text }) => <Link className="admin-support-guide" href={href} key={title}><span><Icon size={22} /></span><h2>{title}</h2><p>{text}</p><strong>Open workspace<ArrowRight size={16} /></strong></Link>)}</section><section className="admin-support-card admin-support-knowledge"><div className="admin-support-section-heading"><BookOpen size={22} /><div><h2>Answers for your next review</h2><p>Case handling, verification, privacy and marketplace operations.</p></div></div><label className="admin-support-help-search"><Search size={18} /><input type="search" aria-label="Search admin help" placeholder="Search help, e.g. disputes, refunds or verification" value={query} onChange={event => setQuery(event.target.value)} /></label><p className="admin-support-results" role="status">{results.length} {results.length === 1 ? 'guide' : 'guides'}</p><div className="admin-support-faqs">{results.map(item => <details className="admin-support-disclosure" key={item.title}><summary><span className="admin-support-faq-category">{item.category}</span>{item.title}</summary><div><p>{item.body}</p><Link className="text-link" href={item.href}>{item.link}<ArrowRight size={15} /></Link></div></details>)}</div>{!results.length && <Empty title="No guides match your search." body="Try a shorter phrase or another topic." />}</section><section className="admin-support-center-footer"><ShieldCheck size={21} /><div><strong>Keep the decision clear and traceable.</strong><p>Work from recorded details, explain your checks, and save the outcome in the correct review workspace.</p></div><Link className="text-link" href="/admin/audit">View audit log<ArrowRight size={15} /></Link></section></div>;
}
