'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { ArrowRight, Check, CircleAlert, Clock3, CreditCard, FileText, FlaskConical, LoaderCircle, Printer, ReceiptText, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { billingUpiId, billingUpiPayeeName, type BillingGroupSelection, type BillingQuote, type BillingRecord, type BillingSelection, type BillingSummary } from '@/lib/billing';
import { moneyLabel } from '@/lib/domain';
import { useApp } from './provider';
import { Modal } from './primitives';
import { BillSummary, type BillContext } from './bill-summary';
import { billSummaryView } from '@/lib/bill-summary';
import { rentalBoundaryLabel } from '@/lib/rental-pricing';

type Checkout = { key: string; amount: number; currency: 'INR'; order_id: string; name: string; description: string; billing_id: string };
type PaymentResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayOptions = Checkout & { handler: (result: PaymentResult) => void; modal: { ondismiss: () => void }; theme: { color: string } };
type RazorpayInstance = { open: () => void; on: (event: 'payment.failed', callback: () => void) => void };
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

let checkoutScript: Promise<void> | undefined;
function loadCheckout() {
  if ((window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay) return Promise.resolve();
  return checkoutScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    const failed = () => { clearTimeout(timeout); script.remove(); checkoutScript = undefined; reject(new Error('Payment checkout could not open. Please try again.')); };
    const timeout = setTimeout(failed, 15000);
    script.onerror = failed;
    script.onload = () => {
      clearTimeout(timeout);
      if (!(window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay) { failed(); return; }
      resolve();
    };
    document.head.appendChild(script);
  });
}

async function billingRequest<T>(path: string, value?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal: signal ?? AbortSignal.timeout(30000),
    ...(value ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) } : {}) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Sign in again.' : typeof result?.error === 'string' ? result.error : 'Billing is temporarily unavailable. Please try again.');
  if (!result || typeof result !== 'object') throw new Error('Billing details could not be loaded. Please try again.');
  return result as T;
}

const dateLabel = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const amount = (value: number | null) => value === null ? 'Pending tax setup' : moneyLabel(value);
const purposeLabel = (purpose: BillingRecord['purpose']) => purpose === 'order' ? 'Campus exchange' : purpose === 'boost' ? 'Listing boost' : 'Business plan';
const recordLabel = (record: BillingRecord) => billSummaryView(record.quote, record).status;

function PricingGuide({ pilot }: { pilot: boolean }) {
  return <section className="billing-panel billing-pricing" aria-labelledby="billing-pricing-title"><header><div><span className="eyebrow">CLEAR FROM THE START</span><h2 id="billing-pricing-title">What UniCirq charges</h2></div><ShieldCheck size={21} /></header>
    <dl><div><dt>Registration, verification, chat & requests</dt><dd>Free</dd></div><div><dt>Standard listings & direct sales</dt><dd>Free · 0%</dd></div><div><dt>Optional sale checkout <small>Buyer pays</small></dt><dd>5% · min. ₹19</dd></div><div><dt>Rental checkout <small>Renter pays</small></dt><dd>8% · min. ₹19</dd></div><div><dt>Service checkout <small>Deducted from provider share</small></dt><dd>8% · min. ₹19</dd></div><div><dt>Listing boost</dt><dd>₹29 / 7 days</dd></div><div><dt>Business Featured / Growth</dt><dd>{pilot ? 'Free during pilot' : '₹499 / ₹999 monthly'}</dd></div></dl>
    <p>Fees apply once per order. Processing is included in the platform charge. Refundable deposits are excluded and are not collected here. Any configured tax appears before confirmation.</p>
    <p>A platform charge does not provide insurance. Storage and merchandise billing are not available yet.</p>
  </section>;
}

function AdminBillingSettings({ summary, onSaved }: { summary: BillingSummary; onSaved: () => Promise<void> }) {
  const [tax, setTax] = useState(summary.settings.tax_bps === null ? '' : String(summary.settings.tax_bps / 100));
  const [pilot, setPilot] = useState(summary.settings.business_pilot), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setError(''); setNotice('');
    const rate = tax.trim() === '' ? null : Number(tax);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > .00001)) { setError('Enter a tax rate from 0 to 100 with up to two decimal places, or leave it unconfigured.'); return; }
    setBusy(true);
    try {
      await billingRequest('/api/billing', { action: 'settings', settings: { tax_bps: rate === null ? null : Math.round(rate * 100), business_pilot: pilot, reason } });
      await onSaved(); setReason(''); setNotice('Billing settings saved. Existing statements keep their original pricing.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Settings could not be saved.'); } finally { setBusy(false); }
  }
  return <section className="billing-panel"><header><div><span className="eyebrow">PILOT CONTROLS</span><h2>Billing settings</h2></div></header><form onSubmit={submit} className="billing-settings stack-form"><fieldset disabled={busy}><label>Tax on the platform charge (%)<input type="number" min="0" max="100" step="0.01" value={tax} onChange={e => setTax(e.target.value)} placeholder="Not configured" /><small>Set the applicable rate after confirming your tax setup. Blank keeps paid checkout unavailable. Zero is an explicit zero rate.</small></label><label className="checkbox"><input type="checkbox" checked={pilot} onChange={e => setPilot(e.target.checked)} /><span>Keep Featured and Growth business plans free during the pilot</span></label><label>Reason for this change<textarea required minLength={5} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Record why you are changing these settings" /></label></fieldset>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="billing-success" role="status"><Check size={16} />{notice}</p>}<button type="submit" className="button secondary" disabled={busy || reason.trim().length < 5}>{busy && <LoaderCircle size={16} className="spin" />}Save billing settings</button></form><p className="billing-fine">This does not enable live charges. Razorpay remains in test mode.</p></section>;
}

export function Billing({ initialOrderId = '' }: { initialOrderId?: string }) {
  const { data } = useApp(), admin = data.user.role === 'admin', business = data.user.role === 'business';
  const [summary, setSummary] = useState<BillingSummary | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [requestKey, setRequestKey] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [purpose, setPurpose] = useState<'order' | 'boost' | 'business_plan'>(business ? 'business_plan' : 'order');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>(initialOrderId ? [initialOrderId] : []), [listingId, setListingId] = useState(''), [mode, setMode] = useState<'direct' | 'checkout'>('direct'), [plan, setPlan] = useState<'featured' | 'growth'>('featured');
  const [quoted, setQuoted] = useState<{ quote: BillingQuote; key: string } | null>(null), [quoteLoading, setQuoteLoading] = useState(false), [quoteError, setQuoteError] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<BillingRecord | null>(null), [search, setSearch] = useState(''), [moreBusy, setMoreBusy] = useState(false);
  const [upiQr, setUpiQr] = useState('');
  const eligibleOrders = data.orders.filter(order => order.buyer_id === data.user.id && order.status === 'accepted');
  const ownListings = data.listings.filter(listing => listing.owner_id === data.user.id && listing.status === 'active');
  const chosenOrderIds = selectedOrderIds.filter(id => eligibleOrders.some(order => order.id === id));
  const chosenListing = ownListings.find(listing => listing.id === listingId)?.id ?? ownListings[0]?.id;
  const selection = useMemo<BillingSelection | BillingGroupSelection | null>(() => purpose === 'business_plan' ? { purpose, payment_mode: 'checkout', plan } : purpose === 'boost' ? chosenListing ? { purpose, reference_id: chosenListing, payment_mode: 'checkout' } : null : chosenOrderIds.length ? { purpose: 'order_group', order_ids: chosenOrderIds, payment_mode: mode } : null, [purpose, plan, chosenListing, chosenOrderIds.join(','), mode]);
  const quoteKey = JSON.stringify({ selection, tax_bps: summary?.settings.tax_bps, business_pilot: summary?.settings.business_pilot });
  const quote = quoted?.key === quoteKey ? quoted.quote : null;

  async function refresh() { setSummary(await billingRequest<BillingSummary>('/api/billing')); }
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setLoadError('');
    billingRequest<BillingSummary>('/api/billing', undefined, controller.signal).then(value => { if (active) setSummary(value); }).catch(err => { if (active) setLoadError(err instanceof Error ? err.message : 'Billing could not load.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [requestKey]);
  useEffect(() => {
    setQuoted(null); setQuoteError('');
    if (admin || !selection || !summary) { setQuoteLoading(false); return; }
    const controller = new AbortController(); let active = true; setQuoteLoading(true);
    billingRequest<{ quote: BillingQuote }>('/api/billing', selection.purpose === 'order_group' ? { action: 'group_quote', selection } : { action: 'quote', selection }, controller.signal).then(value => { if (active) setQuoted({ quote: value.quote, key: quoteKey }); }).catch(err => { if (active) setQuoteError(err instanceof Error ? err.message : 'A quote could not be prepared.'); }).finally(() => { if (active) setQuoteLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [selection, admin, quoteKey, Boolean(summary)]);

  async function startPayment(input: BillingSelection | BillingGroupSelection | { billing_id: string }) {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const created = await billingRequest<{ record: BillingRecord; checkout?: Checkout }>('/api/billing', 'billing_id' in input ? { action: 'resume', billing_id: input.billing_id } : input.purpose === 'order_group' ? { action: 'group_create', selection: input } : { action: 'create', selection: input });
      if (!created.checkout) {
        await refresh(); setSelectedRecord(created.record);
        setNotice(created.record.status === 'refunded' ? 'This test payment has been refunded. Review its statement for details.' : created.record.status === 'paid' ? 'This test payment is already confirmed.' : created.record.quote.pilot_waived ? 'Your free pilot plan has been recorded. No payment was taken.' : 'Direct arrangement recorded. UniCirq has not collected or verified any payment.');
        return;
      }
      await loadCheckout();
      const Razorpay = (window as unknown as { Razorpay: RazorpayConstructor }).Razorpay;
      await new Promise<void>((resolve, reject) => {
        let settled = false, verifying = false;
        const finish = (failure?: Error) => { if (settled) return; settled = true; if (failure) reject(failure); else resolve(); };
        const checkout = new Razorpay({ ...created.checkout!, theme: { color: '#3157c8' },
          modal: { ondismiss: () => { if (verifying) return; setNotice('Checkout closed. No payment has been confirmed. You can check its status in billing history.'); finish(); } },
          handler: async result => {
            if (settled || verifying) return; verifying = true;
            try {
              await billingRequest('/api/billing/verify', { billing_id: created.record.id, ...result });
              setNotice('Your test payment was verified. No real money was charged.'); finish();
            } catch (err) { finish(new Error(err instanceof Error ? err.message : 'Payment confirmation is pending. Check billing history before trying again.')); }
          },
        });
        checkout.on('payment.failed', () => setNotice('That test attempt did not complete. You can retry in checkout or close it to return to billing history.'));
        checkout.open();
      });
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Payment could not be started.'); try { await refresh(); } catch { /* Preserve the actionable payment error. */ } }
    finally { setBusy(false); }
  }

  async function loadMore() {
    if (!summary?.next_cursor || moreBusy) return; setMoreBusy(true); setError('');
    try {
      const next = await billingRequest<BillingSummary>('/api/billing?cursor=' + encodeURIComponent(summary.next_cursor));
      setSummary(current => current ? { ...next, records: [...current.records, ...next.records.filter(record => !current.records.some(existing => existing.id === record.id))] } : next);
    } catch (err) { setError(err instanceof Error ? err.message : 'More records could not load.'); } finally { setMoreBusy(false); }
  }

  const relatedTitle = (record: BillingRecord) => record.purpose === 'order'
    ? data.orders.find(order => order.id === record.reference_id)?.terms_snapshot.title
    : record.purpose === 'boost' ? data.listings.find(listing => listing.id === record.reference_id)?.title : undefined;
  function contextFor(value: BillingSelection | BillingGroupSelection | BillingRecord, quote: BillingQuote): BillContext {
    const orderId = value.purpose === 'order_group' ? value.order_ids[0] : value.purpose === 'order' ? value.reference_id : undefined;
    const order = orderId ? data.orders.find(item => item.id === orderId) : undefined;
    const listing = value.purpose === 'boost' ? data.listings.find(item => item.id === value.reference_id) : undefined;
    const ownerId = 'owner_id' in value ? value.owner_id : data.user.id;
    const customerId = order?.buyer_id ?? ownerId;
    const customer = data.user.id === customerId ? data.user : data.profiles.find(profile => profile.id === customerId);
    const providerId = order?.seller_id ?? ('beneficiary_id' in value ? value.beneficiary_id : undefined);
    const provider = data.user.id === providerId ? data.user : data.profiles.find(profile => profile.id === providerId);
    const campusId = 'college_id' in value ? value.college_id : data.user.college_id;
    return {
      title: order?.terms_snapshot.title ?? listing?.title ?? quote.description,
      customer: customer?.name ?? (customerId ? `Account ${customerId.slice(0, 8).toUpperCase()}` : undefined),
      provider: provider?.name ?? (providerId ? `Account ${providerId.slice(0, 8).toUpperCase()}` : undefined),
      campus: data.colleges.find(campus => campus.id === campusId)?.short_name,
      quantity: order?.terms_snapshot.billing_units ? `${order.terms_snapshot.billing_units} ${order.terms_snapshot.unit}${order.terms_snapshot.billing_units === 1 ? '' : 's'} × ${moneyLabel(order.terms_snapshot.price)}` : undefined,
      period: order?.kind === 'rental' && (order.starts_on || order.starts_at) && (order.ends_on || order.ends_at) ? `${rentalBoundaryLabel(order, 'start')} – ${rentalBoundaryLabel(order, 'end')}` : undefined,
    };
  }
  const records = summary?.records.filter(record => `${record.id} ${record.reference_id ?? ''} ${relatedTitle(record) ?? ''} ${record.quote.description} ${purposeLabel(record.purpose)} ${record.status}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const chargeable = quote && quote.payment_mode === 'checkout' && quote.buyer_total !== null && quote.buyer_total > 0;
  const unavailable = Boolean(chargeable && !summary?.capabilities.configured);
  const upiUri = quote?.buyer_total && quote.buyer_total > 0
    ? `upi://pay?pa=${encodeURIComponent(billingUpiId)}&pn=${encodeURIComponent(billingUpiPayeeName)}&am=${(quote.buyer_total / 100).toFixed(2)}&cu=INR`
    : '';
  useEffect(() => {
    let active = true;
    if (!upiUri) {
      setUpiQr('');
      return;
    }
    QRCode.toDataURL(upiUri, { errorCorrectionLevel: 'M', margin: 2, width: 220 })
      .then(value => { if (active) setUpiQr(value); })
      .catch(() => { if (active) setUpiQr(''); });
    return () => { active = false; };
  }, [upiUri]);

  return <div className="billing-page"><header className="billing-heading"><div><span className="eyebrow">UNICIRQ · SIMPLE, TRANSPARENT CHARGES</span><h1>{admin ? 'Billing overview' : business ? 'Plans & billing' : 'Billing & receipts'}</h1><p>{admin ? 'Across all campuses. Review test transactions, platform charges and pilot settings.' : 'See every charge before you confirm. Keep your statements in one place.'}</p></div><button type="button" className="button secondary" disabled={loading || busy} onClick={() => setRequestKey(value => value + 1)}><RefreshCw size={15} />Refresh</button></header>
    <div className="billing-test-note"><FlaskConical size={21} /><div><strong>Razorpay test mode</strong><p>No real money is charged or paid out. Test receipts do not confirm payment for a campus exchange.</p></div><span>TEST ONLY</span></div>
    {loading ? <div className="billing-loading" role="status"><LoaderCircle size={22} className="spin" />Loading billing details…</div> : loadError ? <div className="billing-panel billing-empty"><CircleAlert size={26} /><h2>Billing could not load</h2><p role="alert">{loadError}</p><button type="button" className="button secondary" onClick={() => setRequestKey(value => value + 1)}>Try again</button></div> : summary && <>
      <section className="billing-metrics" aria-label="Test billing totals">{[
        { title: 'Captured test value', value: summary.totals.gross, detail: 'Before refunds · includes principal', icon: CreditCard },
        { title: 'Platform charges', value: summary.totals.platform_fees, detail: 'Before refunds, processing and costs', icon: ReceiptText },
        { title: 'Seller / provider share', value: summary.totals.seller_payable, detail: 'Before refunds · no payout made', icon: ShieldCheck },
        { title: 'Refunded test value', value: summary.totals.refunded, detail: 'Provider-confirmed refunds', icon: Clock3 },
      ].map(({ title, value, detail, icon: Icon }) => <div key={title}><Icon size={20} /><span>{title}</span><strong>{moneyLabel(value)}</strong><small>{detail}</small></div>)}</section>
      <div className="billing-layout"><div className="billing-primary">
        {!admin && <section className="billing-panel billing-create"><header><div><span className="eyebrow">KNOW THE TOTAL</span><h2>{business ? 'Choose your business plan' : 'Prepare a billing statement'}</h2></div>{business ? <Sparkles size={21} /> : <FileText size={21} />}</header>
          {!business && <div className="billing-purpose" role="group" aria-label="Billing type"><button type="button" aria-pressed={purpose === 'order'} onClick={() => setPurpose('order')}>Campus exchange</button><button type="button" aria-pressed={purpose === 'boost'} onClick={() => setPurpose('boost')}>Listing boost</button></div>}
          {business ? <><div className="billing-plan-grid" role="group" aria-label="Business plan">{[{ id: 'featured', name: 'Featured', price: 49900, detail: 'Featured business placement and campaign reporting.' }, { id: 'growth', name: 'Growth', price: 99900, detail: 'Additional promotional placement and more detailed reporting.' }].map(item => <button key={item.id} type="button" aria-pressed={plan === item.id} onClick={() => setPlan(item.id as 'featured' | 'growth')}><span>{item.name}{plan === item.id && <Check size={16} />}</span><strong>{summary.settings.business_pilot ? 'Free' : moneyLabel(item.price)}<small>/ month</small></strong><p>{item.detail}</p>{summary.settings.business_pilot && <small>Normally {moneyLabel(item.price)} · waived for the pilot</small>}</button>)}</div><p className="billing-fine">One calendar month at a time. Renew manually; no recurring debit. Test access does not activate public promotional placement.</p></> : purpose === 'order' ? eligibleOrders.length ? <div className="stack-form billing-selection"><fieldset className="billing-order-list" disabled={busy}><legend>Orders ready for checkout</legend>{eligibleOrders.map(order => <label key={order.id} className="checkbox"><input type="checkbox" checked={chosenOrderIds.includes(order.id)} onChange={event => setSelectedOrderIds(current => event.target.checked ? [...current, order.id] : current.filter(id => id !== order.id))} /><span>{order.terms_snapshot.title} · {moneyLabel(order.amount)}</span></label>)}</fieldset><p className="billing-fine">{chosenOrderIds.length} order{chosenOrderIds.length === 1 ? '' : 's'} selected. Orders must share one seller and billing category.</p><label>Payment arrangement<select value={mode} onChange={event => setMode(event.target.value as 'direct' | 'checkout')} disabled={busy}><option value="direct">Arrange directly · no UniCirq fee</option><option value="checkout">Try UniCirq checkout · test payment</option></select></label><p className="billing-fine">Direct arrangements are recorded for reference. Their payments are not collected or verified by UniCirq.</p></div> : <div className="billing-empty"><ReceiptText size={26} /><h3>No orders ready for checkout</h3><p>Once a seller accepts your request, its billing options appear here.</p><Link className="text-link" href="/student/activity">Open orders & activity <ArrowRight size={14} /></Link></div> : ownListings.length ? <div className="stack-form billing-selection"><label>Your active listing<select value={chosenListing} onChange={event => setListingId(event.target.value)} disabled={busy}>{ownListings.map(listing => <option key={listing.id} value={listing.id}>{listing.title}</option>)}</select></label><p className="billing-fine">₹29 for seven days. This test creates a sandbox boost entitlement; it does not change live marketplace ranking.</p></div> : <div className="billing-empty"><Sparkles size={25} /><h3>Create a listing first</h3><p>Boosts are available for your active listings.</p><Link className="text-link" href="/student/create">Share a listing <ArrowRight size={14} /></Link></div>}
          {quoteLoading && <p className="billing-inline-loading" role="status"><LoaderCircle size={16} className="spin" />Preparing your quote…</p>}
          {quoteError && <p className="form-error" role="alert">{quoteError}</p>}
          {quote && selection && <div className="billing-quote"><BillSummary quote={quote} context={contextFor(selection, quote)} />{quote.tax_amount === null && <p className="billing-fine"><CircleAlert size={15} />Tax settings must be confirmed before paid checkout is available.</p>}{chargeable && upiQr && <section className="billing-upi" aria-labelledby="billing-upi-title"><div><span className="eyebrow">UPI PAYMENT</span><h3 id="billing-upi-title">Pay {moneyLabel(quote.buyer_total ?? 0)} by scanning</h3><p>Scan this QR with your UPI app or pay to <strong>{billingUpiId}</strong>. Verify the amount before confirming.</p><p className="billing-fine">UPI payments are sent directly to the displayed account. The current system does not automatically verify UPI payments, so keep your transaction reference.</p></div><img src={upiQr} alt={`UPI QR code to pay ${moneyLabel(quote.buyer_total ?? 0)} to ${billingUpiId}`} width="220" height="220" /></section>}{unavailable && <p className="billing-fine"><CircleAlert size={15} />{summary.capabilities.reason || 'Razorpay test checkout is being connected.'}</p>}<button type="button" className="button primary" disabled={busy || quote.buyer_total === null || unavailable} onClick={() => startPayment(selection)}>{busy ? <LoaderCircle size={16} className="spin" /> : chargeable ? <CreditCard size={16} /> : <Check size={16} />}{busy ? 'Please wait…' : quote.payment_mode === 'direct' ? 'Record direct arrangement' : quote.pilot_waived ? 'Activate free pilot plan' : quote.buyer_total === 0 ? 'Record free exchange' : 'Continue to test checkout'}</button></div>}
        </section>}
        {admin && <AdminBillingSettings key={`${summary.settings.tax_bps}-${summary.settings.business_pilot}`} summary={summary} onSaved={async () => { await refresh(); setError(''); setNotice('Billing settings saved. Existing statements keep their original pricing.'); }} />}
        <section className="billing-panel billing-history" aria-labelledby="billing-history-title">
          <header><div><span className="eyebrow">YOUR PAPER TRAIL</span><h2 id="billing-history-title">{admin ? 'Test billing records' : 'Billing history'}</h2></div><ReceiptText size={21} /></header>
          <label className="billing-search"><span className="sr-only">Search billing history</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search a statement or reference…" /></label>
          {records.length ? <div className="billing-records">{records.map(record => <button className="billing-record" type="button" key={record.id} onClick={() => setSelectedRecord(record)}>
            <span className="billing-record-icon"><ReceiptText size={19} /></span>
            <span className="billing-record-copy"><strong>{relatedTitle(record) ?? record.quote.description}</strong><small>{purposeLabel(record.purpose)} · {dateLabel(record.created_at)} IST · {record.id.slice(0, 8).toUpperCase()}</small><span className={`billing-state is-${record.status}`}>{recordLabel(record)}</span></span>
            <span className="billing-record-amount">{amount(record.quote.buyer_total)}<small>View statement <ArrowRight size={12} /></small></span>
          </button>)}</div> : <div className="billing-empty"><FileText size={27} /><h3>{search ? 'No matching statements' : 'A clear record, from your first exchange'}</h3><p>{search ? 'Try a title or statement reference.' : 'Your direct records, test payments and plan statements will appear here.'}</p></div>}
          {summary.next_cursor && <button type="button" className="button secondary billing-more" disabled={moreBusy} onClick={loadMore}>{moreBusy && <LoaderCircle size={15} className="spin" />}Load older records</button>}
          <p className="billing-fine">Amounts shown in INR. Direct records are not payment confirmations. Test receipts are not GST tax invoices.</p>
        </section>
      </div><aside className="billing-aside"><PricingGuide pilot={summary.settings.business_pilot} />{summary.entitlements.length > 0 && <section className="billing-panel"><header><div><h2>Test access</h2><p>Sandbox entitlements only</p></div><Sparkles size={20} /></header><ul className="billing-entitlements">{summary.entitlements.map(entitlement => <li key={entitlement.id}><strong>{entitlement.feature === 'listing_boost' ? 'Listing boost' : entitlement.feature === 'featured' ? 'Featured plan' : 'Growth plan'}</strong><small>Until {dateLabel(entitlement.expires_at)} IST</small></li>)}</ul><p className="billing-fine">These records do not activate real payouts or live promotional placement.</p></section>}</aside></div>
      {(error || notice) && <div className={error ? 'billing-page-feedback form-error' : 'billing-page-feedback billing-success'} role={error ? 'alert' : 'status'}>{error ? <CircleAlert size={18} /> : <Check size={18} />}{error || notice}</div>}
      {selectedRecord && <Modal title="Billing statement" onClose={() => setSelectedRecord(null)}>
        <BillSummary quote={selectedRecord.quote} record={selectedRecord} context={contextFor(selectedRecord, selectedRecord.quote)} />
        <div className="billing-receipt-actions">
          <button type="button" className="button secondary" onClick={() => window.print()}><Printer size={15} />Print / save PDF</button>
          {!admin && selectedRecord.owner_id === data.user.id && ['quoted', 'pending'].includes(selectedRecord.status) && <button type="button" className="button primary" disabled={busy || !summary.capabilities.configured} onClick={() => {
            const record = selectedRecord; setSelectedRecord(null);
            startPayment({ billing_id: record.id });
          }}>Resume test checkout</button>}
        </div>
      </Modal>}
    </>}
  </div>;
}
