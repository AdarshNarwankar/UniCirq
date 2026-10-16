'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bell, BookOpen, ChevronRight, CircleHelp, ClipboardCheck, Compass, FileClock, Flag, Heart, Home, LayoutGrid, LogOut, MapPin, Menu, MessageCircle, Plus, ReceiptText, Settings, ShieldCheck, ShoppingBag, Store, Tag, UserRound, X, type LucideIcon } from 'lucide-react';
import { useApp } from './provider';
import { ThemeToggle } from './theme';

type Destination = { label: string; href: string; icon: LucideIcon };
type Section = Destination & { links: Destination[] };
const item = (label: string, href: string, icon: LucideIcon): Destination => ({ label, href, icon });
const studentSections: Section[] = [
  { ...item('Home', '/student', Home), links: [] },
  { ...item('Explore', '/student/marketplace', Compass), links: [item('Buy & sell', '/student/marketplace', ShoppingBag), item('Rentals', '/student/rentals', ReceiptText), item('Project hardware', '/student/hardware', LayoutGrid), item('Services & tutors', '/student/services', BookOpen), item('Requests', '/student/requests', Flag), item('Campus deals', '/student/deals', Tag)] },
  { ...item('Inbox', '/student/messages', MessageCircle), links: [] },
  { ...item('My activity', '/student/activity', ReceiptText), links: [item('Orders & activity', '/student/activity', ReceiptText), item('Saved items', '/student/saved', Heart), item('Create a listing', '/student/create', Plus), item('Managed selling', '/student/managed-sale', ShoppingBag)] },
  { ...item('Account', '/student/profile', UserRound), links: [item('Profile & verification', '/student/profile', UserRound), item('Settings', '/student/settings', Settings), item('Notifications', '/student/notifications', Bell), item('Help & support', '/student/support', CircleHelp)] },
];
const adminSections: Section[] = [
  { ...item('Overview', '/admin', Home), links: [] },
  { ...item('Review desk', '/admin/moderation-queue', ClipboardCheck), links: [item('Moderation queue', '/admin/moderation-queue', Flag), item('Student verification', '/admin/verifications', ShieldCheck), item('Listings & services', '/admin/moderation', ShoppingBag)] },
  { ...item('Trust & support', '/admin/trust-safety', ShieldCheck), links: [item('Trust & safety', '/admin/trust-safety', ShieldCheck), item('Disputes & support', '/admin/support', MessageCircle), item('Support center', '/admin/support-center', CircleHelp)] },
  { ...item('Insights', '/admin/analytics', LayoutGrid), links: [item('Activity analytics', '/admin/analytics', LayoutGrid), item('Audit log', '/admin/audit', FileClock)] },
  { ...item('Account', '/admin/profile', UserRound), links: [item('My account', '/admin/profile', UserRound), item('Settings', '/admin/settings', Settings), item('Notifications', '/admin/notifications', Bell)] },
];
const businessSections: Section[] = [
  { ...item('Overview', '/business', Home), links: [] },
  { ...item('Campus offers', '/business/deals', Tag), links: [] },
  { ...item('Business profile', '/business/profile', Store), links: [] },
  { ...item('Workspace', '/business/settings', Settings), links: [item('Settings', '/business/settings', Settings), item('Notifications', '/business/notifications', Bell), item('Support tickets', '/business/support', CircleHelp)] },
];

export function WorkspaceShell({ children, tools }: { children: React.ReactNode; tools?: React.ReactNode }) {
  const { data, toast } = useApp();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const role = data.user.role, base = `/${role}`;
  const sections = role === 'admin' ? adminSections : role === 'business' ? businessSections : studentSections;
  const selected = sections.find(section => section.href === pathname || section.links.some(link => link.href === pathname)) ?? (pathname.startsWith('/student/listings/') ? studentSections[1] : sections[0]);
  const page = selected.links.find(link => link.href === pathname)?.label ?? selected.label;
  const unread = data.notifications.filter(n => !n.read).length;
  const campus = data.colleges.find(c => c.id === data.user.college_id);
  const roleLabel = role === 'admin' ? 'Campus operations' : role === 'business' ? 'Business workspace' : 'Your campus, connected';
  useEffect(() => { if (menu) { dialog.current?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; dialog.current?.close(); }; } }, [menu]);
  async function signOut() {
    try { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); if (!response.ok) throw new Error(); window.location.assign('/login'); }
    catch { toast('Unable to sign out. Please try again.'); }
  }
  return <div className={`control-center workspace workspace-${role}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className="workspace-header-wrap"><header className="workspace-header">
      <Link className="workspace-brand" href={base} aria-label="UniCirq home"><span className="workspace-monogram" aria-hidden="true">u<span>c</span></span><span>UniCirq<small>{roleLabel}</small></span></Link>
      <nav className="workspace-primary" aria-label={`${role} main navigation`}>{sections.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={selected.href === href ? 'is-current' : ''} aria-current={selected.href === href ? (pathname === href ? 'page' : 'true') : undefined}><Icon size={17} /><span>{label}</span></Link>)}</nav>
      <div className="workspace-utilities"><ThemeToggle /><Link className="workspace-icon" href={`${base}/notifications`} aria-label={`Notifications, ${unread} unread`}><Bell size={19} />{unread > 0 && <span className="workspace-unread" />}</Link><Link className="workspace-profile" href={`${base}/profile`} aria-label={`Your profile: ${data.user.name}`}><span className="avatar">{data.user.avatar}</span></Link><button className="workspace-icon workspace-menu-button" onClick={() => setMenu(true)} aria-label="Open all navigation" aria-haspopup="dialog"><Menu size={21} /></button></div>
    </header></div>
    <div className="workspace-context"><div className="workspace-location"><span>{role === 'admin' ? 'OPERATIONS' : role === 'business' ? 'BUSINESS' : 'CAMPUS'}</span><ChevronRight size={13} /><strong>{page}</strong></div><Link className="workspace-campus" href={`${base}/profile`}><MapPin size={14} />{campus?.short_name ?? (role === 'admin' ? 'Campus network' : 'Choose your campus')}</Link></div>
    {selected.links.length > 0 && <nav className="workspace-subnav" aria-label={`${selected.label} sections`}>{selected.links.map(({ label, href, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}><Icon size={15} />{label}</Link>)}</nav>}
    {tools && <div className="workspace-tools"><span>Viewing campus records</span><div>{tools}</div></div>}
    {data.demo && <div className="workspace-demo"><span><i />Sample campus · Demo account</span><Link href="/login">Switch account <ArrowUpRight size={12} /></Link></div>}
    <main id="main-content" className="workspace-main">{children}</main>
    <footer className="workspace-footer"><span>UniCirq <span>— Your Campus, Connected.</span></span><div><Link href={`${base}/${role === 'admin' ? 'support-center' : 'support'}`}>Help & support</Link><button type="button" onClick={signOut}>Sign out <LogOut size={13} /></button></div></footer>
    <nav className="workspace-mobile-dock" aria-label="Quick navigation">{sections.slice(0,3).map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={selected.href === href ? 'page' : undefined}><Icon size={20} /><span>{label}</span></Link>)}<button onClick={() => setMenu(true)} aria-haspopup="dialog"><Menu size={20} /><span>All sections</span></button></nav>
    <dialog ref={dialog} className="workspace-directory" aria-labelledby="workspace-directory-title" onCancel={e => { e.preventDefault(); setMenu(false); }} onClick={e => { if (e.target === dialog.current) setMenu(false); }}><div className="workspace-directory-inner"><header><div><span className="eyebrow">YOUR UNICIRQ</span><h2 id="workspace-directory-title">Where would you like to go?</h2></div><button className="workspace-icon" aria-label="Close navigation" onClick={() => setMenu(false)}><X size={21} /></button></header><nav aria-label="All navigation">{sections.map(section => <div key={section.href}><Link className="workspace-directory-title" href={section.href} onClick={() => setMenu(false)}><section.icon size={19} />{section.label}<ArrowUpRight size={15} /></Link>{section.links.map(({ href, label }) => <Link key={href} href={href} onClick={() => setMenu(false)} aria-current={pathname === href ? 'page' : undefined}>{label}<ChevronRight size={13} /></Link>)}</div>)}</nav><footer><span>{data.user.name}<small>{roleLabel}</small></span><button className="text-button" onClick={signOut}><LogOut size={16} />Sign out</button></footer></div></dialog>
  </div>;
}
