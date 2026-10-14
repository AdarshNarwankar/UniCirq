'use client';

import { useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ReviewMethod } from '@/lib/domain';
import { useApp } from './provider';
import { Badge } from './primitives';

const methods: { value: ReviewMethod; label: string; detail: string }[] = [
  { value: 'campus_email', label: 'Campus email', detail: 'Control of an institution-issued mailbox was independently confirmed.' },
  { value: 'campus_office', label: 'Campus office', detail: 'Eligibility was confirmed through an authorized campus office.' },
  { value: 'in_person', label: 'In person', detail: 'Eligibility was checked with the applicant in person.' },
  { value: 'public_business', label: 'Public business records', detail: 'Business eligibility was checked against an independent public source.' },
];
const dateLabel = (value?: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST';
};

export function VerificationReview({ id, onDone }: { id: string; onDone?: () => void }) {
  return <ReviewContent key={id} id={id} onDone={onDone} />;
}

function ReviewContent({ id, onDone }: { id: string; onDone?: () => void }) {
  const { data, run, refresh } = useApp();
  const inputId = useId();
  const lock = useRef(false);
  const [method, setMethod] = useState<ReviewMethod | ''>('');
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'refresh' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const application = data.verifications.find(item => item.id === id);

  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy('refresh'); setError('');
    try { await refresh(); }
    catch { setError('Could not refresh this application. Please try again.'); }
    finally { lock.current = false; setBusy(null); }
  }

  if (data.user.role !== 'admin') return <p className="verification-review-message">Administrator access is required to review applications.</p>;
  if (!application) return <div className="verification-review verification-review-unavailable"><AlertTriangle size={25} /><h3>Application unavailable</h3><p>This application is not in the current workspace. Refresh the records before continuing.</p><button type="button" className="button secondary" disabled={!!busy} onClick={reload}><RefreshCw size={15} className={busy ? 'spin' : ''} />Refresh records</button>{error && <p className="form-error" role="alert">{error}</p>}</div>;

  const applicant = data.profiles.find(person => person.id === application.user_id);
  const campus = data.colleges.find(college => college.id === application.college_id);
  const selectedCampus = data.colleges.find(college => college.id === applicant?.college_id);
  const reviewer = data.profiles.find(person => person.id === application.reviewed_by);
  const pending = application.status === 'pending';
  const decisionBlocks: string[] = [];
  const approvalBlocks: string[] = [];
  if (application.user_id === data.user.id) decisionBlocks.push('You cannot review your own application. Another administrator must decide.');
  if (!applicant) decisionBlocks.push('The applicant profile is unavailable. Refresh the workspace before making a decision.');
  else {
    if (applicant.suspended) decisionBlocks.push('The applicant account is suspended. This application cannot be decided while the suspension is active.');
    if (applicant.role !== 'student') decisionBlocks.push('The applicant is no longer a Student. This application cannot be decided.');
    if (!applicant.college_id || applicant.college_id !== application.college_id) approvalBlocks.push('The application campus does not match the applicant’s selected university. Approval is unavailable; you can reject this outdated request with a reason.');
    if (application.kind === 'business' && !applicant.verified) approvalBlocks.push('Business approval requires an already verified Student. You can reject this request with a reason.');
    if (application.kind === 'business' && data.orders.some(order => [order.buyer_id, order.seller_id].includes(applicant.id) && !['completed', 'cancelled'].includes(order.status))) approvalBlocks.push('The applicant has unfinished student exchanges. They must be resolved before business approval.');
  }
  const availableMethods = methods.filter(item => application.kind === 'business' || item.value !== 'public_business');
  const selectedMethod = availableMethods.find(item => item.value === method);
  const blocked = decisionBlocks.length > 0;

  return <div className="verification-review">
    <div className="verification-review-person"><span className="avatar large">{applicant?.avatar || '?'}</span><div><h3>{applicant?.name ?? 'Applicant unavailable'}</h3><p>{application.kind === 'business' ? 'Campus business application' : 'Student campus application'}</p></div><Badge tone={pending ? 'amber' : application.status === 'approved' ? 'green' : 'red'}>{application.status}</Badge></div>
    <dl className="verification-review-facts">
      <div><dt>Application campus</dt><dd>{campus?.name ?? 'Campus unavailable'}{campus?.city && <small>{campus.city}</small>}</dd></div>
      <div><dt>Selected university</dt><dd>{selectedCampus?.name ?? (applicant?.college_id ? 'Campus unavailable' : 'Not selected')}</dd></div>
      <div><dt>Current account</dt><dd>{applicant ? `${applicant.role === 'admin' ? 'Administrator' : applicant.role === 'business' ? 'Business' : 'Student'} · ${applicant.suspended ? 'Suspended' : 'Active'}` : 'Unavailable'}</dd></div>
      <div><dt>Eligibility status</dt><dd>{applicant ? applicant.role === 'admin' ? 'Administrator access' : applicant.verified ? applicant.role === 'business' ? 'Business approved' : 'Campus verified' : 'Verification required' : 'Unavailable'}</dd></div>
      {applicant?.course && <div><dt>Course</dt><dd>{applicant.course}</dd></div>}
      {applicant?.year && <div><dt>Year</dt><dd>{applicant.year}</dd></div>}
      <div><dt>Submitted</dt><dd><time dateTime={application.created_at}>{dateLabel(application.created_at)}</time></dd></div>
      <div><dt>Application reference</dt><dd className="verification-review-reference">{application.id}</dd></div>
    </dl>
    <section className="verification-review-submission" aria-labelledby={`${inputId}-submission`}><h3 id={`${inputId}-submission`}>Applicant’s statement</h3><p>{application.detail}</p></section>

    {!pending ? <section className="verification-review-outcome" aria-labelledby={`${inputId}-outcome`}><div><ClipboardCheck size={20} /><h3 id={`${inputId}-outcome`}>Recorded outcome</h3></div><dl className="verification-review-facts"><div><dt>Decision</dt><dd>{application.status === 'approved' ? 'Approved' : 'Rejected'}</dd></div><div><dt>Reviewed</dt><dd>{dateLabel(application.reviewed_at)}</dd></div><div><dt>Reviewer</dt><dd>{reviewer?.name ?? (application.reviewed_by ? 'Administrator' : 'Not recorded')}</dd></div>{application.review_method && <div><dt>Check method</dt><dd>{methods.find(item => item.value === application.review_method)?.label ?? 'Not recorded'}</dd></div>}</dl><h4>Reason shared with applicant</h4><p>{application.reason || 'No reason recorded.'}</p></section> : saved ? <div className="verification-review-saved" role="status"><CheckCircle2 size={22} /><p>Decision saved. Refresh the records to view the recorded outcome.</p><button type="button" className="button secondary" disabled={!!busy} onClick={reload}>Refresh outcome</button></div> : <>
      {(decisionBlocks.length > 0 || approvalBlocks.length > 0) && <div className="verification-review-blocks" role="note"><AlertTriangle size={19} /><div>{[...decisionBlocks, ...approvalBlocks].map(message => <p key={message}>{message}</p>)}</div></div>}
      <form className="verification-review-form" aria-describedby={`${inputId}-guidance`} onSubmit={async event => {
        event.preventDefault();
        if (lock.current || blocked || saved || !pending) return;
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const decision = submitter instanceof HTMLButtonElement ? submitter.value : '';
        if (decision !== 'approve' && decision !== 'reject') return;
        const trimmedReason = reason.trim();
        if (trimmedReason.length < 5 || trimmedReason.length > 500) { setError('Give a decision reason between 5 and 500 characters.'); return; }
        if (decision === 'approve' && (approvalBlocks.length > 0 || !selectedMethod || !checked)) { setError('Complete an eligible independent check and confirm it before approval.'); return; }
        lock.current = true; setBusy(decision); setError('');
        try {
          await run({ type: 'moderate', entity: 'verification', target_id: application.id, decision, reason: trimmedReason, ...(decision === 'approve' ? { review_method: selectedMethod!.value, evidence_checked: true } : {}) }, 'Verification decision recorded');
          setSaved(true); onDone?.();
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'The decision could not be saved. Please try again.';
          try { await refresh(); } catch { /* Preserve the command error if the follow-up refresh is unavailable. */ }
          setError(message);
        } finally { lock.current = false; setBusy(null); }
      }}>
        <fieldset disabled={!!busy || blocked}>
          <legend><ShieldCheck size={19} />Independent eligibility check</legend>
          <p id={`${inputId}-guidance`}>Record a check you completed outside UniCirq through a trusted campus or business source. The applicant’s statement alone does not establish eligibility.</p>
          <label htmlFor={`${inputId}-method`}>Check method <span>Required for approval</span></label>
          <select id={`${inputId}-method`} value={method} onChange={event => { setMethod(event.target.value as ReviewMethod | ''); setChecked(false); setError(''); }} disabled={approvalBlocks.length > 0}><option value="">Choose a check method</option>{availableMethods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {selectedMethod && <p className="verification-review-method">{selectedMethod.detail}</p>}
          <label className="verification-review-check"><input type="checkbox" checked={checked} disabled={!selectedMethod || approvalBlocks.length > 0} onChange={event => { setChecked(event.target.checked); setError(''); }} /><span>I independently confirmed this applicant’s {application.kind === 'business' ? 'campus business eligibility' : 'current campus eligibility'} using the selected method.</span></label>
          <label htmlFor={`${inputId}-reason`}>Decision reason <span>Shared with the applicant</span></label>
          <textarea id={`${inputId}-reason`} required minLength={5} maxLength={500} rows={4} value={reason} onChange={event => { setReason(event.target.value); setError(''); }} aria-describedby={`${inputId}-reason-help`} placeholder="Explain the check and outcome, or what the applicant needs to correct." />
          <p className="verification-review-reason-help" id={`${inputId}-reason-help`}>Use 5–500 characters. Keep student ID numbers, passwords and sensitive documents out of this reason.</p>
          <div className="verification-review-actions"><button type="submit" name="decision" value="reject" className="button danger-outline">{busy === 'reject' && <LoaderCircle size={16} className="spin" />}Reject with reason</button><button type="submit" name="decision" value="approve" className="button primary" disabled={approvalBlocks.length > 0 || !selectedMethod || !checked}>{busy === 'approve' && <LoaderCircle size={16} className="spin" />}Approve application</button></div>
        </fieldset>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="verification-review-footer">Your account and decision time are recorded. Approval enables {application.kind === 'business' ? 'the campus business role' : 'verified student participation'}.</p>
    </>}
  </div>;
}
