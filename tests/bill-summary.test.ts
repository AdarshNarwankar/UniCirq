import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBillingQuote, type BillingQuote } from '../src/lib/billing';
import { billSummaryView } from '../src/lib/bill-summary';

const exchange = (kind: 'sale' | 'rental' | 'service', amount: number, tax_bps: number | null = 1800) => calculateBillingQuote({ purpose: 'order', kind, amount, payment_mode: 'checkout', tax_bps, business_pilot: true });
const sum = (rows: { amount: number | null }[]) => rows.reduce((result, row) => result + (row.amount ?? 0), 0);
test('sale and rental customer bill lines reconcile to the server total, excluding allocation', () => {
  for (const quote of [exchange('sale', 100000), exchange('rental', 40000)]) {
    const view = billSummaryView(quote);
    assert.equal(sum(view.lines), quote.buyer_total);
    assert.equal(view.allocationTotal, quote.base_amount);
    assert.equal(view.refund, null);
  }
  assert.equal(billSummaryView(exchange('sale', 100000)).total, 105900);
});
test('service deductions do not add to the customer total and reconcile to the provider allocation', () => {
  const view = billSummaryView(exchange('service', 50000));
  assert.equal(sum(view.lines), 50000);
  assert.equal(view.total, 50000);
  assert.equal(sum(view.allocation), 45280);
  assert.equal(view.allocationTotal, 45280);
  assert.equal(view.lines.find(line => line.id === 'fee')?.amount, 0);
});
test('boost product is charged once and free pilot plans have an explicit numeric discount', () => {
  const boost = billSummaryView(calculateBillingQuote({ purpose: 'boost', payment_mode: 'checkout', tax_bps: 1800, business_pilot: true }));
  assert.equal(sum(boost.lines), 3422); assert.equal(boost.total, 3422); assert.deepEqual(boost.allocation, []);
  const plan = billSummaryView(calculateBillingQuote({ purpose: 'business_plan', plan: 'featured', payment_mode: 'checkout', tax_bps: null, business_pilot: true }));
  assert.equal(plan.lines.find(line => line.id === 'discount')?.amount, -49900);
  assert.equal(sum(plan.lines), 0); assert.equal(plan.total, 0); assert.equal(plan.status, 'No payment required');
});
test('unconfirmed tax never renders a final payable total or a zero provider tax deduction', () => {
  const quote = exchange('sale', 100000, null), view = billSummaryView(quote);
  assert.equal(view.lines.find(line => line.id === 'tax')?.amount, null); assert.equal(view.total, null);
  const service = billSummaryView(exchange('service', 50000, null));
  assert.equal(service.allocation.find(line => line.id === 'provider-tax')?.amount, null); assert.equal(service.allocationTotal, null);
});
test('direct records and zero-price checkout do not imply a captured payment', () => {
  const direct = calculateBillingQuote({ purpose: 'order', kind: 'sale', amount: 100000, payment_mode: 'direct', tax_bps: null, business_pilot: true });
  const view = billSummaryView(direct, { status: 'recorded', payment_mode: 'direct', refunded_amount: 0 });
  assert.equal(view.status, 'Payment not verified'); assert.equal(view.refund, null); assert.equal(view.totalLabel, 'Agreed direct amount');
  const free = billSummaryView(exchange('sale', 0), { status: 'recorded', payment_mode: 'checkout', refunded_amount: 0 });
  assert.equal(free.status, 'No payment required'); assert.equal(free.refund, null);
});
test('only captured records show reconciliation and refunds do not leave the original total labelled payable', () => {
  const quote: BillingQuote = exchange('sale', 100000);
  for (const status of ['quoted', 'pending'] as const) assert.equal(billSummaryView(quote, { status, payment_mode: 'checkout', refunded_amount: 0 }).refund, null);
  const partial = billSummaryView(quote, { status: 'paid', payment_mode: 'checkout', refunded_amount: 20000 });
  assert.deepEqual(partial.refund, { captured: 105900, refunded: 20000, remaining: 85900 }); assert.equal(partial.totalLabel, 'Original test total');
  const full = billSummaryView(quote, { status: 'refunded', payment_mode: 'checkout', refunded_amount: 105900 });
  assert.equal(full.refund?.remaining, 0); assert.equal(full.status, 'Fully refunded · test');
});
