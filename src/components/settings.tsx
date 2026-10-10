'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Bell, Check, CircleHelp, Eye, EyeOff, LoaderCircle, LockKeyhole, LogOut, MapPin, Monitor, RefreshCw, Settings as SettingsIcon, ShieldCheck, UserRound } from 'lucide-react';
import { useApp } from './provider';
import { ThemePicker } from './theme';
import { ActionButton } from './primitives';
import { accountRequest, AuthRequestError } from '@/lib/auth-ui';
import type { AccountSecurity } from '@/lib/account-security';

function securityError(error: unknown) {
  if (error instanceof AuthRequestError) {
    if (['INVALID_PASSWORD', 'INVALID_EMAIL_OR_PASSWORD'].includes(error.code)) return 'Your current password is incorrect.';
    if (['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG'].includes(error.code)) return 'Use between 10 and 128 characters for your new password.';
    if (error.status === 401 || ['SESSION_EXPIRED', 'SESSION_NOT_FRESH'].includes(error.code)) return 'Sign in again before changing security settings.';
    if (error.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  }
  return error instanceof Error && !(error instanceof AuthRequestError) ? error.message : 'Unable to update account security. Please try again.';
}
const dateLabel = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function SecuritySettings() {
  const [account, setAccount] = useState<AccountSecurity | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [requestKey, setRequestKey] = useState(0), [notice, setNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let active = true; setLoading(true); setLoadError('');
    fetch('/api/account', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Sign in again.' : 'Account details could not be loaded. Please retry.');
      if (active) setAccount(result);
    }).catch(err => { if (active) setLoadError(err instanceof Error ? err.message : 'Unable to load account details.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [requestKey]);
  return <section id="security" className="account-panel"><header className="account-section-header"><div><h2>Sign-in & security</h2><p>Manage your sign-in method and devices.</p></div><LockKeyhole size={21} /></header>
    {loading ? <p className="settings-loading" role="status"><LoaderCircle size={16} className="spin" />Loading account details…</p> : loadError ? <div><p className="form-error" role="alert">{loadError}</p><button className="button secondary" type="button" onClick={() => setRequestKey(key => key + 1)}><RefreshCw size={15} />Retry account details</button></div> : account ? <>
      <dl className="settings-account-details"><div><dt>Account email</dt><dd>{account.email ?? 'Sample account · no real email'}</dd></div><div><dt>Sign-in methods</dt><dd>{account.methods.length ? account.methods.join(' · ') : 'Email code'}</dd></div>{account.email && <div><dt>Email status</dt><dd>{account.emailVerified ? 'Email verified' : 'Email verification required'}</dd></div>}</dl>
      {account.demo ? <div className="settings-info"><CircleHelp size={18} /><p>You’re using a local demo account. Password changes and device management become available with a real account.</p></div> : <>
        {account.canChangePassword ? <details className="settings-password"><summary>Change password</summary><form className="stack-form" onSubmit={async event => {
          event.preventDefault(); if (busy) return; setError(''); setNotice('');
          if (newPassword !== confirm) { setError('The new passwords do not match.'); return; }
          if (newPassword === currentPassword) { setError('Choose a different password from your current one.'); return; }
          setBusy(true);
          try { await accountRequest('/api/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: true }); setCurrentPassword(''); setNewPassword(''); setConfirm(''); setNotice('Password updated. Other sessions have been signed out.'); setRequestKey(key => key + 1); }
          catch (err) { setError(securityError(err)); } finally { setBusy(false); }
        }}><fieldset disabled={busy} className="profile-form-fields"><label>Current password<input type={show ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" maxLength={128} required /></label><label>New password<input type={show ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required /></label><label>Confirm new password<input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required /></label><button className="text-button" type="button" onClick={() => setShow(value => !value)} aria-pressed={show}>{show ? <EyeOff size={15} /> : <Eye size={15} />}{show ? 'Hide passwords' : 'Show passwords'}</button><p className="settings-note">Use 10–128 characters. Changing your password signs out other devices.</p></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" type="submit" disabled={busy}>{busy && <LoaderCircle size={15} className="spin" />}Update password</button></form></details> : <p className="settings-note">{account.methods.includes('Google') ? 'Your Google password is managed in your Google account.' : 'You currently sign in with an email code. Use password recovery to set a password.'} <Link href="/forgot-password">Password recovery</Link></p>}
        <div className="settings-session-heading"><h3>Active sessions</h3><button type="button" className="text-button" onClick={() => setRequestKey(key => key + 1)} aria-label="Refresh sessions"><RefreshCw size={14} />Refresh</button></div>
        <div className="settings-sessions">{account.sessions.map(session => <article key={session.id}><Monitor size={20} /><div><strong>{session.device}</strong><small>Signed in {dateLabel(session.createdAt)} (IST)</small><small>Expires {dateLabel(session.expiresAt)} (IST)</small></div>{session.current && <span className="pill blue">This session</span>}</article>)}{!account.sessions.length && <p className="settings-note">No active device details were returned. Refresh or sign in again.</p>}</div>
        <ActionButton className="button secondary" disabled={account.sessions.filter(session => !session.current).length === 0} onAction={async () => { try { await accountRequest('/api/auth/revoke-other-sessions', {}); setNotice('Other sessions signed out. You’re still signed in here.'); setRequestKey(key => key + 1); } catch (err) { throw new Error(securityError(err)); } }}>Sign out other sessions</ActionButton>
      </>}
    </> : null}{notice && <p className="account-success" role="status"><Check size={16} />{notice}</p>}
  </section>;
}

export function Settings() {
  const { data, run } = useApp(), user = data.user, base = '/' + user.role;
  const campus = data.colleges.find(c => c.id === user.college_id);
  const unread = data.notifications.filter(n => n.user_id === user.id && !n.read).length;
  return <div className="settings-page"><div className="account-page-heading"><div><span className="eyebrow">MAKE UNICIRQ YOURS</span><h1>Account settings</h1><p>Your appearance, account, and security in one place.</p></div><Link className="button secondary" href={`${base}/profile`}><UserRound size={16} />Your profile</Link></div>
    <div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections"><a href="#appearance"><SettingsIcon size={17} />Appearance</a><a href="#account"><UserRound size={17} />Account & campus</a><a href="#notifications"><Bell size={17} />Notifications</a><a href="#security"><LockKeyhole size={17} />Sign-in & security</a><a href="#support"><CircleHelp size={17} />Help & support</a></nav><div className="settings-content">
      <section className="account-panel" id="appearance"><header className="account-section-header"><div><h2>Appearance</h2><p>Choose a look that feels right for you.</p></div><Monitor size={21} /></header><ThemePicker /></section>
      <section className="account-panel" id="account"><header className="account-section-header"><div><h2>Account & campus</h2><p>Your identity connects you to the right community.</p></div><MapPin size={21} /></header><dl className="settings-account-details"><div><dt>Display name</dt><dd>{user.name}</dd></div><div><dt>Account type</dt><dd>{user.role === 'admin' ? 'Administrator' : user.role === 'business' ? 'Campus business' : 'Student'}</dd></div><div><dt>University</dt><dd>{campus?.name ?? 'Not selected'}</dd></div><div><dt>Verification</dt><dd>{user.role === 'admin' ? 'Administrator access' : user.verified ? 'Approved' : 'Verification required'}</dd></div></dl><div className="button-row"><Link href={`${base}/profile`} className="button secondary">Edit profile <ArrowRight size={14} /></Link><Link href={`${base}/support`} className="text-link">Request a campus correction</Link></div><p className="settings-note">University changes and permissions require a team review.</p></section>
      <section className="account-panel" id="notifications"><header className="account-section-header"><div><h2>Notifications</h2><p>Updates about your orders, applications, and support cases.</p></div><Bell size={21} /></header><div className="settings-notification-status"><div><strong>{unread}</strong><span>unread {unread === 1 ? 'notification' : 'notifications'}</span></div><Link className="button secondary" href={`${base}/notifications`}>Open notifications <ArrowRight size={14} /></Link></div><ActionButton className="text-button" disabled={unread === 0} onAction={() => run({ type: 'read_notifications' }, 'Notifications marked as read')}>Mark all as read</ActionButton><p className="settings-note">These updates appear inside UniCirq. Email delivery preferences are not available yet.</p></section>
      <SecuritySettings />
      <section className="account-panel" id="support"><header className="account-section-header"><div><h2>Help & support</h2><p>Your campus team is here when you need a hand.</p></div><ShieldCheck size={21} /></header><div className="button-row"><Link href={`${base}/support`} className="button secondary">Open support center <ArrowRight size={14} /></Link><ActionButton className="button danger-outline" onAction={async () => { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); if (!response.ok) throw new Error('Unable to sign out. Please try again.'); window.location.assign('/login'); }}><LogOut size={15} />Sign out of UniCirq</ActionButton></div><p className="settings-note">For account closure or a privacy request, contact support from your signed-in account.</p></section>
    </div></div>
  </div>;
}
