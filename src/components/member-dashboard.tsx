'use client';

import Link from 'next/link';
import Form from 'next/form';
import { ArrowRight, ArrowUpRight, Bell, Check, Clock3, Cpu, GraduationCap, Heart, MapPin, Megaphone, MessageCircle, Plus, ReceiptText, ShieldCheck, ShoppingBag, Store, Tag, Search } from 'lucide-react';
import { useApp } from './provider';
import { ListingCard, ProductImage } from './catalogue';
import { Empty } from './primitives';
import { moneyLabel } from '@/lib/domain';
import { buyListings } from '@/lib/student-marketplace';

const quick = [['buy', 'Buy', 'Items from students', ShoppingBag], ['rentals', 'Just for a while', 'Rentals', Clock3], ['hardware', 'Build something', 'Project hardware', Cpu], ['services', 'Find your person', 'Skills & tutors', GraduationCap], ['requests', 'Ask the campus', 'Requests', Megaphone], ['deals', 'A little extra', 'Local offers', Tag]] as const;
const formatDate = (value: string) => new Date(value.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function Updates({ base }: { base: '/student' | '/business' }) {
  const { data } = useApp();
  return <section className="uc-work-section uc-updates"><header><div><span className="eyebrow">IN YOUR CIRCLE</span><h2>A little heads-up.</h2></div><Link href={`${base}/notifications`} aria-label="All notifications"><Bell size={20} /></Link></header>{data.notifications.length ? data.notifications.slice(0, 3).map(n => <Link className="uc-update-row" key={n.id} href={n.href.replace(/^\/(student|business|admin)/, base)}><span className={`update-dot ${n.read ? 'read' : ''}`} /><div><strong>{n.title}</strong><p>{n.body}</p><small>{formatDate(n.created_at)}</small></div><ArrowUpRight size={16} /></Link>) : <div className="uc-quiet"><Check size={25} /><p>All caught up. We’ll keep you in the loop here.</p></div>}</section>;
}

export function StudentDashboard() {
  const { data } = useApp();
  const ownListings = data.listings.filter(l => l.owner_id === data.user.id && l.kind === 'sale' && l.status === 'active');
  const activity = data.orders.filter(o => ['requested', 'accepted', 'handed_over', 'disputed'].includes(o.status));
  const listings = buyListings(data.listings, data.user).slice(0, 4);
  const featured = listings.find(listing => listing.image) ?? listings[0];
  const requests = data.requests.filter(r => r.status === 'open').slice(0, 3);
  const today = new Date().toISOString().slice(0, 10);
  const deals = data.deals.filter(d => d.status === 'active' && d.expires_on >= today).slice(0, 2);
  const campus = data.colleges.find(c => c.id === data.user.college_id);
  return <div className="uc-student-home">
    <div className="uc-work-intro"><span className="eyebrow">YOUR CAMPUS, IN GOOD COMPANY.</span><span>Hello, {data.user.name.split(' ')[0]} <span aria-hidden="true">↗</span></span></div>
    <section className="uc-campus-hero uc-campus-desk">
      <div className="uc-campus-hero-copy">
        <span className="uc-label">{campus?.short_name ?? 'YOUR CAMPUS'} / THE EVERYDAY EDIT</span>
        <h1>Your campus,<br /><em>in good company.</em></h1>
        <p>Good finds, useful skills, and people just around the corner.</p>
        <Form action="/student/buy" className="uc-campus-search" role="search"><Search size={20}/><input name="q" aria-label="Search items to buy" placeholder="Search items to buy…"/><button type="submit" aria-label="Search items to buy"><ArrowRight size={20}/></button></Form>
        <div className="uc-trading-actions"><Link href="/student/buy" className="button primary"><ShoppingBag size={17}/>Buy on campus<ArrowUpRight size={15}/></Link><Link href="/student/sell" className="button secondary"><Plus size={17}/>Sell an item<ArrowUpRight size={15}/></Link></div>
        <Link className="uc-campus-membership" href="/student/profile"><ShieldCheck size={16}/>{data.user.verified ? 'You’re in the circle. Campus verified.' : 'Make it official. Verify your campus.'}<ArrowUpRight size={14}/></Link>
      </div>
      <div className="uc-desk-feature">
        <span className="uc-desk-note">A new chapter<br /><em>looks good on you.</em><ArrowUpRight size={24}/></span>
        {featured ? <Link className="uc-feature-find" href={`/student/listings/${featured.id}`}><div className="uc-feature-photo"><ProductImage listing={featured}/><span>IN YOUR CIRCLE</span></div><div className="uc-feature-caption"><div><small>{featured.category}</small><strong>{featured.title}</strong></div><span>{moneyLabel(featured.price)}{featured.unit !== 'item' && <small> / {featured.unit}</small>}</span></div></Link> : <img className="uc-desk-empty" src="/images/campus-orbit.webp" alt="Useful campus finds waiting for a new chapter" width="1440" height="960"/>}
        <span className="uc-desk-footnote">GOOD FINDS. WALKING DISTANCE.</span>
      </div>
    </section>
    <div className="uc-stat-strip">{[
      [ownListings.length, 'Items for sale', '/student/sell', ShoppingBag], [data.saved.length, 'Saved finds', '/student/saved', Heart], [data.conversations.length, 'Conversations', '/student/messages', MessageCircle], [activity.length, 'Ongoing exchanges', '/student/activity', ReceiptText],
    ].map(([value, label, href, Icon]) => { const StatIcon = Icon as typeof Heart; return <Link href={String(href)} key={String(label)}><StatIcon size={18} strokeWidth={1.5} /><strong>{String(value)}</strong><span>{String(label)}</span><ArrowUpRight size={14} /></Link>; })}</div>
    <nav className="uc-category-rail" aria-label="Explore campus categories">{quick.map(([path, title, label, Icon], index) => <Link href={`/student/${path}`} key={path}><span className={`uc-category-symbol symbol-${index}`}><Icon size={26} strokeWidth={1.4} /></span><strong>{title}</strong><span>{label}<ArrowUpRight size={12} /></span></Link>)}</nav>
    <section className="uc-work-section"><header><div><span className="eyebrow">BUY FROM YOUR CAMPUS</span><h2>Fresh finds. New chapters.</h2></div><Link className="text-link" href="/student/buy">Browse items<ArrowUpRight size={17} /></Link></header>{listings.length ? <div className="listing-grid uc-home-listings">{listings.map(listing => <ListingCard key={listing.id} listing={listing} />)}</div> : <Empty title="Good finds are on the way." body="Items from other students will appear here. Have something to sell? Give it a new chapter." action={<Link className="button primary" href="/student/sell/new">Sell an item<Plus size={16} /></Link>} />}</section>
    <div className="uc-community-columns"><section className="uc-work-section uc-noticeboard"><header><div><span className="eyebrow">THE CAMPUS NOTICEBOARD</span><h2>Anyone got a…?</h2></div><Link href="/student/requests" className="uc-circle-button" aria-label="View campus requests"><ArrowUpRight size={20} /></Link></header>{requests.length ? requests.map((request, index) => <Link href="/student/requests" className="uc-request-slip" key={request.id}><span className="uc-request-index">0{index + 1}</span><div><small>{request.category}</small><h3>{request.title}</h3><p>{request.description}</p><strong>Budget {moneyLabel(request.budget)}</strong></div><ArrowUpRight size={19} /></Link>) : <div className="uc-quiet"><Megaphone size={28} /><p>Need something? Put the word out to your campus.</p><Link className="text-link" href="/student/requests">Post a request<ArrowRight size={15} /></Link></div>}</section>
    <section className="uc-work-section uc-next-up"><header><div><span className="eyebrow">KEEP GOOD THINGS MOVING</span><h2>Next on your list.</h2></div><Link href="/student/activity" aria-label="All exchange activity"><ArrowUpRight size={20} /></Link></header>{activity.length ? activity.slice(0, 4).map(order => <Link className="uc-exchange-row" href={`/student/activity?order=${order.id}`} key={order.id}><span className="uc-exchange-icon"><ReceiptText size={20} /></span><div><small>{order.status.replaceAll('_', ' ')}</small><strong>{order.terms_snapshot.title}</strong><span>{order.kind === 'rental' && order.ends_on ? `Return by ${formatDate(order.ends_on)}` : 'View the next step'}</span></div><ArrowUpRight size={17} /></Link>) : <div className="uc-quiet"><Check size={30} /><h3>A little breathing room.</h3><p>Your requests, meetups and returns will appear here.</p></div>}<Link className="uc-trust-reminder" href="/student/support"><ShieldCheck size={20} /><span>Meet in public. Inspect together.<br /><strong>Good exchanges start with care.</strong></span></Link></section></div>
    <div className="uc-community-columns"><Updates base="/student" /><section className="uc-work-section uc-perks"><header><div><span className="eyebrow">AROUND THE CORNER</span><h2>Local love.</h2></div><Link href="/student/deals" aria-label="View local offers"><ArrowUpRight size={20} /></Link></header>{deals.length ? deals.map(deal => <Link href="/student/deals" className="uc-perk-row" key={deal.id}><Tag size={23} /><div><small>{data.businesses.find(b => b.id === deal.business_id)?.name ?? 'Campus business'}</small><strong>{deal.title}</strong></div><ArrowUpRight size={19} /></Link>) : <div className="uc-quiet"><Store size={25} /><p>Offers from your campus businesses will find a home here.</p></div>}</section></div>
    <section className="uc-moving-banner"><span className="uc-moving-symbol" aria-hidden="true">↗</span><div><span className="eyebrow">MAKING ROOM FOR WHAT’S NEXT?</span><h2>Pass it on before you move on.</h2><p>Register your interest in the managed-selling pilot.</p></div><Link href="/student/managed-sale" className="button secondary">I’m interested<ArrowUpRight size={17} /></Link></section>
  </div>;
}

export function BusinessDashboard() {
  const { data } = useApp();
  const business = data.businesses.find(b => b.owner_id === data.user.id);
  const campus = data.colleges.find(c => c.id === data.user.college_id);
  const offers = data.deals.filter(d => d.owner_id === data.user.id);
  const today = new Date().toISOString().slice(0, 10);
  const live = offers.filter(d => d.status === 'active' && d.expires_on >= today);
  const pending = offers.filter(d => d.status === 'pending');
  const tickets = data.tickets.filter(t => t.owner_id === data.user.id && t.status === 'open');
  return <div className="uc-business-home">
    <div className="uc-work-intro"><span className="eyebrow">THE LOCAL SIDE OF CAMPUS LIFE</span><span>{campus?.short_name ?? 'Your campus'}</span></div>
    <section className="uc-business-hero"><div><span className="eyebrow">HELLO, {business?.name ?? data.user.name}</span><h1>Be their<br /><em>favourite local.</em></h1><p>Good offers make everyday campus life better.<br />Let’s put yours on the map.</p><Link href="/business/deals" className="button primary">Create a campus offer<Plus size={18} /></Link></div><Link href="/business/profile" className="uc-business-sign"><span>PART OF THE CAMPUS CIRCLE</span><Store size={55} strokeWidth={1} /><strong>{business?.name ?? data.user.name}</strong><small>{business?.category ?? 'Your local business'}</small><div><ShieldCheck size={16} />{data.user.verified ? 'VERIFIED BUSINESS' : 'VERIFICATION PENDING'}</div><ArrowUpRight className="uc-sign-arrow" size={23} /></Link></section>
    <div className="uc-stat-strip">{[[live.length,'Live offers','/business/deals'],[pending.length,'Awaiting review','/business/deals'],[offers.length,'Total offers','/business/deals'],[tickets.length,'Open support cases','/business/support']].map(([count,label,href]) => <Link key={label} href={String(href)}><strong>{count}</strong><span>{label}</span><ArrowUpRight size={16} /></Link>)}</div>
    <section className="uc-work-section"><header><div><span className="eyebrow">SOMETHING GOOD FOR YOUR CAMPUS</span><h2>Your offer book.</h2></div><Link href="/business/deals" className="text-link">Manage offers<ArrowUpRight size={17} /></Link></header><div className="member-offer-table"><table><thead><tr><th>Offer</th><th>Status</th><th>Offer code</th><th>Valid through</th><th><span className="sr-only">View offer</span></th></tr></thead><tbody>{offers.map(offer => { const expired=offer.status==='active'&&offer.expires_on<today; return <tr key={offer.id}><td><strong>{offer.title}</strong><small>{offer.description}</small></td><td><span className={`pill ${expired?'amber':offer.status==='active'?'green':offer.status==='pending'?'blue':'red'}`}>{expired?'Expired':offer.status==='active'?'Live':offer.status==='pending'?'In review':'Removed'}</span></td><td><code>{offer.code}</code></td><td>{formatDate(offer.expires_on)}</td><td><Link href="/business/deals" aria-label={`View ${offer.title}`}><ArrowUpRight size={18} /></Link></td></tr>; })}</tbody></table></div>{!offers.length && <Empty title="Your first hello to campus." body="Create a useful offer and send it for review." action={<Link href="/business/deals" className="button primary">Create an offer<Plus size={16} /></Link>} />}</section>
    <div className="uc-community-columns"><section className="uc-work-section uc-business-checklist"><header><div><span className="eyebrow">A GOOD PLACE TO START</span><h2>Make yourself known.</h2></div><Store size={24} /></header>{[{done:data.user.verified,text:'Get your business verified',detail:'Build your place in the campus community.',href:'/business/profile'},{done:Boolean(business?.description&&business?.location),text:'Tell your story',detail:'Add a description and a public location.',href:'/business/profile'},{done:live.length>0,text:'Share a useful offer',detail:'Clear benefits. Simple terms. Happy students.',href:'/business/deals'}].map((item,index) => <Link href={item.href} key={item.text} className="uc-checklist-row"><span>{item.done?<Check size={18}/>:String(index+1).padStart(2,'0')}</span><div><strong>{item.text}</strong><p>{item.detail}</p></div><ArrowUpRight size={17}/></Link>)}</section><Updates base="/business" /></div>
    <section className="uc-moving-banner"><MapPin size={40} strokeWidth={1}/><div><span className="eyebrow">YOUR NEIGHBOURHOOD</span><h2>{campus?.name ?? 'Your campus community'}</h2><p>{business?.location ?? 'Add your public location so students know where to find you.'}</p></div><Link href="/business/profile" className="button secondary">View your profile<ArrowUpRight size={17} /></Link></section>
  </div>;
}
