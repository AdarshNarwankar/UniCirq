import { CalendarDays, CircleCheck, Clock3, FileText, MapPin, ReceiptText } from 'lucide-react';
import type { BillingQuote, BillingRecord } from '@/lib/billing';
import { billSummaryView, type BillLine } from '@/lib/bill-summary';
import { moneyLabel } from '@/lib/domain';

export interface BillContext {
  title: string;
  customer?: string;
  provider?: string;
  campus?: string;
  quantity?: string;
  period?: string;
}
const display = (value: number | null) => value === null ? 'To be confirmed' : value < 0 ? '−' + moneyLabel(-value) : moneyLabel(value);
const date = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function SummaryLines({ rows }: { rows: BillLine[] }) {
  return <dl className="bill-summary-lines">{rows.map(row => <div key={row.id} className={row.amount !== null && row.amount < 0 ? 'is-deduction' : undefined}>
    <dt>{row.label}{row.note && <small>{row.note}</small>}</dt><dd>{display(row.amount)}</dd>
  </div>)}</dl>;
}

export function BillSummary({ quote, record, context }: { quote: BillingQuote; record?: BillingRecord; context: BillContext }) {
  const view = billSummaryView(quote, record);
  const StatusIcon = view.tone === 'confirmed' ? CircleCheck : view.tone === 'pending' ? Clock3 : ReceiptText;
  const allocationTitle = quote.fee_payer === 'provider' ? 'Service provider breakdown' : 'Seller allocation';
  const allocationContent = <><SummaryLines rows={view.allocation} /><div className="bill-summary-allocation-total"><span>{quote.fee_payer === 'provider' ? 'Provider allocation' : 'Seller allocation'}</span><strong>{display(view.allocationTotal)}</strong></div><p>{view.refund?.refunded ? 'Original allocation before refunds. No seller payout has been made.' : 'Allocation only. No seller payout has been made.'}</p></>;
  return <article className={`bill-summary${record ? ' is-statement billing-receipt' : ''}`} aria-label="Bill summary">
    <header className="bill-summary-heading"><span className="bill-summary-emblem"><FileText size={21} aria-hidden="true" /></span><div><span className="bill-summary-brand">UniCirq</span><h3>Bill summary</h3></div><span className="bill-summary-mode">TEST MODE</span></header>
    <div className="bill-summary-item"><span>{quote.purpose === 'order' ? 'CAMPUS EXCHANGE' : quote.purpose === 'boost' ? 'LISTING BOOST · 7 DAYS' : 'BUSINESS PLAN · MONTHLY'}</span><h4>{context.title}</h4>{context.quantity && <p>{context.quantity}</p>}{context.period && <p className="bill-summary-period"><CalendarDays size={13} aria-hidden="true" />{context.period}</p>}{context.campus && <p className="bill-summary-campus"><MapPin size={13} aria-hidden="true" />{context.campus}</p>}</div>
    {(context.customer || context.provider) && <div className="bill-summary-people">{context.customer && <div><span>{quote.purpose === 'order' ? 'Customer' : 'Billed account'}</span><strong>{context.customer}</strong></div>}{context.provider && <div><span>Seller / service provider</span><strong>{context.provider}</strong></div>}</div>}
    {record && <dl className="bill-summary-reference"><div><dt>Statement reference</dt><dd>{record.id}</dd></div><div><dt>Created</dt><dd>{date(record.created_at)} IST</dd></div>{record.reference_id && <div><dt>{record.purpose === 'order' ? 'Exchange reference' : record.purpose === 'boost' ? 'Listing reference' : 'Business reference'}</dt><dd>{record.reference_id}</dd></div>}<div><dt>Arrangement</dt><dd>{record.payment_mode === 'direct' ? 'Direct between participants' : record.provider_mode === 'upi_manual' ? 'UPI · manual verification' : 'Razorpay test checkout'}</dd></div>{record.manual_utr && <div><dt>UPI transaction reference</dt><dd>{record.manual_utr}</dd></div>}{record.provider_payment_id && <div><dt>Test payment reference</dt><dd>{record.provider_payment_id}</dd></div>}{record.paid_at && <div><dt>{record.provider_mode === 'upi_manual' ? 'UPI payment verified' : 'Test capture confirmed'}</dt><dd>{date(record.paid_at)} IST</dd></div>}</dl>}
    <SummaryLines rows={view.lines} />
    <div className="bill-summary-total"><div><span>{view.totalLabel}</span><small>INR{quote.tax_amount === null ? ' · final tax not confirmed' : ' · all displayed charges included'}</small></div><strong>{view.total === null ? 'Pending tax setup' : moneyLabel(view.total)}</strong></div>
    <div className={`bill-summary-status is-${view.tone}`}><StatusIcon size={15} aria-hidden="true" /><span>{view.status}</span></div>
    {view.refund && <section className="bill-summary-refund" aria-label="Test payment reconciliation"><h4>Test payment summary</h4><dl><div><dt>Captured test amount</dt><dd>{moneyLabel(view.refund.captured)}</dd></div><div><dt>Refunded test amount</dt><dd>{moneyLabel(view.refund.refunded)}</dd></div><div><dt>Remaining captured test amount</dt><dd>{moneyLabel(view.refund.remaining)}</dd></div></dl></section>}
    {quote.purpose === 'order' && (record
      ? <section className="bill-summary-allocation"><h4 className="bill-summary-allocation-heading">{allocationTitle}</h4>{allocationContent}</section>
      : <details className="bill-summary-allocation" open={quote.fee_payer === 'provider'}><summary>{allocationTitle}<span>{display(view.allocationTotal)}</span></summary>{allocationContent}</details>)}
    <footer className="bill-summary-footer"><p>{view.note}</p><p>{quote.purpose === 'order' ? 'Refundable deposits are not collected. ' : ''}{record?.provider_mode === 'upi_manual' ? 'UPI payment confirmation depends on manual account reconciliation. This is not a GST tax invoice.' : 'This is a test billing statement, not a GST tax invoice.'}</p></footer>
  </article>;
}
