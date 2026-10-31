import type { BillingQuote, BillingRecord } from './billing';

export interface BillLine { id: string; label: string; amount: number | null; note?: string }
type PaymentRecord = Pick<BillingRecord, 'status' | 'payment_mode' | 'refunded_amount'>;
export interface BillSummaryView {
  lines: BillLine[];
  allocation: BillLine[];
  total: number | null;
  totalLabel: string;
  allocationTotal: number | null;
  status: string;
  tone: 'neutral' | 'pending' | 'confirmed';
  note: string;
  refund: { captured: number; refunded: number; remaining: number } | null;
}

/** Display the persisted quote without recalculating its historical prices. */
export function billSummaryView(quote: BillingQuote, record?: PaymentRecord): BillSummaryView {
  const direct = quote.payment_mode === 'direct';
  const providerDeduction = quote.purpose === 'order' && quote.fee_payer === 'provider';
  const taxLabel = quote.tax_bps === null ? 'Tax on UniCirq charge' : `Tax on UniCirq charge (${quote.tax_bps / 100}%)`;
  const lines: BillLine[] = [{ id: 'subtotal', label: quote.purpose === 'order' ? 'Exchange subtotal' : 'Standard price', amount: quote.base_amount }];
  if (quote.purpose === 'order') {
    lines.push({ id: 'fee', label: 'UniCirq fee', amount: providerDeduction ? 0 : quote.platform_fee,
      note: providerDeduction ? 'Paid by the service provider; not added to the customer total.' : direct ? 'No commission on a direct arrangement.' : 'Payment processing included.' });
    lines.push({ id: 'tax', label: taxLabel, amount: providerDeduction ? 0 : quote.tax_amount,
      ...(providerDeduction ? { note: 'Any tax on the provider’s fee is included in their deduction below.' } : {}) });
  } else {
    if (quote.pilot_waived) lines.push({ id: 'discount', label: 'Pilot discount', amount: -quote.base_amount, note: 'Business plan charge waived during the pilot.' });
    lines.push({ id: 'tax', label: taxLabel, amount: quote.tax_amount });
  }
  const allocation: BillLine[] = quote.purpose === 'order' ? [
    { id: 'gross', label: 'Agreed exchange amount', amount: quote.base_amount },
    ...(providerDeduction ? [
      { id: 'provider-fee', label: 'UniCirq fee deduction', amount: -quote.platform_fee },
      { id: 'provider-tax', label: taxLabel, amount: quote.tax_amount === null ? null : -quote.tax_amount },
    ] : []),
  ] : [];

  let totalLabel = direct ? 'Agreed direct amount' : quote.buyer_total === 0 ? 'Total due' : 'Total payable';
  let status = direct ? 'Arrange directly' : quote.buyer_total === 0 ? 'No payment required' : quote.buyer_total === null ? 'Tax setup pending' : 'Ready for test checkout';
  let tone: BillSummaryView['tone'] = 'neutral';
  let note = direct ? 'Payment is arranged directly between participants. UniCirq has not collected or verified it.'
    : quote.pilot_waived ? 'Your pilot plan is free. No payment or automatic renewal is required.'
      : quote.buyer_total === 0 ? 'This statement has no charge. No payment was collected.'
        : 'Razorpay test mode only. No real money is charged, settled or paid out.';
  let refund: BillSummaryView['refund'] = null;
  if (record?.status === 'paid' || record?.status === 'refunded') {
    totalLabel = 'Original test total';
    status = record.refunded_amount > 0 ? record.status === 'refunded' ? 'Fully refunded · test' : 'Partially refunded · test' : 'Payment captured · test';
    tone = record.refunded_amount > 0 ? 'neutral' : 'confirmed';
    // Only a confirmed captured record represents funds, even in a sandbox.
    if (quote.buyer_total !== null) refund = { captured: quote.buyer_total, refunded: record.refunded_amount, remaining: quote.buyer_total - record.refunded_amount };
  } else if (record?.status === 'pending' || record?.status === 'quoted') {
    status = record.status === 'pending' ? 'Awaiting test payment' : 'Not paid · test';
    tone = 'pending';
  } else if (record?.status === 'manual_pending') {
    status = 'UPI payment awaiting verification';
    tone = 'pending';
    note = 'UPI payment submitted. UniCirq will confirm it only after an administrator reconciles the transaction reference.';
  } else if (record?.status === 'recorded') {
    status = direct ? 'Payment not verified' : quote.pilot_waived ? 'Free pilot plan' : 'No payment required';
  }
  return { lines, allocation, total: quote.buyer_total, totalLabel, allocationTotal: quote.seller_net, status, tone, note, refund };
}
