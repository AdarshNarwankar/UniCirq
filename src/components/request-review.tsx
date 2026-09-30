'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, LoaderCircle, MapPin, ShieldCheck } from 'lucide-react';
import { moneyLabel, type Listing } from '@/lib/domain';
import { activityHref, dateLabel } from '@/lib/exchange';
import { useApp } from './provider';
import { Modal } from './primitives';

export function RequestReview({ listing, dates, onClose }: { listing: Listing; dates: { starts_on: string; ends_on: string }; onClose: () => void }) {
  const { data, run } = useApp();
  const router = useRouter();
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const days = listing.kind === 'rental' ? (Date.parse(dates.ends_on) - Date.parse(dates.starts_on)) / 86400000 : 1;
  const amount = listing.price * days;
  const owner = data.profiles.find(p => p.id === listing.owner_id);
  return <Modal title="Review your request" onClose={() => { if (!busy) onClose(); }}><form className="exchange-confirm" onSubmit={async e => {
    e.preventDefault(); if (!checked || busy) return;
    setBusy(true); setError('');
    try {
      const result = await run({ type: 'create_order', listing_id: listing.id, ...(listing.kind === 'rental' ? dates : {}) }, 'Request sent to the owner');
      if (result.id) router.push(activityHref(result.id));
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}><div className="exchange-review"><strong>{listing.title}</strong><span>From {owner?.name ?? 'a campus member'}</span><span className="review-amount">{moneyLabel(amount)}<small>{listing.kind === 'rental' ? `${days} days × ${moneyLabel(listing.price)} / day` : `1 ${listing.unit} at the listed price`}</small></span>{listing.kind === 'rental' && <span><CalendarDays size={15} />{dateLabel(dates.starts_on)} – {dateLabel(dates.ends_on)}</span>}<span><MapPin size={15} />{listing.location}</span></div><p>The owner will review your request. Agree on the {listing.kind === 'service' ? 'scope and delivery' : 'pickup time and details'} in messages before confirming receipt.</p><label className="checkbox"><input type="checkbox" required checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />I checked the {listing.kind === 'rental' ? 'dates, rate, and item details' : 'price and listing details'}.</label><div className="exchange-payment-note"><ShieldCheck size={17} /><span>No payment is collected here. Payments are arranged directly with the owner.</span></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="exchange-confirm-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Go back</button><button className="button primary" disabled={busy || !checked}>{busy && <LoaderCircle size={16} className="spin" />}Send request</button></div></form></Modal>;
}
