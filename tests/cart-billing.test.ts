
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCartBillingQuotes } from '../src/lib/cart-billing';

const defaults = {
  payment_mode: 'checkout' as const,
  tax_bps: 0,
  business_pilot: true,
};

test('groups multiple sale listings by seller', () => {
  const result = calculateCartBillingQuotes({
    ...defaults,
    lines: [
      { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: 50000 },
      { listing_id: 'b', seller_id: 'seller-2', kind: 'sale', amount: 80000 },
      { listing_id: 'c', seller_id: 'seller-1', kind: 'hardware', amount: 30000 },
    ],
  });

  assert.equal(result.length, 2);

  const seller1 = result.find((item) => item.seller_id === 'seller-1');
  const seller2 = result.find((item) => item.seller_id === 'seller-2');

  assert.ok(seller1);
  assert.ok(seller2);

  assert.equal(seller1.category, 'sale');
  assert.equal(seller1.base_amount, 80000);
  assert.equal(seller1.platform_fee, 4000);
  assert.equal(seller1.buyer_total, 84000);
  assert.deepEqual(seller1.listing_ids, ['a', 'c']);

  assert.equal(seller2.base_amount, 80000);
  assert.equal(seller2.platform_fee, 4000);
  assert.equal(seller2.buyer_total, 84000);
});

test('creates separate bills for different categories belonging to one seller', () => {
  const result = calculateCartBillingQuotes({
    ...defaults,
    lines: [
      { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: 100000 },
      { listing_id: 'b', seller_id: 'seller-1', kind: 'rental', amount: 40000, deposit_amount: 10000 },
      { listing_id: 'c', seller_id: 'seller-1', kind: 'service', amount: 50000 },
    ],
  });

  assert.equal(result.length, 3);

  const sale = result.find((item) => item.category === 'sale');
  const rental = result.find((item) => item.category === 'rental');
  const service = result.find((item) => item.category === 'service');

  assert.ok(sale);
  assert.ok(rental);
  assert.ok(service);

  assert.equal(sale.buyer_total, 105000);
  assert.equal(rental.platform_fee, 3200);
  assert.equal(rental.deposit_amount, 10000);
  assert.equal(rental.buyer_total, 53200);

  assert.equal(service.platform_fee, 4000);
  assert.equal(service.buyer_total, 50000);
  assert.equal(service.seller_net, 46000);
});

test('applies the minimum fee once per seller-category bill', () => {
  const result = calculateCartBillingQuotes({
    ...defaults,
    lines: [
      { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: 100 },
      { listing_id: 'b', seller_id: 'seller-1', kind: 'sale', amount: 100 },
      { listing_id: 'c', seller_id: 'seller-2', kind: 'sale', amount: 100 },
    ],
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].platform_fee, 1900);
  assert.equal(result[1].platform_fee, 1900);
});

test('excludes delivery and rental deposits from commission calculations', () => {
  const result = calculateCartBillingQuotes({
    ...defaults,
    lines: [
      {
        listing_id: 'a',
        seller_id: 'seller-1',
        kind: 'rental',
        amount: 40000,
        delivery_amount: 5000,
        deposit_amount: 10000,
      },
    ],
  });

  assert.equal(result[0].base_amount, 40000);
  assert.equal(result[0].platform_fee, 3200);
  assert.equal(result[0].delivery_amount, 5000);
  assert.equal(result[0].deposit_amount, 10000);
  assert.equal(result[0].buyer_total, 58200);
});

test('direct mode does not charge commission', () => {
  const result = calculateCartBillingQuotes({
    payment_mode: 'direct',
    tax_bps: null,
    business_pilot: true,
    lines: [
      { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: 100000 },
    ],
  });

  assert.equal(result[0].platform_fee, 0);
  assert.equal(result[0].buyer_total, 100000);
  assert.equal(result[0].seller_net, 100000);
});

test('returns unknown tax totals when tax configuration is missing', () => {
  const result = calculateCartBillingQuotes({
    ...defaults,
    tax_bps: null,
    lines: [
      { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: 100000 },
    ],
  });

  assert.equal(result[0].platform_fee, 5000);
  assert.equal(result[0].tax_amount, null);
  assert.equal(result[0].buyer_total, null);
});

test('rejects duplicate listings', () => {
  assert.throws(
    () => calculateCartBillingQuotes({
      ...defaults,
      lines: [
        { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: 10000 },
        { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: 20000 },
      ],
    }),
    /cannot appear more than once/,
  );
});

test('rejects deposits on non-rental listings', () => {
  assert.throws(
    () => calculateCartBillingQuotes({
      ...defaults,
      lines: [
        {
          listing_id: 'a',
          seller_id: 'seller-1',
          kind: 'sale',
          amount: 10000,
          deposit_amount: 5000,
        },
      ],
    }),
    /only for rentals/,
  );
});

test('rejects invalid monetary values', () => {
  assert.throws(
    () => calculateCartBillingQuotes({
      ...defaults,
      lines: [
        { listing_id: 'a', seller_id: 'seller-1', kind: 'sale', amount: -100 },
      ],
    }),
    /non-negative safe integer/,
  );
});

test('rejects an empty cart', () => {
  assert.throws(
    () => calculateCartBillingQuotes({
      ...defaults,
      lines: [],
    }),
    /at least one listing/,
  );
});
