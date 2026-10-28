import test from 'node:test';
import assert from 'node:assert/strict';
import { billingPlans, billingPolicy, billingSelectionSchema, calculateBillingQuote, type BillingQuoteInput } from '../src/lib/billing';

const order = (patch: Partial<BillingQuoteInput> = {}) => calculateBillingQuote({
  purpose: 'order', kind: 'sale', amount: 100000, payment_mode: 'checkout', tax_bps: 0, business_pilot: true, ...patch,
});
const reference = '12345678-1234-4234-8234-123456789abc';

test('checkout follows the published sale, rental and service examples without adding gateway costs', () => {
  const sale = order();
  assert.equal(sale.platform_fee, 5000);
  assert.equal(sale.buyer_total, 105000);
  assert.equal(sale.seller_net, 100000);
  assert.equal(sale.fee_payer, 'buyer');
  assert.equal(sale.deposit_amount, 0);
  assert.equal(sale.policy_version, '2026-10-pilot');
  assert.equal(sale.currency, 'INR');

  const rental = order({ kind: 'rental', amount: 40000 });
  assert.equal(rental.platform_fee, 3200);
  assert.equal(rental.buyer_total, 43200);
  assert.equal(rental.seller_net, 40000);
  assert.equal(rental.fee_payer, 'renter');

  const service = order({ kind: 'service', amount: 50000 });
  assert.equal(service.platform_fee, 4000);
  assert.equal(service.buyer_total, 50000);
  assert.equal(service.seller_net, 46000);
  assert.equal(service.fee_payer, 'provider');
  assert.equal(order({ kind: 'hardware' }).platform_fee, sale.platform_fee);
});

test('direct exchanges retain the full amount and stay free without tax configuration', () => {
  for (const kind of ['sale', 'hardware', 'rental', 'service'] as const) {
    const quote = order({ kind, amount: 100, payment_mode: 'direct', tax_bps: null });
    assert.equal(quote.platform_fee, 0);
    assert.equal(quote.tax_amount, 0);
    assert.equal(quote.tax_bps, null);
    assert.equal(quote.buyer_total, 100);
    assert.equal(quote.seller_net, 100);
    assert.equal(quote.fee_payer, 'none');
  }
});

test('minimum fee is per order, half-up at paise precision, and zero-cost exchanges remain free', () => {
  assert.equal(order({ amount: 100 }).platform_fee, 1900);
  assert.equal(order({ amount: 37999 }).platform_fee, 1900);
  assert.equal(order({ amount: 38010 }).platform_fee, 1901);
  assert.equal(order({ kind: 'rental', amount: 23757 }).platform_fee, 1901);
  for (const kind of ['sale', 'hardware', 'rental', 'service'] as const) {
    const quote = order({ kind, amount: 0, tax_bps: null });
    assert.equal(quote.platform_fee, 0);
    assert.equal(quote.tax_amount, 0);
    assert.equal(quote.buyer_total, 0);
    assert.equal(quote.seller_net, 0);
    assert.equal(quote.fee_payer, 'none');
  }
});

test('tax applies only to the platform fee and follows the original fee payer', () => {
  const sale = order({ tax_bps: 1800 });
  assert.equal(sale.tax_amount, 900);
  assert.equal(sale.buyer_total, 105900);
  assert.equal(sale.seller_net, 100000);
  const service = order({ kind: 'service', amount: 50000, tax_bps: 1800 });
  assert.equal(service.tax_amount, 720);
  assert.equal(service.buyer_total, 50000);
  assert.equal(service.seller_net, 45280);
  assert.equal(order({ amount: 38010, tax_bps: 5000 }).tax_amount, 951);
});

test('pending tax cannot silently turn into a payable zero-tax checkout', () => {
  for (const kind of ['sale', 'hardware', 'rental', 'service'] as const) {
    const quote = order({ kind, tax_bps: null });
    assert.equal(quote.tax_amount, null);
    assert.equal(quote.buyer_total, null);
    assert.equal(quote.seller_net, null);
    assert.ok(quote.platform_fee > 0);
  }
  const boost = calculateBillingQuote({ purpose: 'boost', payment_mode: 'checkout', tax_bps: null, business_pilot: true });
  assert.equal(boost.buyer_total, null);
  assert.equal(boost.tax_amount, null);
});

test('a service deduction cannot exceed the provider amount, including fee tax', () => {
  assert.throws(() => order({ kind: 'service', amount: 1899 }), /cover the platform fee/);
  assert.throws(() => order({ kind: 'service', amount: 2000, tax_bps: 1800 }), /cover the platform fee and its tax/);
  assert.equal(order({ kind: 'service', amount: 1900 }).seller_net, 0);
  assert.equal(order({ kind: 'service', amount: 2242, tax_bps: 1800 }).seller_net, 0);
});

test('boost is a single seven-day platform purchase with fee tax and no double-counted base', () => {
  const boost = calculateBillingQuote({ purpose: 'boost', payment_mode: 'checkout', tax_bps: 1800, business_pilot: true });
  assert.equal(boost.base_amount, 2900);
  assert.equal(boost.platform_fee, 2900);
  assert.equal(boost.tax_amount, 522);
  assert.equal(boost.buyer_total, 3422);
  assert.equal(boost.seller_net, 0);
  assert.equal(boost.period_days, 7);
  assert.equal(boost.fee_payer, 'seller');
});

test('business plans are free during the initial pilot and retain their published monthly price', () => {
  assert.deepEqual(billingPlans.map(plan => plan.amount), [49900, 99900]);
  for (const plan of billingPlans) {
    const quote = calculateBillingQuote({ purpose: 'business_plan', plan: plan.id, payment_mode: 'checkout', tax_bps: null, business_pilot: true });
    assert.equal(quote.base_amount, plan.amount);
    assert.equal(quote.platform_fee, 0);
    assert.equal(quote.tax_amount, 0);
    assert.equal(quote.buyer_total, 0);
    assert.equal(quote.seller_net, 0);
    assert.equal(quote.pilot_waived, true);
    assert.equal(quote.period_days, null, 'Calendar-month plan periods must not be represented as thirty fixed days');
  }
  const charged = calculateBillingQuote({ purpose: 'business_plan', plan: 'featured', payment_mode: 'checkout', tax_bps: 1800, business_pilot: false });
  assert.equal(charged.platform_fee, 49900);
  assert.equal(charged.tax_amount, 8982);
  assert.equal(charged.buyer_total, 58882);
  assert.equal(charged.pilot_waived, false);
});

test('billing rejects unsafe amounts, unsupported modes and invalid settings before calculating a quote', () => {
  for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.throws(() => order({ amount }), /safe integer/);
  }
  for (const tax_bps of [-1, 10001, 0.5, NaN, undefined] as unknown as number[]) {
    assert.throws(() => order({ tax_bps }), /tax rate/);
  }
  assert.throws(() => order({ amount: Number.MAX_SAFE_INTEGER }), /too large/);
  assert.throws(() => order({ kind: undefined }), /exchange kind/);
  assert.throws(() => order({ purpose: 'unsupported' as 'order' }), /billing option/);
  assert.throws(() => order({ payment_mode: 'live' as 'checkout' }), /billing option/);
  assert.throws(() => order({ business_pilot: undefined as unknown as boolean }), /pilot policy/);
  assert.throws(() => calculateBillingQuote({ purpose: 'boost', payment_mode: 'direct', tax_bps: 0, business_pilot: true }), /checkout/);
  assert.throws(() => calculateBillingQuote({ purpose: 'business_plan', payment_mode: 'checkout', tax_bps: 0, business_pilot: true }), /business plan/);
  assert.equal(order({ amount: Number.MAX_SAFE_INTEGER, payment_mode: 'direct' }).buyer_total, Number.MAX_SAFE_INTEGER);
  assert.ok(Object.isFrozen(billingPolicy));
  assert.ok(Object.isFrozen(billingPlans));
});

test('selection schema permits only the correct resource context and rejects client financial or privilege fields', () => {
  for (const input of [
    { purpose: 'order', reference_id: reference, payment_mode: 'direct' },
    { purpose: 'order', reference_id: reference, payment_mode: 'checkout' },
    { purpose: 'boost', reference_id: reference, payment_mode: 'checkout' },
    { purpose: 'business_plan', plan: 'featured', payment_mode: 'checkout' },
    { purpose: 'business_plan', plan: 'growth', payment_mode: 'checkout' },
  ]) assert.equal(billingSelectionSchema.safeParse(input).success, true);
  const valid = { purpose: 'order', reference_id: reference, payment_mode: 'checkout' };
  for (const extra of [
    { amount: 1 }, { platform_fee: 0 }, { tax_bps: 0 }, { deposit_amount: 100000 },
    { owner_id: reference }, { beneficiary_id: reference }, { paid: true }, { plan: 'growth' },
  ]) assert.equal(billingSelectionSchema.safeParse({ ...valid, ...extra }).success, false);
  for (const input of [
    { purpose: 'order', payment_mode: 'checkout' },
    { ...valid, reference_id: 'not-a-uuid' },
    { purpose: 'boost', reference_id: reference, payment_mode: 'direct' },
    { purpose: 'business_plan', plan: 'growth', payment_mode: 'direct' },
    { purpose: 'business_plan', plan: 'premium', payment_mode: 'checkout' },
    { purpose: 'business_plan', plan: 'growth', reference_id: reference, payment_mode: 'checkout' },
  ]) assert.equal(billingSelectionSchema.safeParse(input).success, false);
});
