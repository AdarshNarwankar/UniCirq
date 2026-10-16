'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Heart, MapPin, ShoppingBag, Clock3, Cpu, GraduationCap, Search, ShieldCheck, X } from 'lucide-react';
import type { Listing, Kind } from '@/lib/domain';
import { moneyLabel, categories } from '@/lib/domain';
import { useApp } from './provider';
import { Empty } from './primitives';

const kindLabels = { sale: 'Buy & sell', rental: 'Rentals', hardware: 'Project hardware', service: 'Services & tutors' };
const kindIcons = { sale: ShoppingBag, rental: Clock3, hardware: Cpu, service: GraduationCap };


export function ProductImage({ listing }: { listing: Listing }) {
  const [failedImage, setFailedImage] = useState('');
  const Icon = kindIcons[listing.kind];
  return listing.image && failedImage !== listing.image ? <img src={listing.image} alt={listing.title} loading="lazy" onError={() => setFailedImage(listing.image)} /> : <div className={`atelier-product-placeholder ${listing.kind}`}><Icon size={58} strokeWidth={1} /><span>{listing.category}</span></div>;
}

export function ListingCard({ listing: l }: { listing: Listing }) {
  const { data, run, toast } = useApp();
  const saved = data.saved.some(s => s.listing_id === l.id);
  const seller = data.profiles.find(p => p.id === l.owner_id);
  const [busy, setBusy] = useState(false);
  return <article className="atelier-listing"><div className="atelier-listing-media"><Link href={`/student/listings/${l.id}`} aria-label={`View ${l.title}`}><ProductImage listing={l} /></Link><span className="atelier-listing-kind">{l.kind === 'rental' ? 'For rent' : l.kind === 'service' ? 'Student skill' : l.condition}</span><button className={`atelier-save ${saved ? 'is-saved' : ''}`} aria-label={`${saved ? 'Unsave' : 'Save'} ${l.title}`} aria-pressed={saved} disabled={busy} onClick={async () => { setBusy(true); try { await run({ type: 'save_listing', listing_id: l.id }); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}><Heart size={18} strokeWidth={1.6} fill={saved ? 'currentColor' : 'none'} /></button></div><div className="atelier-listing-copy"><div className="atelier-listing-category">{l.category}</div><Link className="atelier-listing-title" href={`/student/listings/${l.id}`}>{l.title}</Link><div className="atelier-listing-price">{moneyLabel(l.price)}{l.unit !== 'item' && <span> / {l.unit}</span>}</div><div className="atelier-listing-person"><span className="atelier-person-avatar">{seller?.avatar ?? 'UC'}</span><span>{seller?.name.split(' ')[0] ?? 'Campus member'}</span>{seller?.verified && <ShieldCheck size={14} aria-label="Campus verified" />}<ArrowUpRight size={16} className="atelier-card-arrow" aria-hidden="true" /></div></div></article>;
}

export function Catalogue({ kind, savedOnly = false, query = '' }: { kind?: Kind; savedOnly?: boolean; query?: string }) {
  const { data } = useApp();
  const [search, setSearch] = useState(query), [category, setCategory] = useState('All categories'), [sort, setSort] = useState('recent');
  const listings = data.listings.filter(l => l.status === 'active' && (!kind || l.kind === kind) && (!savedOnly || data.saved.some(s => s.listing_id === l.id)) && (category === 'All categories' || l.category === category) && [l.title, l.description, l.category].join(' ').toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'low' ? a.price - b.price : sort === 'high' ? b.price - a.price : b.created_at.localeCompare(a.created_at));
  const title = savedOnly ? 'Your collection.' : kind === 'rental' ? 'Use it. Return it. Repeat.' : kind === 'hardware' ? 'For your next bright idea.' : kind === 'service' ? 'Find your kind of expert.' : 'The campus exchange.';
  const subtitle = savedOnly ? 'The things you liked, all in one place.' : kind === 'rental' ? 'Useful gear for the days you need it.' : kind === 'hardware' ? 'Components, tools and equipment from your campus.' : kind === 'service' ? 'Tutoring, creative work and practical skills from fellow students.' : 'Discover things worth passing on, right around you.';
  const campus = data.colleges.find(c => c.id === data.user.college_id);
  return <div className="atelier-catalogue"><header className="atelier-page-intro"><div><span className="atelier-kicker">{savedOnly ? 'Saved by you' : kind ? kindLabels[kind] : 'Discover'}</span><h1>{title}</h1><p>{subtitle}</p></div><Link className="atelier-outline-link" href="/student/create">Share a listing <ArrowUpRight size={17} /></Link></header>
    <div className="atelier-browse-tools atelier-glass"><label className="atelier-listing-search"><Search size={20} strokeWidth={1.6} /><input aria-label="Search listings" placeholder="Search your campus…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={17} /></button>}</label><label className="atelier-select"><span>Category</span><select aria-label="Filter by category" value={category} onChange={e => setCategory(e.target.value)}>{['All categories', ...categories].map(c => <option key={c}>{c}</option>)}</select></label><label className="atelier-select"><span>Sort by</span><select aria-label="Sort listings" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Newest first</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select></label></div>
    <div className="atelier-results"><p><strong>{listings.length}</strong> {listings.length === 1 ? 'listing' : 'listings'}{category !== 'All categories' && <> in <strong>{category}</strong></>}</p><span><MapPin size={14} />{campus?.short_name ?? 'Your campus'}</span></div>
    {listings.length ? <div className="atelier-listing-grid">{listings.map(l => <ListingCard key={l.id} listing={l} />)}</div> : <Empty title={savedOnly ? 'Keep something for later' : 'Nothing here just yet'} body={savedOnly ? 'Tap the heart on a listing to add it to your collection.' : 'Try a different search or ask your campus for what you need.'} action={<div className="atelier-empty-actions">{(search || category !== 'All categories') && <button className="button secondary" onClick={() => { setSearch(''); setCategory('All categories'); }}>Clear filters</button>}<Link className="button primary" href={savedOnly ? '/student/marketplace' : '/student/requests'}>{savedOnly ? 'Explore the marketplace' : 'Post a request'}<ArrowRight size={16} /></Link></div>} />}
    <div className="atelier-market-footnote"><ShieldCheck size={19} /><p>Keep it local. Meet in a public campus space and inspect items together.</p><Link href="/student/support">Safety & support <ArrowUpRight size={15} /></Link></div>
  </div>;
}
export { ListingDetail } from './listing-detail';
