'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardCheck, Clock3, FileClock, Flag, ImageOff, LoaderCircle, RefreshCw, Search, ShieldCheck, Store } from 'lucide-react';
import { moneyLabel } from '@/lib/domain';
import { buildModerationWorkspace, moderationDecisions, type ModerationStatus } from '@/lib/moderation-workspace';
import { useApp } from './provider';
import { useAdminFilters } from './admin-filters';
import { Badge, Empty, Heading, Modal } from './primitives';
import { ProductImage } from './catalogue';

const kinds = { sale: 'Buy & sell', rental: 'Rental', hardware: 'Project hardware', service: 'Student service', deal: 'Business offer' };
const statusOptions: { value: ModerationStatus; label: string }[] = [{ value: 'attention', label: 'Needs attention' }, { value: 'pending', label: 'Awaiting approval' }, { value: 'reported', label: 'Open reports' }, { value: 'all', label: 'All records' }, { value: 'active', label: 'Active' }, { value: 'removed', label: 'Removed' }, { value: 'closed', label: 'Closed' }];
const dateLabel = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST' : 'Not recorded';
const tone = (status: string) => status === 'pending' ? 'amber' : status === 'active' ? 'green' : status === 'removed' ? 'red' : 'blue';

export function ModerationQueue() {
  return <Suspense fallback={<div className="page-loading" role="status"><LoaderCircle size={20} className="spin" />Loading moderation queue</div>}><ModerationWorkspace mode="queue" /></Suspense>;
}

export function ListingsCatalogue() {
  return <Suspense fallback={<div className="page-loading" role="status"><LoaderCircle size={20} className="spin" />Loading listings and services</div>}><ModerationWorkspace mode="catalogue" /></Suspense>;
}

function ModerationWorkspace({ mode }: { mode: 'queue' | 'catalogue' }) {
  const { data, refresh } = useApp();
  const filters = useAdminFilters();
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const [status, setStatus] = useState<ModerationStatus>(mode === 'queue' ? 'attention' : 'all');
  const [kind, setKind] = useState('all'), [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const results = useMemo(() => buildModerationWorkspace(data, { campus: filters.campus, days: filters.days, globalSearch: filters.search, status, kind, query }), [data, filters.campus, filters.days, filters.search, status, kind, query]);
  const people = new Map(data.profiles.map(person => [person.id, person]));
  const campuses = new Map(data.colleges.map(campus => [campus.id, campus]));
  const selectedListing = params.get('listing'), selectedDeal = selectedListing ? null : params.get('deal');
  function closeReview() {
    const next = new URLSearchParams(params.toString()); next.delete('listing'); next.delete('deal');
    router.replace(pathname + (next.size ? '?' + next.toString() : ''), { scroll: false });
  }
  async function reload() {
    if (refreshing) return;
    setRefreshing(true); setError('');
    try { await refresh(); } catch { setError('Could not refresh the workspace. Try again.'); } finally { setRefreshing(false); }
  }
  if (data.user.role !== 'admin') return <Empty title="Administrator access required" body="Sign in with an administrator account to review campus records." />;
  return <div className="moderation-workspace admin-studio-workspace">
    <Heading eyebrow={mode === 'queue' ? 'CAMPUS MODERATION' : 'MARKETPLACE OVERSIGHT'} title={mode === 'queue' ? 'Moderation queue' : 'Listings & services'} subtitle={mode === 'queue' ? 'Review new submissions and reported listings with the full context.' : 'Browse campus inventory, business offers and their recorded moderation history.'} action={<button type="button" className="button secondary" disabled={refreshing} onClick={reload}><RefreshCw size={16} className={refreshing ? 'spin' : ''} />{refreshing ? 'Refreshing' : 'Refresh records'}</button>} />
    <div className="moderation-metrics" aria-label="Moderation summary">
      {[{ label: 'Needs attention', count: results.attentionCount, icon: ClipboardCheck, status: 'attention' as const }, { label: 'Pending listings', count: results.pendingListingCount, icon: Clock3, status: 'pending' as const }, { label: 'Pending offers', count: results.pendingDealCount, icon: Store, status: 'pending' as const }, { label: 'Reported listings', count: results.reportedListingCount, icon: Flag, status: 'reported' as const }].map(({ label, count, icon: Icon, status: nextStatus }, index) => <button type="button" key={label} onClick={() => { setStatus(nextStatus); setKind(index === 1 ? 'listing' : index === 2 ? 'deal' : 'all'); }}><span className={'metric-icon ' + (index === 3 ? 'red' : index === 1 || index === 2 ? 'amber' : 'blue')}><Icon size={21} /></span><span><strong>{count}</strong><small>{label}</small></span><ArrowRight size={16} /></button>)}
    </div>
    <section className="moderation-records" aria-label={mode === 'queue' ? 'Moderation queue records' : 'Inventory records'}>
      <div className="moderation-toolbar"><label className="moderation-search"><Search size={17} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search moderation records" placeholder="Search title, owner, campus or reference" /></label><label className="moderation-select"><span>Status</span><select value={status} onChange={event => setStatus(event.target.value as ModerationStatus)}>{statusOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label className="moderation-select"><span>Type</span><select value={kind} onChange={event => setKind(event.target.value)}><option value="all">All types</option><option value="listing">All student listings</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="moderation-results" role="status">{results.records.length} {results.records.length === 1 ? 'record' : 'records'} · Campus and date filters apply. New reports can bring older listings back into this view.</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {results.records.length ? <div className="moderation-list">{results.records.map(record => {
        const owner = people.get(record.owner_id), campus = campuses.get(record.college_id), listing = record.entity === 'listing' ? data.listings.find(item => item.id === record.id) : undefined;
        return <article className="moderation-record" key={`${record.entity}-${record.id}`}>
          <div className="moderation-record-photo">{listing ? <ProductImage key={listing.id} listing={listing} /> : <Store size={31} />}</div>
          <div className="moderation-record-main"><div className="moderation-record-title"><h2>{record.title}</h2><Badge tone={tone(record.status)}>{record.status}</Badge>{record.openReports > 0 && <Badge tone="red">{record.openReports} open {record.openReports === 1 ? 'report' : 'reports'}</Badge>}</div><p>{kinds[record.kind]} · {campus?.short_name ?? 'Campus unavailable'} · {owner?.name ?? 'Owner unavailable'}</p><p className="moderation-record-description">{record.description}</p><div className="moderation-record-meta"><time dateTime={record.created_at}>Submitted {dateLabel(record.created_at)}</time>{record.latestReportAt && <time dateTime={record.latestReportAt}>Latest report {dateLabel(record.latestReportAt)}</time>}<span>Ref. {record.id.slice(0, 8).toUpperCase()}</span></div></div>
          <Link className="button secondary" href={`/admin/moderation-queue?${record.entity}=${encodeURIComponent(record.id)}`} scroll={false}>{record.status === 'pending' || record.openReports ? 'Review details' : 'View record'}<ArrowRight size={15} /></Link>
        </article>;
      })}</div> : <Empty title={status === 'attention' && !query && !filters.search && kind === 'all' ? 'The queue is clear.' : 'No records match this view.'} body={status === 'attention' && !query && !filters.search && kind === 'all' ? 'New listing submissions, business offers and unresolved listing reports will appear here.' : 'Try another status, type, campus, date range or search.'} action={(status !== (mode === 'queue' ? 'attention' : 'all') || kind !== 'all' || query) ? <button className="button secondary" type="button" onClick={() => { setQuery(''); setKind('all'); setStatus(mode === 'queue' ? 'attention' : 'all'); }}>Reset local filters</button> : undefined} />}
    </section>
    <p className="moderation-footnote"><ShieldCheck size={16} />Review records stay in the audit history. Resolving a report and removing a listing are separate decisions.</p>
    {(selectedListing || selectedDeal) && <Modal title={selectedListing ? 'Listing review' : 'Business offer review'} onClose={closeReview}>{selectedListing ? <ListingReview id={selectedListing} /> : <DealReview id={selectedDeal!} />}</Modal>}
  </div>;
}

export function ListingReview({ id, onDone }: { id: string; onDone?: () => void }) {
  return <ListingReviewContent key={id} id={id} onDone={onDone} />;
}

function ListingReviewContent({ id, onDone }: { id: string; onDone?: () => void }) {
  const { data } = useApp();
  const listing = data.listings.find(item => item.id === id);
  if (data.user.role !== 'admin') return <p className="moderation-review-message">Administrator access is required to review listings.</p>;
  if (!listing) return <UnavailableRecord kind="listing" />;
  const owner = data.profiles.find(person => person.id === listing.owner_id);
  const campus = data.colleges.find(college => college.id === listing.college_id);
  const ownerCampus = data.colleges.find(college => college.id === owner?.college_id);
  const reports = data.tickets.filter(ticket => ticket.type === 'report' && ticket.listing_id === listing.id).toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const openReports = reports.filter(ticket => ticket.status === 'open');
  const exchanges = data.orders.filter(order => order.listing_id === listing.id);
  const ongoing = exchanges.filter(order => !['completed', 'cancelled'].includes(order.status)).length;
  return <div className="moderation-review">
    <div className="moderation-review-heading"><div><span className="eyebrow">{kinds[listing.kind]} · {listing.category}</span><h3>{listing.title}</h3></div><Badge tone={tone(listing.status)}>{listing.status}</Badge></div>
    <div className="moderation-review-photo"><ProductImage key={listing.id} listing={listing} /></div>
    <p className="moderation-photo-note">{listing.image ? data.demo ? 'Illustrative photo for sample inventory.' : 'Photo supplied by the listing owner.' : 'No listing photo has been provided.'}</p>
    <section className="moderation-review-section"><h3>Listing details</h3><p className="moderation-review-description">{listing.description}</p><dl className="moderation-facts"><div><dt>Price</dt><dd>{moneyLabel(listing.price)}{listing.unit !== 'item' && ` / ${listing.unit}`}</dd></div><div><dt>Condition</dt><dd>{listing.condition}</dd></div><div><dt>Meet-up location</dt><dd>{listing.location}</dd></div><div><dt>Listing campus</dt><dd>{campus?.name ?? 'Campus unavailable'}</dd></div><div><dt>Submitted</dt><dd><time dateTime={listing.created_at}>{dateLabel(listing.created_at)}</time></dd></div><div><dt>Listing reference</dt><dd className="moderation-reference">{listing.id}</dd></div></dl></section>
    <section className="moderation-owner"><span className="avatar">{owner?.avatar ?? 'UC'}</span><div><h3>{owner?.name ?? 'Owner unavailable'}</h3><p>{owner ? `${owner.role === 'admin' ? 'Administrator' : owner.role === 'business' ? 'Business' : 'Student'} · ${ownerCampus?.short_name ?? 'University not selected'}` : 'Refresh records before deciding.'}</p><div>{owner?.verified && <Badge tone="green">{owner.role === 'admin' ? 'Administrator access' : owner.role === 'business' ? 'Business approved' : 'Campus verified'}</Badge>}{owner && !owner.verified && <Badge tone="amber">Campus not verified</Badge>}{owner?.suspended && <Badge tone="red">Account suspended</Badge>}</div></div></section>
    <div className="moderation-exchange-context"><ClipboardCheck size={19} /><p><strong>{exchanges.length} linked {exchanges.length === 1 ? 'exchange' : 'exchanges'} · {ongoing} ongoing</strong><span>Removing this listing prevents new requests. Existing exchanges keep their own activity and resolution records.</span></p></div>
    <section className="moderation-review-section"><div className="moderation-section-title"><h3>Community reports</h3><Badge tone={openReports.length ? 'red' : 'blue'}>{openReports.length} open</Badge></div>{reports.length ? <div className="moderation-reports">{reports.map(report => <article key={report.id}><div><strong>{report.subject}</strong><Badge tone={report.status === 'open' ? 'amber' : 'green'}>{report.status}</Badge></div><p>{report.body}</p><small><time dateTime={report.created_at}>{dateLabel(report.created_at)}</time> · Ref. {report.id.slice(0, 8).toUpperCase()}</small>{report.resolution && <p className="moderation-report-response"><strong>Recorded response:</strong> {report.resolution}</p>}<Link href={`/admin/support?type=report&ticket=${encodeURIComponent(report.id)}`} className="text-link">Open report<ArrowRight size={13} /></Link></article>)}</div> : <p className="moderation-quiet">No community reports are linked to this listing.</p>}</section>
    <ModerationHistory entity="listing" id={id} />
    <ModerationDecision key={listing.status} entity="listing" id={id} status={listing.status} hasOpenReports={openReports.length > 0} onDone={onDone} />
  </div>;
}

export function DealReview({ id, onDone }: { id: string; onDone?: () => void }) {
  const { data } = useApp();
  if (data.user.role !== 'admin') return <p className="moderation-review-message">Administrator access is required to review business offers.</p>;
  const deal = data.deals.find(item => item.id === id);
  if (!deal) return <UnavailableRecord kind="offer" />;
  const business = data.businesses.find(item => item.id === deal.business_id), owner = data.profiles.find(item => item.id === deal.owner_id), campus = data.colleges.find(item => item.id === deal.college_id);
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date());
  const expired = deal.expires_on < today;
  return <div className="moderation-review"><div className="moderation-review-heading"><div><span className="eyebrow">BUSINESS OFFER</span><h3>{deal.title}</h3></div><Badge tone={tone(deal.status)}>{deal.status}</Badge></div><section className="moderation-review-section"><p className="moderation-review-description">{deal.description}</p><dl className="moderation-facts"><div><dt>Business</dt><dd>{business?.name ?? 'Business unavailable'}</dd></div><div><dt>Campus</dt><dd>{campus?.name ?? 'Campus unavailable'}</dd></div><div><dt>Offer code</dt><dd>{deal.code}</dd></div><div><dt>Valid through</dt><dd>{new Date(deal.expires_on + 'T12:00:00+05:30').toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' })}{expired && <small>Expired · approval unavailable</small>}</dd></div><div><dt>Location</dt><dd>{business?.location ?? 'Not recorded'}</dd></div><div><dt>Submitted</dt><dd>{dateLabel(deal.created_at)}</dd></div><div><dt>Offer reference</dt><dd className="moderation-reference">{deal.id}</dd></div></dl></section><section className="moderation-owner"><span className="avatar">{owner?.avatar ?? 'UC'}</span><div><h3>{owner?.name ?? 'Owner unavailable'}</h3><p>{business?.category ?? 'Campus business'} · {owner?.suspended ? 'Account suspended' : 'Business owner'}</p><Badge tone={business?.verified ? 'green' : 'amber'}>{business?.verified ? 'Business approved' : 'Business not verified'}</Badge></div></section><ModerationHistory entity="deal" id={id} /><ModerationDecision key={`${id}-${deal.status}`} entity="deal" id={id} status={deal.status} expired={expired} onDone={onDone} /></div>;
}

function ModerationHistory({ entity, id }: { entity: 'listing' | 'deal'; id: string }) {
  const { data } = useApp();
  const history = data.audit.filter(record => record.target_id === id && record.action.startsWith(entity + '.')).toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return <section className="moderation-review-section"><div className="moderation-section-title"><h3><FileClock size={18} />Recorded moderation history</h3><span>{history.length}</span></div>{history.length ? <ol className="moderation-history">{history.map(record => <li key={record.id}><div className="moderation-history-marker"><ClipboardCheck size={16} /></div><div><strong>{record.action.endsWith('.approve') ? 'Approved for the marketplace' : record.action.endsWith('.remove') ? 'Removed from the marketplace' : record.action}</strong><small>{data.profiles.find(person => person.id === record.actor_id)?.name ?? 'Administrator'} · <time dateTime={record.created_at}>{dateLabel(record.created_at)}</time></small><p>{record.reason}</p></div></li>)}</ol> : <p className="moderation-quiet">No moderation decisions have been recorded for this {entity === 'listing' ? 'listing' : 'offer'}.</p>}</section>;
}

function ModerationDecision({ entity, id, status, expired = false, hasOpenReports = false, onDone }: { entity: 'listing' | 'deal'; id: string; status: 'pending' | 'active' | 'removed' | 'closed'; expired?: boolean; hasOpenReports?: boolean; onDone?: () => void }) {
  const { run, refresh } = useApp();
  const inputId = useId(), lock = useRef(false);
  const [decision, setDecision] = useState<'approve' | 'remove'>(status === 'pending' && !expired ? 'approve' : 'remove');
  const [reason, setReason] = useState(''), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const decisions = moderationDecisions(status, expired);
  if (!decisions.length) return <div className="moderation-readonly"><ShieldCheck size={19} /><p><strong>This record is {status}.</strong> Its moderation history is available above.{hasOpenReports ? ' Linked reports still need a separate response in Disputes & support.' : ''}</p></div>;
  if (saved) return <div className="moderation-readonly" role="status"><CheckCircle2 size={20} /><p>Decision saved. Refresh the workspace to see the recorded outcome.</p></div>;
  return <form className="moderation-decision" onSubmit={async event => {
    event.preventDefault();
    if (lock.current || !checked || !decisions.includes(decision)) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 500) { setError('Give a clear reason between 5 and 500 characters.'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await run({ type: 'moderate', entity, target_id: id, decision, reason: trimmed }, 'Moderation decision recorded'); setSaved(true); onDone?.(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The decision could not be saved.'); try { await refresh(); } catch { /* Keep the original command error visible. */ } }
    finally { lock.current = false; setBusy(false); }
  }}>
    <fieldset disabled={busy}><legend><ClipboardCheck size={19} />Record your decision</legend><p>Review the content, owner context and any reports above. Your account, decision time and reason will be recorded.</p>
      <div className="moderation-decision-options" role="radiogroup" aria-label="Moderation decision">{decisions.map(value => <label key={value} className={decision === value ? 'selected' : ''}><input type="radio" name={inputId + '-decision'} value={value} checked={decision === value} onChange={() => { setDecision(value); setChecked(false); setError(''); }} /><span><strong>{value === 'approve' ? 'Approve submission' : status === 'pending' ? 'Decline submission' : 'Remove from marketplace'}</strong><small>{value === 'approve' ? 'Make this submission active for its campus.' : 'Hide this content and retain its records.'}</small></span></label>)}</div>
      {expired && <p className="moderation-decision-note">This offer has expired and cannot be approved.</p>}
      <label htmlFor={inputId + '-reason'}>Decision reason</label><textarea id={inputId + '-reason'} required minLength={5} maxLength={500} value={reason} onChange={event => { setReason(event.target.value); setError(''); }} rows={4} placeholder="Explain what you checked and why this outcome is appropriate." aria-describedby={inputId + '-help'} /><small id={inputId + '-help'}>5–500 characters · Saved to the moderation audit log.</small>
      <label className="moderation-decision-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} required /><span>I reviewed the submission details and available reports before making this decision.</span></label>
      {hasOpenReports && <p className="moderation-decision-note">This decision changes the listing’s visibility. Respond to linked community reports separately.</p>}
      <button type="submit" className={'button ' + (decision === 'remove' ? 'danger-outline' : 'primary')} disabled={!checked || reason.trim().length < 5}>{busy ? <LoaderCircle size={16} className="spin" /> : <ClipboardCheck size={16} />}{busy ? 'Saving decision' : decision === 'approve' ? 'Approve & record decision' : status === 'pending' ? 'Decline & record decision' : 'Remove & record decision'}</button>
    </fieldset>{error && <p className="form-error" role="alert">{error} The records were refreshed where possible; review the current status before trying again.</p>}
  </form>;
}

function UnavailableRecord({ kind }: { kind: 'listing' | 'offer' }) {
  const { refresh } = useApp();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="moderation-unavailable"><ImageOff size={29} /><h3>This {kind} is unavailable.</h3><p>It may no longer be included in the current workspace. Refresh before continuing.</p><button type="button" className="button secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await refresh(); } catch { setError('The record could not be refreshed. Try again.'); } finally { setBusy(false); } }}><RefreshCw size={15} className={busy ? 'spin' : ''} />Refresh records</button>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
