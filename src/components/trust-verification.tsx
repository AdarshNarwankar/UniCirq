'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, BadgeCheck, Check, ChevronDown, Clock3, FileCheck2, GraduationCap, Info, LoaderCircle, LockKeyhole, Mail, MapPin, MessageCircle, RefreshCw, ShieldAlert, ShieldCheck, Store } from 'lucide-react';
import type { Verification } from '@/lib/domain';
import { useApp } from './provider';

type ReviewedApplication = Verification & {
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_method?: string | null;
};

const dates = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateLabel = (value?: string | null) => value && !Number.isNaN(Date.parse(value)) ? dates.format(new Date(value)) : null;
const applicationName = (kind: Verification['kind']) => kind === 'campus' ? 'Campus membership' : 'Campus business';
const methods: Record<string, string> = {
  campus_email: 'University email checked',
  campus_office: 'Campus office confirmation',
  in_person: 'In-person campus check',
  public_business: 'Public business details checked',
};
const years = ['', '1st year', '2nd year', '3rd year', '4th year', 'Postgraduate', 'Alumni'];

export function TrustVerification() {
  const { data, run, refresh } = useApp();
  const { user } = data;
  const campus = data.colleges.find(college => college.id === user.college_id);
  const base = `/${user.role}`;
  const applications: ReviewedApplication[] = data.verifications.filter(application => application.user_id === user.id)
    .toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const campusApplication = applications.find(application => application.kind === 'campus' && application.college_id === user.college_id);
  const businessApplication = applications.find(application => application.kind === 'business' && application.college_id === user.college_id);
  const campusVerified = user.role === 'student' && user.verified;
  const businessApproved = user.role === 'business' && user.verified;
  const activeApplication = user.role === 'student' ? campusApplication : user.role === 'business' ? businessApplication : undefined;
  const approvedApplication = applications.find(application => application.college_id === user.college_id && application.kind === (user.role === 'business' ? 'business' : 'campus') && application.status === 'approved');
  const approvedDate = dateLabel(approvedApplication?.reviewed_at);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submissionLock = useRef(false);
  const refreshLock = useRef(false);

  const state = user.role === 'admin' ? 'admin' : campusVerified || businessApproved ? 'approved' : activeApplication?.status === 'pending' ? 'pending' : activeApplication?.status === 'rejected' ? 'rejected' : 'needed';
  const title = state === 'admin' ? 'Administrator access is active' : state === 'approved' ? businessApproved ? 'Your business is approved' : 'Campus membership confirmed' : state === 'pending' ? user.role === 'business' ? 'Your business review is in progress' : 'Your campus review is in progress' : state === 'rejected' ? 'Your application needs an update' : 'Verify your campus membership';
  const description = state === 'admin' ? 'Your account can review applications and manage the community.'
    : state === 'approved' ? businessApproved ? 'Your account is approved to publish deals for your selected campus.' : 'Your campus membership is verified. You can list, request and connect with your circle.'
    : state === 'pending' ? 'Your details have been submitted. You can follow the review below.'
    : state === 'rejected' ? 'Read the reviewer’s feedback and submit updated details when you are ready.'
    : user.role === 'business' ? 'Contact support to check the eligibility of this business account.' : 'Send a few details for an eligibility review before listing items or starting conversations.';

  async function refreshStatus() {
    if (refreshLock.current || submissionLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    setError('');
    setNotice('');
    try { await refresh(); setNotice('Your verification status is up to date.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to refresh your status. Try again.'); }
    finally { refreshLock.current = false; setRefreshing(false); }
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>, kind: Verification['kind']) {
    event.preventDefault();
    if (submissionLock.current || refreshLock.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key) ?? '').trim();
    setError('');
    setNotice('');
    if (!user.college_id || !campus) { setError('Choose your university before requesting verification.'); return; }
    const detail = kind === 'campus' ? [
      `Course: ${text('course')}`,
      `Year / affiliation: ${text('year')}`,
      `Contact for eligibility check: ${text('contact')}`,
      `Campus connection: ${text('eligibility')}`,
    ].join('\n') : [
      `Business name: ${text('business_name')}`,
      `Category: ${text('category')}`,
      `Public location: ${text('location')}`,
      `Public contact / website: ${text('contact')}`,
      `Campus connection: ${text('eligibility')}`,
    ].join('\n');
    if (detail.length > 2000) { setError('Please shorten your application to 2,000 characters in total.'); return; }
    if (!values.has('consent')) { setError('Please confirm that your application details are accurate.'); return; }
    submissionLock.current = true;
    setBusy(true);
    try {
      await run({ type: 'request_verification', college_id: user.college_id, kind, detail }, `${applicationName(kind)} application submitted`);
      setNotice('Your application has been sent for review. Check back here or in notifications for updates.');
      form.reset();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to send your application. Your details have been kept so you can try again.'); }
    finally { submissionLock.current = false; setBusy(false); }
  }

  function reviewDetails(application: ReviewedApplication, showSubmission = true) {
    const reviewed = dateLabel(application.reviewed_at);
    const method = application.review_method ? methods[application.review_method] : undefined;
    return <>
      <ol className="identity-trust-timeline" aria-label="Application progress">
        <li className="is-complete"><span className="identity-trust-timeline-dot"><Check size={12} aria-hidden="true" /></span><div><strong>Application submitted</strong><time dateTime={application.created_at}>{dateLabel(application.created_at) ?? 'Submission recorded'}</time></div></li>
        <li className={application.status === 'pending' ? 'is-current' : 'is-complete'}><span className="identity-trust-timeline-dot">{application.status === 'pending' ? <Clock3 size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}</span><div><strong>{application.status === 'pending' ? 'Waiting for eligibility review' : application.status === 'approved' ? 'Application approved' : 'Application reviewed — update needed'}</strong>{application.status === 'pending' ? <span>You’ll receive a notification after review.</span> : reviewed ? <time dateTime={application.reviewed_at ?? undefined}>{reviewed}</time> : <span>Decision recorded</span>}{method && <span>{method}</span>}</div></li>
      </ol>
      {application.reason && <div className={`identity-trust-review-feedback ${application.status === 'rejected' ? 'needs-update' : ''}`}><strong>{application.status === 'rejected' ? 'What to update' : 'Review note'}</strong><p>{application.reason}</p></div>}
      {showSubmission && <details className="identity-trust-submitted"><summary>View submitted details <ChevronDown size={15} aria-hidden="true" /></summary><p>{application.detail}</p></details>}
      <p className="identity-trust-reference">Application reference <span>{application.id}</span></p>
    </>;
  }

  function applicationForm(kind: Verification['kind'], previous?: ReviewedApplication) {
    const isCampus = kind === 'campus';
    return <details className="identity-trust-application-form" key={`${kind}-${previous?.id ?? 'new'}`} open={isCampus || undefined}>
      <summary><span><strong>{previous?.status === 'rejected' ? 'Update and resubmit your application' : isCampus ? 'Request campus membership verification' : 'Apply as a campus business'}</strong><small>{isCampus ? 'A few details to confirm your campus connection.' : 'A separate review for businesses serving your campus.'}</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
      <form className="stack-form identity-trust-form" onSubmit={event => submitApplication(event, kind)} aria-busy={busy}>
        <fieldset className="identity-trust-form-fields" disabled={busy || refreshing}>
          <legend className="identity-trust-visually-hidden">{applicationName(kind)} application</legend>
          <div className="identity-trust-selected-campus"><MapPin size={18} aria-hidden="true" /><div><small>Selected campus</small><strong>{campus?.name ?? 'University not selected'}</strong>{campus?.city && <span>{campus.city}</span>}</div><LockKeyhole size={15} aria-label="Your application uses your selected campus" /></div>
          {isCampus ? <div className="form-row"><label htmlFor="identity-trust-campus-course">Course / programme<input id="identity-trust-campus-course" name="course" required minLength={2} maxLength={80} defaultValue={user.course} placeholder="e.g. B.Tech Computer Science" autoComplete="off" /></label><label htmlFor="identity-trust-campus-year">Year / affiliation<select id="identity-trust-campus-year" name="year" required defaultValue={user.year || ''}>{user.year && !years.includes(user.year) && <option value={user.year}>{user.year}</option>}{years.map(year => <option key={year} value={year}>{year || 'Select your year'}</option>)}</select></label></div>
            : <><label htmlFor="identity-trust-business-name">Public business name<input id="identity-trust-business-name" name="business_name" required minLength={3} maxLength={100} placeholder="The name students know your business by" autoComplete="organization" /></label><div className="form-row"><label htmlFor="identity-trust-business-category">Business category<select id="identity-trust-business-category" name="category" required defaultValue=""><option value="">Choose a category</option>{['Food & drinks', 'Stationery & printing', 'Student services', 'Electronics & repairs', 'Fitness & wellbeing', 'Other'].map(category => <option key={category}>{category}</option>)}</select></label><label htmlFor="identity-trust-business-location">Public business location<input id="identity-trust-business-location" name="location" required minLength={3} maxLength={150} placeholder="Shop name, street or campus area" /></label></div></>}
          <label htmlFor={`identity-trust-${kind}-contact`}>{isCampus ? 'University email or campus contact' : 'Public contact or business website'}<input id={`identity-trust-${kind}-contact`} name="contact" required minLength={5} maxLength={160} placeholder={isCampus ? 'University email or department contact the team can check' : 'Public email, phone or website'} autoComplete="off" aria-describedby={`identity-trust-${kind}-contact-help`} /><small id={`identity-trust-${kind}-contact-help`} className="identity-trust-field-help">{isCampus ? 'Shared with reviewers. An email address alone does not grant campus verification.' : 'Use contact details already available to your customers.'}</small></label>
          <label htmlFor={`identity-trust-${kind}-eligibility`}>{isCampus ? 'Campus details' : 'How does your business serve this campus?'}<textarea id={`identity-trust-${kind}-eligibility`} name="eligibility" required minLength={20} maxLength={1000} rows={4} placeholder={isCampus ? 'e.g. I’m a 3rd-year B.Tech CSE student.' : 'Describe your service, student eligibility and a public way to confirm your business.'} /></label>
          <label className="checkbox" htmlFor={`identity-trust-${kind}-consent`}><input id={`identity-trust-${kind}-consent`} type="checkbox" name="consent" required /><span>I confirm these details are accurate and can be checked by the UniCirq team.</span></label>
          <div className="identity-trust-form-footer"><span><LockKeyhole size={14} aria-hidden="true" />Application details are shared with reviewers.</span><button className="button primary" type="submit" disabled={!campus || busy || refreshing}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <FileCheck2 size={16} aria-hidden="true" />}{busy ? 'Submitting…' : previous?.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}</button></div>
        </fieldset>
      </form>
    </details>;
  }

  return <section className="identity-panel identity-trust-panel" id="verification" aria-labelledby="identity-trust-heading">
    <header className="identity-trust-heading"><div><span className="eyebrow">MEMBERSHIP & ACCESS</span><h2 id="identity-trust-heading">{user.role === 'admin' ? 'Trust & account access' : 'Trust & verification'}</h2><p>Your account credentials, clearly explained.</p></div><span className="identity-trust-heading-icon"><ShieldCheck size={23} aria-hidden="true" /></span></header>
    {data.demo && <p className="identity-trust-demo-note"><Info size={15} aria-hidden="true" />Demo account · These sample statuses do not confirm a real identity or campus membership.</p>}
    <div className="identity-trust-overview"><div className={`identity-trust-status-hero is-${state}`}><span className="identity-trust-hero-icon">{state === 'approved' || state === 'admin' ? <BadgeCheck size={29} aria-hidden="true" /> : state === 'pending' ? <Clock3 size={29} aria-hidden="true" /> : <ShieldAlert size={29} aria-hidden="true" />}</span><div><span className={`identity-trust-status-pill is-${state}`}>{data.demo ? 'Demo · ' : ''}{state === 'admin' ? 'Administrator' : state === 'approved' ? businessApproved ? 'Business approved' : 'Campus verified' : state === 'pending' ? 'Under review' : state === 'rejected' ? 'Action required' : 'Verification needed'}</span><h3>{title}</h3><p>{description}</p>{state === 'approved' && approvedDate && <small>Approved {approvedDate}</small>}</div></div>
    <div className="identity-trust-checks" aria-label="Account verification checks">
      <div className={`identity-trust-check ${data.demo ? '' : 'is-complete'}`}><span className="identity-trust-check-icon"><Mail size={18} aria-hidden="true" /></span><div><strong>Email address</strong><span>{data.demo ? 'Sample account' : 'Confirmed at sign-in'}</span></div>{!data.demo && <Check size={16} aria-label="Confirmed" />}</div>
      <div className={`identity-trust-check ${campus ? 'is-selected' : ''}`}><span className="identity-trust-check-icon"><GraduationCap size={19} aria-hidden="true" /></span><div><strong>{user.role === 'business' ? 'Business campus' : 'University selected'}</strong><span>{campus?.short_name ?? campus?.name ?? 'Not selected'}</span></div>{campus && <MapPin size={15} aria-label="Campus selected" />}</div>
      <div className={`identity-trust-check ${state === 'approved' || state === 'admin' ? 'is-complete' : ''}`}><span className="identity-trust-check-icon">{user.role === 'business' ? <Store size={18} aria-hidden="true" /> : <ShieldCheck size={19} aria-hidden="true" />}</span><div><strong>{user.role === 'admin' ? 'Platform access' : user.role === 'business' ? 'Business approval' : 'Campus membership'}</strong><span>{user.role === 'admin' ? 'Administrator' : state === 'approved' ? 'Verified' : state === 'pending' ? 'Under review' : state === 'rejected' ? 'Update needed' : 'Not verified'}</span></div>{(state === 'approved' || state === 'admin') && <Check size={16} aria-label="Approved" />}</div>
    </div>
    </div>
    {user.role === 'student' && <>
      {!campusVerified && activeApplication && <article className={`identity-trust-current-application is-${activeApplication.status}`}><div className="identity-trust-section-title"><div><h3>Campus membership application</h3><p>{campus?.name ?? 'Your selected campus'}</p></div><span className={`pill ${activeApplication.status === 'pending' ? 'amber' : activeApplication.status === 'rejected' ? 'red' : 'green'}`}>{activeApplication.status === 'pending' ? 'Under review' : activeApplication.status === 'rejected' ? 'Update needed' : 'Approved'}</span></div>{reviewDetails(activeApplication)}</article>}
      {!campusVerified && activeApplication?.status !== 'pending' && applicationForm('campus', campusApplication)}
      {campusVerified && <div className="identity-trust-unlocked"><Check size={17} aria-hidden="true" /><p><strong>Campus access unlocked</strong><span>Buy, sell, share skills and start conversations with your verified campus circle.</span></p><Link href="/student/create" className="text-link">Create a listing <ArrowUpRight size={15} aria-hidden="true" /></Link></div>}
      <div className="identity-trust-business-section"><div className="identity-trust-section-title"><div className="identity-trust-business-heading"><Store size={20} aria-hidden="true" /><div><h3>Run a business near campus?</h3><p>Business approval is reviewed separately from student membership.</p></div></div><span className="identity-trust-optional">Optional</span></div>
        {businessApplication?.status === 'pending' ? <article className="identity-trust-current-application is-pending"><div className="identity-trust-section-title"><h3>Business application</h3><span className="pill amber">Under review</span></div>{reviewDetails(businessApplication)}</article>
          : businessApplication?.status === 'approved' ? <div className="identity-trust-review-feedback"><strong>Business application approved</strong><p>If your account has not changed, refresh your status or contact support.</p></div>
          : campusVerified ? <>{businessApplication?.status === 'rejected' && <div className="identity-trust-review-feedback needs-update"><strong>Business application needs an update</strong><p>{businessApplication.reason || 'Review your business details before applying again.'}</p></div>}{applicationForm('business', businessApplication)}</>
          : <p className="identity-trust-business-locked"><LockKeyhole size={15} aria-hidden="true" />Complete campus membership verification to apply as a business.</p>}
      </div>
    </>}
    {user.role === 'business' && !businessApproved && businessApplication && <article className="identity-trust-current-application"><div className="identity-trust-section-title"><h3>Business application</h3><span className={`pill ${businessApplication.status === 'rejected' ? 'red' : 'amber'}`}>{businessApplication.status === 'pending' ? 'Under review' : businessApplication.status === 'rejected' ? 'Update needed' : 'Decision recorded'}</span></div>{reviewDetails(businessApplication)}</article>}
    {user.role === 'admin' && <div className="identity-trust-unlocked"><LockKeyhole size={18} aria-hidden="true" /><p><strong>Manage access carefully</strong><span>Review campus and business eligibility independently and keep a clear reason for each decision.</span></p><Link href="/admin/verifications" className="text-link">Review applications <ArrowUpRight size={15} aria-hidden="true" /></Link></div>}
    {(campusVerified || businessApproved) && <p className="identity-trust-meaning"><Info size={15} aria-hidden="true" />Verification confirms eligibility. Inspect items before handover and meet in public campus spaces.</p>}
    {applications.length > 0 && <details className="identity-trust-history"><summary><span><FileCheck2 size={17} aria-hidden="true" /><strong>Application history</strong><span className="identity-trust-history-count">{applications.length}</span></span><ChevronDown size={18} aria-hidden="true" /></summary><div className="identity-trust-history-list">{applications.map(application => <details className="identity-trust-history-item" key={application.id}><summary><span><strong>{applicationName(application.kind)}</strong><small>{data.colleges.find(college => college.id === application.college_id)?.name ?? 'Campus application'} · {dateLabel(application.created_at) ?? 'Submission recorded'}</small></span><span className={`pill ${application.status === 'approved' ? 'green' : application.status === 'rejected' ? 'red' : 'amber'}`}>{application.status === 'pending' ? 'Under review' : application.status === 'rejected' ? 'Not approved' : 'Approved'}</span><ChevronDown size={15} aria-hidden="true" /></summary><div>{reviewDetails(application)}</div></details>)}</div></details>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="identity-trust-feedback" role="status"><Check size={16} aria-hidden="true" />{notice}</p>}
    <footer className="identity-trust-footer"><span><ShieldCheck size={15} aria-hidden="true" />Your community, built on trust.</span><div><button type="button" className="text-button" onClick={refreshStatus} disabled={refreshing || busy}>{refreshing ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}{refreshing ? 'Refreshing…' : 'Refresh status'}</button><Link href={`${base}/support`} className="text-link"><MessageCircle size={15} aria-hidden="true" />Get help</Link></div></footer>
  </section>;
}
