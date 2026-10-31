
import type { Kind } from './domain';
import {
  calculateBillingQuote,
  type BillingPaymentMode,
  type BillingQuote,
} from './billing';

export type CartBillingCategory = 'sale' | 'rental' | 'service';

export interface CartBillingLine {
  listing_id: string;
  seller_id: string;
  kind: Kind;
  amount: number;
  delivery_amount?: number;
  deposit_amount?: number;
}

export interface CartBillingInput {
  lines: CartBillingLine[];
  payment_mode: BillingPaymentMode;
  tax_bps: number | null;
  business_pilot: boolean;
}

export interface CartBillingResult {
  seller_id: string;
  category: CartBillingCategory;
  listing_ids: string[];
  base_amount: number;
  delivery_amount: number;
  deposit_amount: number;
  platform_fee: number;
  tax_amount: number | null;
  buyer_total: number | null;
  seller_net: number | null;
  fee_payer: BillingQuote['fee_payer'];
  payment_mode: BillingPaymentMode;
  policy_version: string;
}

function validateAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer in paise.`);
  }

  return value;
}

function safeSum(values: number[], label: string): number {
  const total = values.reduce(
    (sum, value) => sum + BigInt(value),
    0n,
  );

  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the maximum safe billing amount.`);
  }

  return Number(total);
}

function getCategory(kind: Kind): CartBillingCategory {
  if (kind === 'sale' || kind === 'hardware') return 'sale';
  if (kind === 'rental') return 'rental';
  if (kind === 'service') return 'service';

  throw new Error('Unsupported cart listing category.');
}

/**
 * Creates one independent billing quote per seller and category.
 *
 * Sale and hardware listings belonging to the same seller share
 * one Sale bill. Rental and service bills remain separate.
 *
 * All amounts are integer paise.
 */
export function calculateCartBillingQuotes(
  input: CartBillingInput,
): CartBillingResult[] {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('Add at least one listing to the cart.');
  }

  if (
    input.payment_mode !== 'direct' &&
    input.payment_mode !== 'checkout'
  ) {
    throw new Error('Choose a supported payment mode.');
  }

  if (
    input.tax_bps !== null &&
    (!Number.isInteger(input.tax_bps) ||
      input.tax_bps < 0 ||
      input.tax_bps > 10000)
  ) {
    throw new Error('Configure a valid tax rate.');
  }

  if (typeof input.business_pilot !== 'boolean') {
    throw new Error('Configure the business pilot policy.');
  }

  const seenListings = new Set<string>();

  const groups = new Map<
    string,
    {
      seller_id: string;
      category: CartBillingCategory;
      listing_ids: string[];
      amounts: number[];
      deliveries: number[];
      deposits: number[];
    }
  >();

  for (const line of input.lines) {
    if (
      typeof line.listing_id !== 'string' ||
      !line.listing_id.trim() ||
      typeof line.seller_id !== 'string' ||
      !line.seller_id.trim()
    ) {
      throw new Error('Every cart listing must have a listing and seller ID.');
    }

    if (seenListings.has(line.listing_id)) {
      throw new Error('A listing cannot appear more than once in the cart.');
    }

    seenListings.add(line.listing_id);

    const category = getCategory(line.kind);

    const amount = validateAmount(line.amount, 'Listing amount');
    const delivery = validateAmount(
      line.delivery_amount ?? 0,
      'Delivery amount',
    );
    const deposit = validateAmount(
      line.deposit_amount ?? 0,
      'Deposit amount',
    );

    if (category !== 'rental' && deposit !== 0) {
      throw new Error('Refundable deposits are supported only for rentals.');
    }

    const key = JSON.stringify([category, line.seller_id]);

    let group = groups.get(key);

    if (!group) {
      group = {
        seller_id: line.seller_id,
        category,
        listing_ids: [],
        amounts: [],
        deliveries: [],
        deposits: [],
      };

      groups.set(key, group);
    }

    group.listing_ids.push(line.listing_id);
    group.amounts.push(amount);
    group.deliveries.push(delivery);
    group.deposits.push(deposit);
  }

  const categoryOrder: Record<CartBillingCategory, number> = {
    sale: 0,
    rental: 1,
    service: 2,
  };

  const orderedGroups = [...groups.values()].sort(
    (a, b) =>
      categoryOrder[a.category] - categoryOrder[b.category] ||
      a.seller_id.localeCompare(b.seller_id),
  );

  return orderedGroups.map((group) => {
    const baseAmount = safeSum(group.amounts, 'Category subtotal');
    const deliveryAmount = safeSum(
      group.deliveries,
      'Delivery total',
    );
    const depositAmount = safeSum(
      group.deposits,
      'Rental deposit total',
    );

    const quote = calculateBillingQuote({
      purpose: 'order',
      kind: group.category,
      amount: baseAmount,
      payment_mode: input.payment_mode,
      tax_bps: input.tax_bps,
      business_pilot: input.business_pilot,
    });

    const additionalBuyerCharges = safeSum(
      [deliveryAmount, depositAmount],
      'Additional buyer charges',
    );

    const buyerTotal =
      quote.buyer_total === null
        ? null
        : safeSum(
            [quote.buyer_total, additionalBuyerCharges],
            'Buyer total',
          );

    return {
      seller_id: group.seller_id,
      category: group.category,
      listing_ids: group.listing_ids,
      base_amount: baseAmount,
      delivery_amount: deliveryAmount,
      deposit_amount: depositAmount,
      platform_fee: quote.platform_fee,
      tax_amount: quote.tax_amount,
      buyer_total: buyerTotal,
      seller_net: quote.seller_net,
      fee_payer: quote.fee_payer,
      payment_mode: quote.payment_mode,
      policy_version: quote.policy_version,
    };
  });
}
