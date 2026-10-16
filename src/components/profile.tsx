'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronRight, CircleCheck, GraduationCap, LoaderCircle, MapPin, Pencil, Settings, ShieldCheck, ShoppingBag, Store, UserRound } from 'lucide-react';
import { useApp } from './provider';
import { TrustVerification } from './trust-verification';

type Details = { name: string; bio: string; course: string; year: string };
const years = ['', '1st year', '2nd year', '3rd year', '4th year', 'Postgraduate', 'Alumni'];
const roleLabel = { student: 'Student', business: 'Campus business', admin: 'Administrator' };
const joined = (date: string) => new Date(date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export function Profile() {
  const { data, run } = useApp();
  const user = data.user, base = '/' + user.role;
  const campus = data.colleges.find(c => c.id === user.college_id);
  const details = (): Details => ({ name: user.name, bio: user.bio, course: user.course, year: user.year });
  const [draft, setDraft] = useState<Details>(details), [editing, setEditing] = useState(false), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { if (!dirty) setDraft({ name: user.name, bio: user.bio, course: user.course, year: user.year }); }, [user.name, user.bio, user.course, user.year, dirty]);
  const profileFields = [user.name.trim().length >= 2, Boolean(user.bio.trim()), ...(user.role === 'student' ? [Boolean(user.course.trim()), Boolean(user.year)] : [])];
  const completeness = Math.round(profileFields.filter(Boolean).length / profileFields.length * 100);
  const activeListings = data.listings.filter(l => l.owner_id === user.id && l.status === 'active').length;
  const completed = data.orders.filter(o => o.status === 'completed' && (o.buyer_id === user.id || o.seller_id === user.id)).length;
  const ownedBusiness = data.businesses.filter(b => b.owner_id === user.id);
  const deals = data.deals.filter(d => d.owner_id === user.id && d.status === 'active').length;
  const update = (field: keyof Details, value: string) => { setDraft(current => ({ ...current, [field]: value })); setDirty(true); setNotice(''); };

  return <div className="identity-profile-page">
    <header className="identity-page-heading"><div><span className="identity-eyebrow">ACCOUNT / PROFILE</span><h1>Your place in the circle.</h1><p>Your profile, campus credentials and activity.</p></div><Link className="button secondary" href={`${base}/settings`}><Settings size={16} />Settings</Link></header>
    <section className="identity-passport" aria-label="Your member card"><div className="identity-passport-main"><div className="identity-passport-top"><span className="identity-eyebrow">UNICIRQ MEMBER CARD</span><span className="identity-passport-role">{roleLabel[user.role]}</span></div><div className="identity-passport-person"><span className="identity-profile-avatar">{user.avatar || user.name.slice(0, 2).toUpperCase()}</span><div><h2>{user.name}</h2><p>{user.bio || 'A familiar face on campus.'}</p></div></div><div className="identity-passport-status"><ShieldCheck size={16}/><span>{user.role === 'admin' ? 'Administrator access' : user.verified ? user.role === 'business' ? 'Business approved' : 'Campus membership verified' : 'Campus verification needed'}</span><a href="#verification">View credentials <ArrowRight size={14}/></a></div></div><dl className="identity-passport-facts"><div><dt><MapPin size={15}/>University</dt><dd>{campus?.name ?? 'Campus not selected'}</dd></div><div><dt><CalendarDays size={15}/>Member since</dt><dd>{joined(user.created_at)}</dd></div>{user.role === 'student' && <div><dt><GraduationCap size={15}/>Course & year</dt><dd>{user.course || 'Add your course'}{user.year ? ` · ${user.year}` : ''}</dd></div>}<div className="identity-passport-edit"><dt className="identity-trust-visually-hidden">Profile actions</dt><dd><button className="button secondary" type="button" onClick={() => { setEditing(true); setError(''); setNotice(''); document.getElementById('identity-personal-details')?.scrollIntoView({behavior:'smooth',block:'center'}); }}><Pencil size={15}/>Edit your details</button></dd></div></dl></section>
    <div className="identity-profile-layout"><div className="identity-profile-content">
      <section className="identity-panel" id="identity-personal-details"><header className="identity-section-header"><div><h2>Personal details</h2><p>Your name and bio appear with your campus activity.</p></div><UserRound size={21} /></header>
        {editing ? <form className="stack-form" onSubmit={async event => {
          event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
          try { await run({ type: 'update_profile', ...draft }); setDirty(false); setEditing(false); setNotice('Your profile has been updated.'); }
          catch (err) { setError(err instanceof Error ? err.message : 'Unable to save your profile.'); }
          finally { setBusy(false); }
        }}><fieldset className="identity-form-fields" disabled={busy}><legend className="identity-trust-visually-hidden">Edit your personal details</legend><label>Your name<input name="name" required minLength={2} maxLength={60} value={draft.name} onChange={e => update('name', e.target.value)} autoComplete="name" /></label><label>Bio<textarea name="bio" aria-label="Bio" aria-describedby="profile-bio-count" maxLength={500} rows={4} value={draft.bio} onChange={e => update('bio', e.target.value)} placeholder="Interests, clubs, and a little about you…" /><small id="profile-bio-count" className="identity-character-count">{draft.bio.length}/500</small></label>{user.role === 'student' && <div className="form-row"><label>Course<input name="course" maxLength={80} value={draft.course} onChange={e => update('course', e.target.value)} placeholder="e.g. Computer Science" /></label><label>Year<select name="year" aria-label="Year" value={draft.year} onChange={e => update('year', e.target.value)}>{!years.includes(draft.year) && <option value={draft.year}>{draft.year}</option>}{years.map(year => <option key={year} value={year}>{year || 'Select year'}</option>)}</select></label></div>}<p className="identity-note">Campus and account permissions are reviewed by the UniCirq team.</p></fieldset>
          {error && <p role="alert" className="form-error">{error}</p>}<div className="button-row"><button className="button primary" type="submit" disabled={busy || !dirty}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save profile</button><button className="button secondary" type="button" disabled={busy} onClick={() => { setDraft(details()); setDirty(false); setEditing(false); setError(''); }}>Cancel</button></div></form>
        : <><dl className="identity-details"><div><dt>Display name</dt><dd>{user.name}</dd></div><div><dt>Bio</dt><dd>{user.bio || 'Tell your campus circle a little about yourself.'}</dd></div>{user.role === 'student' && <><div><dt>Course</dt><dd>{user.course || 'Not added yet'}</dd></div><div><dt>Year</dt><dd>{user.year || 'Not added yet'}</dd></div></>}</dl>{notice && <p className="identity-success" role="status"><CircleCheck size={17} />{notice}</p>}</>}
      </section>

      <TrustVerification />
    </div><aside className="identity-profile-aside">
      <section className="identity-panel identity-completion"><span className="identity-eyebrow">PROFILE CHECKLIST</span><div className="identity-completion-value"><strong>{completeness}<small>%</small></strong><CircleCheck size={28}/></div><progress value={completeness} max={100} aria-label="Profile completeness"/><p>{completeness === 100 ? 'Your details are ready for your campus community.' : 'Help your campus get to know you. Add a bio' + (user.role === 'student' ? ', course and year.' : '.')}</p><button type="button" className="text-button" onClick={() => { setEditing(true); document.getElementById('identity-personal-details')?.scrollIntoView({behavior:'smooth',block:'center'}); }}>Complete your profile <ArrowRight size={14}/></button><small>Profile details and verification are separate.</small></section>
      {user.role !== 'admin' && <section className="identity-panel"><header className="identity-section-header"><div><h2>Your campus activity</h2><p>{user.role === 'student' ? 'A snapshot of your listings and participant-confirmed orders.' : 'Your approved business presence on campus.'}</p></div><ShoppingBag size={21} /></header><div className="identity-activity-stats">{user.role === 'student' ? <><Link href="/student/marketplace"><strong>{activeListings}</strong><span>Active listings</span></Link><Link href="/student/activity"><strong>{completed}</strong><span>Recorded completions</span></Link><Link href="/student/saved"><strong>{data.saved.filter(s => s.user_id === user.id).length}</strong><span>Saved items</span></Link></> : <><Link href="/business/deals"><strong>{deals}</strong><span>Active deals</span></Link><div><strong>{ownedBusiness.length}</strong><span>Directory profiles</span></div></>}</div><p className="identity-note">Activity records do not imply protected payments or a reputation score.</p></section>}

      {user.role === 'business' && <section className="identity-panel"><header className="identity-section-header"><div><h2>Business directory</h2><p>Your public presence in the campus community.</p></div><Store size={21} /></header>{ownedBusiness.length ? ownedBusiness.map(business => <article key={business.id} className="identity-business"><h3>{business.name}</h3><p>{business.description}</p><small><MapPin size={14} />{business.location}</small><span className="pill blue">{business.category}</span></article>) : <p className="identity-copy">Your business directory profile will appear after approval.</p>}<Link className="text-link" href="/business/support">Request a directory correction <ArrowRight size={14} /></Link></section>}

      <nav className="identity-profile-shortcuts" aria-label="Account shortcuts"><Link href={`${base}/notifications`}><span>Notifications<small>Updates from your campus</small></span><ChevronRight size={18}/></Link><Link href={`${base}/support`}><span>Help & support<small>Speak to your campus team</small></span><ChevronRight size={18}/></Link><Link href={`${base}/settings`}><span>Appearance & security<small>Make UniCirq yours</small></span><ChevronRight size={18}/></Link></nav>
    </aside></div>
  </div>;
}
