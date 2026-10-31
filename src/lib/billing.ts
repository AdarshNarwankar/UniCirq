import { z } from 'zod';
import type { Kind } from './domain';

export type BillingPurpose = 'order' | 'boost' | 'business_plan';
export type BillingPaymentMode = 'direct' | 'checkout';
export type BillingPlan = 'featured' | 'growth';
export type BillingStatus = 'quoted' | 'pending' | 'manual_pending' | 'paid' | 'recorded' | 'refunded';

// All monetary values are integer paise. Gateway processing is included in the
// published platform fee; deposits are not collected by this pilot integration.
export const billingPolicy = Object.freeze({
  policy_version: '2026-10-pilot',
  minimum_fee: 1900,
  sale_bps: 500,
  rental_bps: 800,
  service_bps: 800,
  boost_amount: 2900,
  boost_days: 7,
});

export const billingUpiId = 'adarshnarwankar47@okhdfcbank';
export const billingUpiPayeeName = 'UniCirq';

export const billingPlans = Object.freeze([
  Object.freeze({ id: 'featured' as const, name: 'Featured', amount: 49900 }),
  Object.freeze({ id: 'growth' as const, name: 'Growth', amount: 99900 }),
]);

export interface BillingSelection {
  purpose: BillingPurpose;
  reference_id?: string;
  payment_mode: BillingPaymentMode;
  plan?: BillingPlan;
}

export interface BillingGroupSelection {
  purpose: 'order_group';
  order_ids: string[];
  payment_mode: BillingPaymentMode;
}

export interface BillingGroupQuote extends BillingQuote {
  billing_category: 'sale' | 'rental' | 'service';
  seller_id: string;
  college_id: string;
  selection_key: string;
  order_ids: string[];
  items: Array<{
    order_id: string;
    listing_id: string;
    kind: Kind;
    amount: number;
    terms_snapshot: object;
  }>;
  delivery_amount: number;
}

// Clients select an existing resource or plan; they never supply a charge,
// deposit, tax rate, beneficiary, entitlement, or provider payment status.
export const billingSelectionSchema = z.discriminatedUnion('purpose', [
  z.strictObject({ purpose: z.literal('order'), reference_id: z.string().uuid(), payment_mode: z.enum(['direct', 'checkout']) }),
  z.strictObject({ purpose: z.literal('boost'), reference_id: z.string().uuid(), payment_mode: z.literal('checkout') }),
  z.strictObject({ purpose: z.literal('business_plan'), payment_mode: z.literal('checkout'), plan: z.enum(['featured', 'growth']) }),
]);
export const billingGroupSelectionSchema = z.strictObject({
  purpose: z.literal('order_group'),
  order_ids: z.array(z.string().uuid()).min(1).max(20),
  payment_mode: z.enum(['direct', 'checkout']),
});

export interface BillingQuote {
  policy_version: string;
  purpose: BillingPurpose;
  currency: 'INR';
  base_amount: number;
  platform_fee: number;
  tax_amount: number | null;
  tax_bps: number | null;
  deposit_amount: 0;
  buyer_total: number | null;
  seller_net: number | null;
  fee_payer: 'buyer' | 'renter' | 'provider' | 'business' | 'seller' | 'none';
  payment_mode: BillingPaymentMode;
  pilot_waived: boolean;
  description: string;
  period_days: number | null;
}

export interface BillingRecord {
  id: string;
  owner_id: string;
  beneficiary_id: string | null;
  college_id: string;
  purpose: BillingPurpose;
  reference_id: string | null;
  plan: string | null;
  payment_mode: BillingPaymentMode;
  quote: BillingQuote;
  status: BillingStatus;
  provider_mode: 'test' | 'upi_manual';
  provider_order_id: string | null;
  provider_payment_id: string | null;
  refunded_amount: number;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  manual_utr: string | null;
  manual_submitted_at: string | null;
  manual_reviewed_at: string | null;
  manual_reviewer_id: string | null;
  manual_review_note: string | null;
}

export interface BillingEntitlement {
  id: string;
  owner_id: string;
  listing_id: string | null;
  feature: 'listing_boost' | BillingPlan;
  starts_at: string;
  expires_at: string;
  billing_id: string;
  provider_mode: 'test';
}

export interface BillingSummary {
  records: BillingRecord[];
  entitlements: BillingEntitlement[];
  settings: { tax_bps: number | null; business_pilot: boolean };
  capabilities: { mode: 'test'; configured: boolean; manual_upi: boolean; reason: string };
  totals: { gross: number; platform_fees: number; tax: number; seller_payable: number; refunded: number };
  next_cursor: string | null;
}

export interface BillingQuoteInput {
  purpose: BillingPurpose;
  kind?: Kind;
  amount?: number;
  payment_mode: BillingPaymentMode;
  plan?: BillingPlan;
  tax_bps: number | null;
  business_pilot: boolean;
}

function paise(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Use a non-negative, safe integer amount in paise.');
  }
  return value;
}

function checked(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The billing amount is too large.');
  return Number(value);
}

// Half-up rounding happens once, at paise precision; binary floating-point
// percentages never decide a financial amount.
function percentage(amount: number, bps: number): number {
  return checked((BigInt(amount) * BigInt(bps) + 5000n) / 10000n);
}

/**
 * Pure policy calculation for previews and tests. The billing repository must
 * obtain amounts, ownership and settings from trusted server/database records.
 * A pending tax setting is explicit, rather than silently presenting zero tax.
 */
export function calculateBillingQuote(input: BillingQuoteInput): BillingQuote {
  if (!['order', 'boost', 'business_plan'].includes(input.purpose) || !['direct', 'checkout'].includes(input.payment_mode)) {
    throw new Error('Choose a supported billing option.');
  }
  if (input.tax_bps !== null && (!Number.isInteger(input.tax_bps) || input.tax_bps < 0 || input.tax_bps > 10000)) {
    throw new Error('Configure a valid platform-fee tax rate in basis points.');
  }
  if (typeof input.business_pilot !== 'boolean') throw new Error('Configure the business pilot policy.');

  let base: number;
  let fee: number;
  let feePayer: BillingQuote['fee_payer'];
  let description: string;
  let periodDays: number | null = null;
  let pilotWaived = false;

  if (input.purpose === 'order') {
    if (!input.kind || !['sale', 'hardware', 'rental', 'service'].includes(input.kind)) throw new Error('Choose a supported exchange kind.');
    base = paise(input.amount);
    if (input.payment_mode === 'direct' || base === 0) {
      fee = 0;
      feePayer = 'none';
    } else {
      const rate = input.kind === 'rental' ? billingPolicy.rental_bps : input.kind === 'service' ? billingPolicy.service_bps : billingPolicy.sale_bps;
      fee = Math.max(billingPolicy.minimum_fee, percentage(base, rate));
      feePayer = input.kind === 'rental' ? 'renter' : input.kind === 'service' ? 'provider' : 'buyer';
      if (input.kind === 'service' && fee > base) throw new Error('The service price must cover the platform fee.');
    }
    description = input.payment_mode === 'direct' ? 'Direct campus exchange'
      : input.kind === 'rental' ? 'UniCirq rental checkout'
      : input.kind === 'service' ? 'UniCirq service checkout' : 'UniCirq sale checkout';
  } else {
    if (input.payment_mode !== 'checkout') throw new Error('Choose checkout for a platform purchase.');
    if (input.purpose === 'boost') {
      base = billingPolicy.boost_amount;
      fee = base;
      feePayer = 'seller';
      periodDays = billingPolicy.boost_days;
      description = 'Listing boost · 7 days';
    } else {
      const plan = billingPlans.find(plan => plan.id === input.plan);
      if (!plan) throw new Error('Choose a supported business plan.');
      base = plan.amount;
      pilotWaived = input.business_pilot;
      fee = pilotWaived ? 0 : base;
      feePayer = 'business';
      description = `${plan.name} business plan · monthly`;
    }
  }

  const tax = fee === 0 ? 0 : input.tax_bps === null ? null : percentage(fee, input.tax_bps);
  let buyerTotal: number | null = null;
  let sellerNet: number | null = null;
  if (tax !== null) {
    if (input.purpose !== 'order') {
      buyerTotal = checked(BigInt(fee) + BigInt(tax));
      sellerNet = 0;
    } else if (feePayer === 'provider') {
      const deduction = BigInt(fee) + BigInt(tax);
      if (deduction > BigInt(base)) throw new Error('The service price must cover the platform fee and its tax.');
      buyerTotal = base;
      sellerNet = checked(BigInt(base) - deduction);
    } else {
      buyerTotal = checked(BigInt(base) + BigInt(fee) + BigInt(tax));
      sellerNet = base;
    }
  }

  return {
    policy_version: billingPolicy.policy_version,
    purpose: input.purpose,
    currency: 'INR',
    base_amount: base,
    platform_fee: fee,
    tax_amount: tax,
    tax_bps: input.tax_bps,
    deposit_amount: 0,
    buyer_total: buyerTotal,
    seller_net: sellerNet,
    fee_payer: feePayer,
    payment_mode: input.payment_mode,
    pilot_waived: pilotWaived,
    description,
    period_days: periodDays,
  };
}
