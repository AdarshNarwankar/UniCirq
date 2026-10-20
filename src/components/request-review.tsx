'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, LoaderCircle, MapPin, ShieldCheck } from 'lucide-react';
import { moneyLabel, type Listing } from '@/lib/domain';
import { activityHref } from '@/lib/exchange';
import { rentalBoundaryLabel, rentalQuote, validRentalStart, type RentalSelection } from '@/lib/rental-pricing';
import { useApp } from './provider';
import { Modal } from './primitives';

export function RequestReview({ listing, dates, onClose }: { listing: Listing; dates: RentalSelection; onClose: () => void }) {
  const { data, run } = useApp();
  const router = useRouter();
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const rental = listing.kind === 'rental';
  const quote = rental ? rentalQuote(listing, dates) : null;
  const validDates = !rental || Boolean(quote) && validRentalStart(dates, listing.unit);
  const amount = rental ? quote?.amount : listing.price;
  const owner = data.profiles.find(p => p.id === listing.owner_id);
  return <Modal title="Review your request" onClose={() => { if (!busy) onClose(); }}><form className="exchange-confirm" onSubmit={async e => {
    e.preventDefault(); if (!checked || busy || !validDates) return;
    setBusy(true); setError('');
    try {
      if (rental && !validRentalStart(dates, listing.unit)) throw new Error('Your pickup time has passed. Go back and choose a new time.');
      const selection = !rental ? {} : listing.unit === 'hour' ? { starts_at: dates.starts_at, ends_at: dates.ends_at } : { starts_on: dates.starts_on, ends_on: dates.ends_on };
      const result = await run({ type: 'create_order', listing_id: listing.id, ...selection }, 'Request sent to the owner');
      if (result.id) router.push(activityHref(result.id));
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}><div className="exchange-review"><strong>{listing.title}</strong><span>From {owner?.name ?? 'a campus member'}</span><span className="review-amount">{amount === undefined ? 'Choose your rental period' : moneyLabel(amount)}<small>{rental && quote ? `${quote.billingUnits} ${listing.unit}${quote.billingUnits === 1 ? '' : 's'} × ${moneyLabel(listing.price)} / ${listing.unit}` : `1 ${listing.unit} at the listed price`}</small></span>{listing.kind === 'rental' && <span><CalendarDays size={15} />{rentalBoundaryLabel({ ...dates, terms_snapshot: { unit: listing.unit } }, 'start')} – {rentalBoundaryLabel({ ...dates, terms_snapshot: { unit: listing.unit } }, 'end')}</span>}<span><MapPin size={15} />{listing.location}</span></div>{rental && <p className="fineprint">{listing.unit === 'week' ? 'One week is 7 days. ' : listing.unit === 'month' ? 'One month is 30 days. ' : ''}Partial {listing.unit}s round up to a full {listing.unit}.</p>}{!validDates && <p className="form-error" role="alert">Go back and choose a valid pickup and return period.</p>}<p>The owner will review your request. Agree on the {listing.kind === 'service' ? 'scope and delivery' : 'pickup time and details'} in messages before confirming receipt.</p><label className="checkbox"><input type="checkbox" required checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />I checked the {listing.kind === 'rental' ? 'dates, rate, and item details' : 'price and listing details'}.</label><div className="exchange-payment-note"><ShieldCheck size={17} /><span>No payment is collected here. Payments are arranged directly with the owner.</span></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="exchange-confirm-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Go back</button><button className="button primary" disabled={busy || !checked || !validDates}>{busy && <LoaderCircle size={16} className="spin" />}Send request</button></div></form></Modal>;
}
