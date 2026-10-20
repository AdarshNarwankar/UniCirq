'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, Clock3, Cpu, GraduationCap, Heart, HeartHandshake, LayoutDashboard, LifeBuoy, LogOut, MapPin, Megaphone, Menu, MessageCircle, Plus, ReceiptText, Settings, ShieldCheck, ShoppingBag, Store, Tag, UserRound, X, type LucideIcon } from 'lucide-react';
import { useApp } from './provider';
import { ThemeToggle } from './theme';
import { studentVerificationLabel } from '@/lib/campus-verification';

type NavGroup = { title: string; links: { path: string; label: string; icon: LucideIcon; badge?: number }[] };

export function MemberShell({ children }: { children: React.ReactNode }) {
  const { data, toast } = useApp(), pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const student = data.user.role === 'student', base = student ? '/student' : '/business';
  const campus = data.colleges.find(c => c.id === data.user.college_id), unread = data.notifications.filter(n => !n.read).length;
  const detailListing = student && pathname.startsWith('/student/listings/') ? data.listings.find(listing => listing.id === pathname.split('/')[3]) : undefined;
  const detailSection = detailListing ? detailListing.kind === 'sale' ? detailListing.owner_id === data.user.id ? 'sell' : 'buy' : detailListing.kind === 'rental' ? 'rentals' : detailListing.kind === 'hardware' ? 'hardware' : 'services' : undefined;
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && menu) { setMenu(false); menuButton.current?.focus(); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [menu]);
  const groups: NavGroup[] = student ? [
    { title: 'DISCOVER', links: [
      { path: 'buy', label: 'Buy', icon: ShoppingBag }, { path: 'rentals', label: 'Rentals', icon: Clock3 },
      { path: 'hardware', label: 'Project hardware', icon: Cpu }, { path: 'services', label: 'Services & tutors', icon: GraduationCap },
      { path: 'requests', label: 'Student requests', icon: Megaphone }, { path: 'deals', label: 'Campus deals', icon: Tag },
    ] },
    { title: 'YOUR LISTINGS', links: [
      { path: 'sell', label: 'Sell', icon: Store }, { path: 'create', label: 'Share a listing', icon: Plus },
    ] },
    { title: 'YOUR EVERYDAY', links: [
      { path: 'messages', label: 'Messages', icon: MessageCircle }, { path: 'activity', label: 'Orders & activity', icon: ReceiptText },
      { path: 'saved', label: 'Saved items', icon: Heart, badge: data.saved.length }, { path: 'managed-sale', label: 'Managed selling', icon: HeartHandshake },
    ] },
    { title: 'ACCOUNT', links: [
      { path: 'notifications', label: 'Notifications', icon: Bell, badge: unread }, { path: 'profile', label: 'Profile & verification', icon: UserRound }, { path: 'settings', label: 'Settings', icon: Settings }, { path: 'support', label: 'Help & support', icon: LifeBuoy },
    ] },
  ] : [
    { title: 'CAMPUS BUSINESS', links: [
      { path: 'deals', label: 'My campus deals', icon: Tag }, { path: 'profile', label: 'Business profile', icon: Store },
    ] },
    { title: 'YOUR WORKSPACE', links: [
      { path: 'notifications', label: 'Notifications', icon: Bell, badge: unread }, { path: 'settings', label: 'Settings', icon: Settings }, { path: 'support', label: 'Support tickets', icon: LifeBuoy },
    ] },
  ];
  return <div className={`control-center member-center ${student ? 'student-center' : 'business-center'}`}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    {menu && <button className="admin-scrim" aria-label="Dismiss navigation" onClick={() => setMenu(false)} />}
    <aside id="member-navigation" className={`admin-sidebar ${menu ? 'is-open' : ''}`} aria-label={`${student ? 'Student' : 'Business'} sidebar`}>
      <Link className="admin-brand" href={base} onClick={() => setMenu(false)}><span className="uc-mark" aria-hidden="true"><i /><i /></span><span>UniCirq<small>{student ? 'THE CAMPUS SPACE' : 'THE LOCAL WORKSPACE'}</small></span></Link>
      <button className="admin-close" aria-label="Close navigation" onClick={() => { setMenu(false); menuButton.current?.focus(); }}><X size={20} /></button>
      <nav aria-label={`${student ? 'Student' : 'Business'} navigation`}><Link href={base} onClick={() => setMenu(false)} aria-current={pathname === base ? 'page' : undefined} className={`admin-nav-link ${pathname === base ? 'selected' : ''}`}><LayoutDashboard size={18} />{data.user.role === 'student' ? 'Your campus' : 'Overview'}</Link>
        {groups.map(group => <div className="admin-nav-group" key={group.title}><span>{group.title}</span>{group.links.map(({ path, label, icon: Icon, badge }) => { const active = pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`) || (student && path === detailSection) || (student && path === 'buy' && pathname === '/student/marketplace'); return <Link key={path} href={`${base}/${path}`} aria-current={active ? 'page' : undefined} className={`admin-nav-link ${active ? 'selected' : ''}`} onClick={() => setMenu(false)}><Icon size={17} />{label}{Boolean(badge) && <b>{badge}</b>}</Link>; })}</div>)}
      </nav>
      <div className="admin-sidebar-help"><span className="help-orbit"><ShieldCheck size={27} /></span><strong>{student ? 'Your campus. Your circle.' : 'Grow with your campus.'}</strong><p>{student ? 'Good finds, helpful people, and a community close to home.' : 'Make everyday student life a little better with a great offer.'}</p><Link href={`${base}/${student ? 'create' : 'deals'}`} onClick={() => setMenu(false)}>{student ? 'Create a listing' : 'Manage your offers'}<ArrowRight size={13} /></Link></div>
      <button className="admin-signout" onClick={async () => { try { const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); if (!r.ok) throw new Error(); window.location.assign('/login'); } catch { toast('Unable to sign out. Please try again.'); } }}><LogOut size={15} />Sign out</button>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar">
      <button className="admin-menu" ref={menuButton} aria-label="Open navigation" aria-controls="member-navigation" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={21} /></button>
      <Link className="member-campus" href={`${base}/profile`}><MapPin size={16} /><span>{campus?.short_name ?? 'Verify campus'}</span></Link>
      <ThemeToggle />
      {student && <Link className="admin-bell member-message-link" href="/student/messages" aria-label="Messages"><MessageCircle size={20} /></Link>}
      <Link className="admin-bell" href={`${base}/notifications`} aria-label={`Notifications, ${unread} unread`}><Bell size={20} />{unread > 0 && <b>{unread}</b>}</Link>
      <Link className="admin-user" href={`${base}/profile`} aria-label="Your profile"><span className="avatar">{data.user.avatar}</span><span><strong>{data.user.name}</strong><small>{data.user.verified ? student ? studentVerificationLabel(data.user, campus, 'Verified student') : 'Verified business' : 'Verification pending'}</small></span></Link>
      {!student && <Link href="/business/deals" className="member-header-action" aria-label="Manage deals"><Plus size={16} /><span>Manage deals</span></Link>}
    </header>
    {data.demo && <div className="admin-demo"><span><i />LOCAL DEMO <span>· Sample campus data</span></span><Link href="/login?preview=1">Switch account <ArrowRight size={12} /></Link></div>}
    <main id="main-content" className="member-main">{children}</main><footer className="admin-footer"><span>Good things come around.</span><Link href={`${base}/support`}>Here to help ↗</Link></footer></div>
  </div>;
}

