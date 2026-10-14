'use client';

import { useMemo, useState } from 'react';
import { CheckCheck, ClipboardCheck, Clock3, GraduationCap, Search, ShieldCheck, Store } from 'lucide-react';
import { buildAdminAnalytics } from '@/lib/admin-analytics';
import type { Verification } from '@/lib/domain';
import { useApp } from './provider';
import { useAdminFilters } from './admin-filters';
import { Empty, Modal } from './primitives';
import { VerificationReview } from './verification-review';

const statuses = ['pending', 'approved', 'rejected', 'all'] as const;
const statusLabel = { pending: 'Awaiting review', approved: 'Approved', rejected: 'Not approved', all: 'All applications' };
const submitted = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export function VerificationWorkspace() {
  const { data } = useApp();
  const filters = useAdminFilters();
  const [status, setStatus] = useState<typeof statuses[number]>('pending');
  const [kind, setKind] = useState('all'), [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const scoped = useMemo(() => buildAdminAnalytics(data, { campus: filters.campus, days: filters.days }).scoped.verifications, [data, filters.campus, filters.days]);
  const pending = scoped.filter(item => item.status === 'pending');
  const q = [filters.search, query].filter(Boolean).join(' ').trim().toLowerCase();
  const records = scoped.filter(item => {
    const applicant = data.profiles.find(profile => profile.id === item.user_id);
    const college = data.colleges.find(campus => campus.id === item.college_id);
    return (status === 'all' || item.status === status) && (kind === 'all' || item.kind === kind) &&
      (!q || `${applicant?.name ?? ''} ${college?.name ?? ''} ${college?.short_name ?? ''} ${item.id} ${item.detail}`.toLowerCase().includes(q));
  }).toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  function badge(item: Verification) {
    return <span className={`pill ${item.status === 'approved' ? 'green' : item.status === 'rejected' ? 'red' : 'amber'}`}>{statusLabel[item.status]}</span>;
  }
  return <div className="verification-workspace">
    <header className="verification-workspace-heading"><div><span className="eyebrow">TRUST & SAFETY</span><h1>A stronger circle starts with a real check.</h1><p>Review campus eligibility and business applications with a clear, recorded decision.</p></div><span className="verification-workspace-emblem"><ShieldCheck size={29} /></span></header>
    <div className="verification-workspace-metrics" aria-label="Verification summary">
      {[{ label: 'Awaiting review', value: pending.length, icon: Clock3, tone: 'amber' }, { label: 'Campus applications', value: pending.filter(item => item.kind === 'campus').length, icon: GraduationCap, tone: 'blue' }, { label: 'Business applications', value: pending.filter(item => item.kind === 'business').length, icon: Store, tone: 'purple' }, { label: 'Decisions recorded', value: scoped.filter(item => item.status !== 'pending').length, icon: CheckCheck, tone: 'green' }].map(({ label, value, icon: Icon, tone }) => <div key={label}><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><strong>{value}</strong><span>{label}</span></div></div>)}
    </div>
    <section className="verification-workspace-policy"><ClipboardCheck size={21} /><div><strong>Check eligibility before approving.</strong><p>Use an official campus contact, a verified campus email, or an in-person check. An application’s text alone does not confirm eligibility. You cannot review your own application.</p></div></section>
    <section className="verification-workspace-list">
      <div className="verification-workspace-toolbar"><div className="verification-workspace-tabs" aria-label="Application status">{statuses.map(value => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{statusLabel[value]}<span>{value === 'all' ? scoped.length : scoped.filter(item => item.status === value).length}</span></button>)}</div>
        <div className="verification-workspace-filters"><label><Search size={16} /><input aria-label="Search verification applications" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a name, campus or reference" type="search" /></label><select aria-label="Application type" value={kind} onChange={event => setKind(event.target.value)}><option value="all">All application types</option><option value="campus">Campus membership</option><option value="business">Campus business</option></select></div>
      </div>
      <div className="verification-workspace-results" role="status">{records.length} {records.length === 1 ? 'application' : 'applications'} · Campus and date filters apply to submission dates.</div>
      {records.length ? <div className="verification-workspace-records">{records.map(item => {
        const applicant = data.profiles.find(profile => profile.id === item.user_id);
        const college = data.colleges.find(campus => campus.id === item.college_id);
        return <article className="verification-workspace-record" key={item.id}><div className="verification-workspace-person"><span className="avatar">{applicant?.avatar ?? 'UC'}</span><div><h2>{applicant?.name ?? 'Campus member'}</h2><p>{college?.short_name ?? 'Campus unavailable'} <span>·</span> {item.kind === 'campus' ? 'Campus membership' : 'Campus business'}</p></div>{badge(item)}</div><p className="verification-workspace-preview">{item.detail}</p><div className="verification-workspace-record-footer"><div><time dateTime={item.created_at}>Submitted {submitted(item.created_at)} IST</time><span>Ref. {item.id.slice(0, 8).toUpperCase()}{item.status === 'pending' && item.user_id === data.user.id ? ' · Your application needs another reviewer' : ''}</span></div><button type="button" className="button secondary" aria-label={`${item.status === 'pending' ? 'Review application' : 'View decision'} for ${applicant?.name ?? 'campus member'}`} onClick={() => setSelected(item.id)}>{item.status === 'pending' ? 'Review application' : 'View decision'}</button></div></article>;
      })}</div> : <Empty title={status === 'pending' && !query && kind === 'all' ? 'No applications awaiting review.' : 'No applications match this view.'} body="Try another status, type, search, or campus filter." />}
    </section>
    <p className="verification-workspace-footnote">A verification confirms the checks recorded for that campus or business. Keep payment decisions and sensitive documents out of application notes.</p>
    {selected && <Modal title="Review verification application" onClose={() => setSelected(null)}><VerificationReview id={selected} /></Modal>}
  </div>;
}
