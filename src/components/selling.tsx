'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, MapPin, Package, Plus, Search, ShieldCheck, ShoppingBag } from 'lucide-react';
import type { Listing } from '@/lib/domain';
import { moneyLabel } from '@/lib/domain';
import { sellListings } from '@/lib/student-marketplace';
import { activeOrder, activityHref, dateLabel, statusLabel } from '@/lib/exchange';
import { useApp } from './provider';
import { ActionButton, Badge, Empty, Heading, Modal } from './primitives';
import { ProductImage } from './catalogue';

type SaleStatus = 'all' | Listing['status'];
const saleFilters: { value: SaleStatus; label: string }[] = [
  { value: 'all', label: 'All items' },
  { value: 'active', label: 'For sale' },
  { value: 'pending', label: 'In review' },
  { value: 'closed', label: 'Closed' },
  { value: 'removed', label: 'Removed' },
];
const listingStatus = { active: 'For sale', pending: 'In review', closed: 'Closed', removed: 'Removed' };
const listingTone = { active: 'green', pending: 'blue', closed: 'gray', removed: 'red' };

export function Selling() {
  const { data, run } = useApp();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SaleStatus>('all');
  const [closing, setClosing] = useState<Listing | null>(null);
  const listings = sellListings(data.listings, data.user)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const query = search.trim().toLocaleLowerCase();
  const filtered = listings.filter(listing =>
    (status === 'all' || listing.status === status)
    && [listing.title, listing.category, listing.description].join(' ').toLocaleLowerCase().includes(query)
  );
  const incoming = data.orders
    .filter(order => order.kind === 'sale' && order.seller_id === data.user.id && activeOrder(order))
    .sort((a, b) => Number(b.status === 'requested') - Number(a.status === 'requested') || b.created_at.localeCompare(a.created_at));
  const closingOrders = closing ? incoming.filter(order => order.listing_id === closing.id) : [];

  return (
    <div className="selling-workspace">
      <Heading
        eyebrow="YOUR SELLING SPACE"
        title="Sell to your campus"
        subtitle="Give your items a second life. Keep your listings and buyer requests together."
        action={<Link className="button primary" href="/student/sell/new"><Plus size={17} />Sell an item</Link>}
      />

      <div className="selling-summary" aria-label="Your sale listing summary">
        <div><span className="selling-summary-icon"><ShoppingBag size={21} /></span><div><strong>{listings.filter(listing => listing.status === 'active').length}</strong><span>Items for sale</span></div></div>
        <div><span className="selling-summary-icon"><Clock3 size={21} /></span><div><strong>{listings.filter(listing => listing.status === 'pending').length}</strong><span>Awaiting review</span></div></div>
        <div><span className="selling-summary-icon"><CheckCircle2 size={21} /></span><div><strong>{listings.filter(listing => listing.status === 'closed' || listing.status === 'removed').length}</strong><span>Closed &amp; removed</span></div></div>
      </div>

      {!data.user.verified && <div className="selling-verification"><ShieldCheck size={19} /><div><strong>Verify your campus to start selling.</strong><p>Your existing items stay here while verification is in progress.</p></div><Link className="text-link" href="/student/profile">View verification <ArrowRight size={14} /></Link></div>}

      <div className="selling-columns">
        <section className="selling-listings" aria-labelledby="selling-listings-title">
          <div className="selling-section-heading"><div><h2 id="selling-listings-title">Your sale listings</h2><p>Only the items you are selling.</p></div><span className="selling-count">{listings.length} {listings.length === 1 ? 'item' : 'items'}</span></div>

          <div className="selling-filters">
            <div className="selling-status-filters" role="group" aria-label="Filter your sale listings">
              {saleFilters.map(filter => <button type="button" key={filter.value} aria-pressed={status === filter.value} onClick={() => setStatus(filter.value)}>{filter.label}<span>{filter.value === 'all' ? listings.length : listings.filter(listing => listing.status === filter.value).length}</span></button>)}
            </div>
            <label className="selling-search"><Search size={17} /><input type="search" aria-label="Search your sale listings" placeholder="Search your items…" value={search} onChange={event => setSearch(event.target.value)} /></label>
          </div>

          <p className="selling-results" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'item' : 'items'}{status !== 'all' || query ? ' matching your filters' : ' in your selling space'}</p>

          {filtered.length ? <div className="selling-items">{filtered.map(listing => {
            const orders = incoming.filter(order => order.listing_id === listing.id);
            return <article className="selling-item" key={listing.id}>
              <Link className="selling-item-image" href={'/student/listings/' + listing.id} aria-label={'View ' + listing.title}><ProductImage listing={listing} /></Link>
              <div className="selling-item-info">
                <div className="selling-item-top"><span>{listing.category}</span><Badge tone={listingTone[listing.status]}>{listingStatus[listing.status]}</Badge></div>
                <Link className="selling-item-title" href={'/student/listings/' + listing.id}>{listing.title}</Link>
                <strong className="selling-item-price">{moneyLabel(listing.price)}</strong>
                <div className="selling-item-meta"><span><MapPin size={13} />{listing.location}</span><time dateTime={listing.created_at}>Listed {dateLabel(listing.created_at)}</time></div>
                {orders.length > 0 && <span className="selling-item-requests">{orders.length} ongoing buyer {orders.length === 1 ? 'request' : 'requests'}</span>}
              </div>
              <div className="selling-item-actions">
                <Link className="button secondary" href={'/student/listings/' + listing.id}>View item <ArrowRight size={14} /></Link>
                {listing.status === 'active' && data.user.verified && <button type="button" className="text-button" onClick={() => setClosing(listing)}>Close listing</button>}
              </div>
            </article>;
          })}</div> : <Empty
            title={listings.length ? 'No items match your filters.' : 'Something to pass on?'}
            body={listings.length ? 'Try another search or view all of your sale listings.' : 'Books, a cycle, or a spare calculator. Give it a place in your campus circle.'}
            action={listings.length ? <button type="button" className="button secondary" onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</button> : <Link className="button primary" href="/student/sell/new"><Plus size={16} />Sell your first item</Link>}
          />}
          <Link className="selling-other-listings" href="/student/activity?tab=listings"><Package size={16} /><span>Manage your rentals, hardware &amp; services</span><ArrowRight size={15} /></Link>
        </section>

        <aside className="selling-incoming" aria-labelledby="selling-incoming-title">
          <div className="selling-section-heading"><div><h2 id="selling-incoming-title">Buyer requests</h2><p>Your ongoing sale exchanges.</p></div><span className="selling-count">{incoming.length}</span></div>
          {incoming.length ? <div className="selling-request-list">{incoming.slice(0, 4).map(order => {
            const buyer = data.profiles.find(profile => profile.id === order.buyer_id);
            return <Link className="selling-request" key={order.id} href={activityHref(order.id)}>
              <div className="selling-request-person"><span className="avatar small">{buyer?.avatar ?? 'UC'}</span><div><strong>{buyer?.name ?? 'Campus member'}</strong><span>{statusLabel(order.status, order.kind)}</span></div><ArrowRight size={16} /></div>
              <h3>{order.terms_snapshot.title}</h3>
              <div className="selling-request-amount"><strong>{moneyLabel(order.amount)}</strong><time dateTime={order.created_at}>{dateLabel(order.created_at)}</time></div>
              <span className="selling-request-next">{order.status === 'requested' ? 'Review request' : order.status === 'disputed' ? 'View dispute details' : 'Continue exchange'}<ArrowRight size={13} /></span>
            </Link>;
          })}</div> : <div className="selling-no-requests"><ShoppingBag size={24} /><strong>No buyer requests yet.</strong><p>When a student requests one of your items, it will appear here.</p></div>}
          <Link className="text-link selling-all-activity" href="/student/activity">View all activity <ArrowRight size={14} /></Link>
          <div className="selling-tip"><ShieldCheck size={18} /><p>Use messages to agree on a public campus meeting spot. Confirm exchanges in your activity.</p></div>
        </aside>
      </div>

      {closing && <Modal title="Close your listing?" onClose={() => setClosing(null)}><div className="exchange-confirm"><p><strong>{closing.title}</strong> will leave the marketplace. Its conversations and activity records stay available.</p>{closingOrders.length > 0 && <p className="notice">This item has {closingOrders.length} ongoing buyer {closingOrders.length === 1 ? 'request' : 'requests'}. Closing prevents new requests and acceptance of pending requests. Message participants to agree on next steps.</p>}<ActionButton className="button danger-outline" onAction={async () => { await run({ type: 'close_listing', listing_id: closing.id }, 'Listing closed'); setClosing(null); }}>Close listing</ActionButton></div></Modal>}
    </div>
  );
}
