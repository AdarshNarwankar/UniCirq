import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, withUser } from './db';
import { demoEnabled } from './config';
import { demoState } from '../demo';
import type { Profile } from '../domain';
import { AppError } from '../policy';
import type { BillingEntitlement, BillingRecord, BillingSelection, BillingSummary, BillingQuote, BillingGroupSelection, BillingGroupQuote } from '../billing';
import { calculateBillingQuote } from '../billing';
import { createRazorpayTestOrder, razorpayConfiguration, type RazorpayConfiguration } from '../razorpay';

type BillingSettings = BillingSummary['settings'];
const cursorSchema = z.strictObject({ created_at: z.iso.datetime({ offset: true }), id: z.string().uuid() });

export async function withBillingService<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE unicirq_billing_backend');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export function billingCapabilities(): BillingSummary['capabilities'] {
  const configured = !demoEnabled() && Boolean(razorpayConfiguration(process.env));
  return { mode: 'test', configured, reason: configured
    ? 'Razorpay test mode only. No real money, seller payout, deposit or insurance is provided.'
    : demoEnabled() ? 'Local sample billing. Connect Razorpay test credentials to try provider checkout.'
      : 'Razorpay test checkout needs its test key ID, private key secret and webhook secret. Free direct records and pilot plans remain available.' };
}

export async function limitBilling(userId: string, maximum = 30): Promise<void> {
  if (demoEnabled()) return;
  // This transaction commits separately, including denied attempts. A failed
  // financial command must not roll back its admission counter.
  const allowed = await withBillingService(async client => {
    const result = await client.query<{ allowed: boolean }>('SELECT app_billing_limit($1,$2,$3) AS allowed', ['billing:' + userId, maximum, 60]);
    return result.rows[0].allowed;
  });
  if (!allowed) throw new AppError('Too many billing requests. Please wait a minute.', 429);
}

export async function billingSummary(actor: Profile, cursor?: string): Promise<BillingSummary> {
  if (demoEnabled()) return demoBillingSummary(actor);
  let before: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try {
      if (cursor.length > 300) throw new Error();
      before = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } catch { throw new AppError('Invalid billing page', 400); }
  }
  return withUser(actor.id, async client => {
    const result = await client.query<BillingRecord>(`SELECT * FROM billing_records ${before ? 'WHERE (created_at,id)<($1::timestamptz,$2::uuid)' : ''} ORDER BY created_at DESC,id DESC LIMIT 51`, before ? [before.created_at, before.id] : []);
    const records = result.rows.slice(0, 50);
    const last = records.at(-1);
    const settings = (await client.query<BillingSettings>('SELECT tax_bps,business_pilot FROM billing_settings LIMIT 1')).rows[0];
    const entitlements = (await client.query('SELECT * FROM billing_entitlements WHERE expires_at>now() ORDER BY expires_at DESC LIMIT 100')).rows;
    const totals = (await client.query<BillingSummary['totals']>(`SELECT
      coalesce(sum((quote->>'buyer_total')::bigint) FILTER(WHERE status IN('paid','refunded')),0) AS gross,
      coalesce(sum((quote->>'platform_fee')::bigint) FILTER(WHERE status IN('paid','refunded')),0) AS platform_fees,
      coalesce(sum((quote->>'tax_amount')::bigint) FILTER(WHERE status IN('paid','refunded')),0) AS tax,
      coalesce(sum((quote->>'seller_net')::bigint) FILTER(WHERE status IN('paid','refunded')),0) AS seller_payable,
      coalesce(sum(refunded_amount),0) AS refunded FROM billing_records`)).rows[0];
    const numericTotals = Object.fromEntries(Object.entries(totals).map(([key, value]) => {
      const amount = Number(value);
      if (!Number.isSafeInteger(amount) || amount < 0) throw new AppError('Billing totals exceed the supported display range.', 503);
      return [key, amount];
    }));
    return JSON.parse(JSON.stringify({ records, entitlements, settings, totals: numericTotals, capabilities: billingCapabilities(),
      next_cursor: result.rows.length > 50 && last ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64url') : null })) as BillingSummary;
  });
}

export async function billingQuote(actor: Profile, selection: BillingSelection): Promise<BillingQuote> {
  if (demoEnabled()) return demoQuote(actor, selection);
  const existing = await findExistingBilling(actor, selection);
  if (existing) return existing.quote;
  return withUser(actor.id, async client => (await client.query('SELECT app_billing_quote($1::jsonb) AS quote', [JSON.stringify(selection)])).rows[0].quote);
}

export async function billingGroupQuote(actor: Profile, selection: BillingGroupSelection): Promise<BillingGroupQuote> {
  if (demoEnabled()) {
    throw new AppError('Grouped checkout is available after the billing database migration is applied.', 503);
  }
  return withUser(actor.id, async client => (await client.query(
    'SELECT app_billing_group_quote($1::jsonb) AS quote',
    [JSON.stringify({ order_ids: selection.order_ids, payment_mode: selection.payment_mode })],
  )).rows[0].quote as BillingGroupQuote);
}

export async function createBillingGroup(actor: Profile, selection: BillingGroupSelection) {
  if (demoEnabled()) {
    throw new AppError('Grouped checkout is available after the billing database migration is applied.', 503);
  }
  const quote = await billingGroupQuote(actor, selection);
  const configuration = razorpayConfiguration(process.env);
  if (selection.payment_mode === 'checkout' && (quote.buyer_total ?? 0) > 0 && !configuration) {
    throw new AppError(billingCapabilities().reason, 503);
  }
  const record = await withUser(actor.id, async client => (await client.query(
    'SELECT app_billing_group_create($1::jsonb) AS record',
    [JSON.stringify({ order_ids: selection.order_ids, payment_mode: selection.payment_mode })],
  )).rows[0].record as BillingRecord);
  if (record.status === 'recorded' || record.status === 'paid' || record.status === 'refunded') return { record };
  if (!configuration) throw new AppError(billingCapabilities().reason, 503);
  return prepareCheckout(record.id, actor.id, configuration);
}

async function findExistingBilling(actor: Profile, selection: BillingSelection): Promise<BillingRecord | null> {
  return withUser(actor.id, async client => {
    const reference = selection.purpose === 'business_plan' ? 'plan=$4' : 'reference_id=$4::uuid';
    const result = await client.query<BillingRecord>(`SELECT * FROM billing_records record WHERE owner_id=$1 AND purpose=$2 AND payment_mode=$3 AND ${reference}
      AND (purpose='order' OR status IN('quoted','pending') OR EXISTS(SELECT FROM billing_entitlements access WHERE access.billing_id=record.id AND access.expires_at>now()))
      AND NOT(status='quoted' AND provider_order_id IS NULL AND expires_at<now()) ORDER BY created_at DESC,id DESC LIMIT 1`,
      [actor.id, selection.purpose, selection.payment_mode, selection.purpose === 'business_plan' ? selection.plan : selection.reference_id]);
    return result.rows[0] ?? null;
  });
}

export async function configureBilling(actor: Profile, settings: { tax_bps: number | null; business_pilot: boolean; reason: string }) {
  if (actor.role !== 'admin') throw new AppError('Administrator access is required.', 403);
  if (demoEnabled()) { demoStore().settings = { tax_bps: settings.tax_bps, business_pilot: settings.business_pilot }; return demoStore().settings; }
  return withUser(actor.id, async client => (await client.query('SELECT app_billing_configure($1::jsonb) AS settings', [JSON.stringify(settings)])).rows[0].settings);
}

export async function createBilling(actor: Profile, selection: BillingSelection) {
  if (demoEnabled()) {
    const quote = demoQuote(actor, selection);
    if (quote.platform_fee > 0 && selection.payment_mode === 'checkout') throw new AppError(billingCapabilities().reason, 503);
    return { record: demoCreate(actor, selection, quote) };
  }
  const existing = await findExistingBilling(actor, selection);
  if (existing) return resumeBilling(actor, existing.id);
  const quote = await billingQuote(actor, selection);
  // Do not create a payment obligation when the provider cannot be used. The
  // authoritative quote is recalculated inside the database creation function.
  const configuration = razorpayConfiguration(process.env);
  if (selection.payment_mode === 'checkout' && (quote.buyer_total ?? 0) > 0 && !configuration) throw new AppError(billingCapabilities().reason, 503);
  const record = await withUser(actor.id, async client => (await client.query('SELECT app_billing_create($1::jsonb) AS record', [JSON.stringify(selection)])).rows[0].record as BillingRecord);
  if (record.status === 'recorded' || record.status === 'paid' || record.status === 'refunded') return { record };
  if (!configuration) throw new AppError(billingCapabilities().reason, 503);
  return prepareCheckout(record.id, actor.id, configuration);
}

export async function resumeBilling(actor: Profile, billingId: string) {
  if (demoEnabled()) {
    const record = demoStore().records.find(record => record.id === billingId && record.owner_id === actor.id);
    if (!record) throw new AppError('Billing record not found.', 404);
    return { record };
  }
  const record = await ownedBillingRecord(actor, billingId);
  if (['paid', 'refunded', 'recorded'].includes(record.status)) return { record };
  if (!actor.verified || actor.college_id !== record.college_id || actor.role !== (record.purpose === 'business_plan' ? 'business' : 'student')) {
    throw new AppError('Verified access for this billing record is required.', 403);
  }
  if (!record.provider_order_id && new Date(record.expires_at).getTime() < Date.now()) throw new AppError('This quote expired before checkout. Prepare a new quote.', 409);
  const configuration = razorpayConfiguration(process.env);
  if (!configuration) throw new AppError(billingCapabilities().reason, 503);
  return prepareCheckout(record.id, actor.id, configuration);
}

async function prepareCheckout(billingId: string, ownerId: string, configuration: RazorpayConfiguration) {
  return withBillingService(async client => {
    // The protected function locks this billing row. Concurrent retries reuse
    // its single attached gateway order instead of returning two payment links.
    let record = (await client.query('SELECT app_billing_backend_record($1) AS record', [billingId])).rows[0].record as BillingRecord | null;
    if (!record || record.owner_id !== ownerId) throw new AppError('Billing record not found.', 404);
    if (record.status === 'paid' || record.status === 'refunded' || record.status === 'recorded') return { record };
    const amount = record.quote.buyer_total;
    if (!amount) throw new AppError('Complete billing tax setup before test checkout.', 409);
    if (!record.provider_order_id) {
      const order = await createRazorpayTestOrder(amount, record.id, configuration);
      record = (await client.query('SELECT app_billing_attach($1,$2) AS record', [record.id, order.id])).rows[0].record as BillingRecord;
    }
    return { record, checkout: { key: configuration.keyId, amount, currency: 'INR' as const, order_id: record.provider_order_id!, name: 'UniCirq', description: record.quote.description + ' · TEST', billing_id: record.id } };
  });
}

export async function ownedBillingRecord(actor: Profile, billingId: string): Promise<BillingRecord> {
  return withUser(actor.id, async client => {
    const result = await client.query<BillingRecord>('SELECT * FROM billing_records WHERE id=$1 AND owner_id=$2', [billingId, actor.id]);
    if (!result.rows[0]) throw new AppError('Billing record not found.', 404);
    return result.rows[0];
  });
}

export function billingFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = (error as { code?: string })?.code;
  if (code === '42501') return new AppError('You do not have access to this billing action.', 403);
  // Database messages are controlled SQL validation, never raw provider errors.
  if (code === 'P0001') return new AppError((error as Error).message, 409);
  if (code === '55P03' || code === '57014') return new AppError('This billing action is being processed. Retry shortly.', 409);
  return new AppError('Billing is temporarily unavailable. Please try again.', 503);
}

type DemoStore = { settings: BillingSettings; records: BillingRecord[]; entitlements: BillingEntitlement[] };
const globals = globalThis as unknown as { unicirqDemoBilling?: DemoStore };
function demoStore(): DemoStore {
  const store = globals.unicirqDemoBilling ??= { settings: { tax_bps: 0, business_pilot: true }, records: [], entitlements: [] };
  store.entitlements ??= [];
  return store;
}
function existingDemoRecord(actor: Profile, selection: BillingSelection) {
  const store = demoStore();
  return store.records.find(record => record.owner_id === actor.id && record.purpose === selection.purpose && record.reference_id === (selection.reference_id ?? null) && record.plan === (selection.plan ?? null) && record.payment_mode === selection.payment_mode &&
    (record.purpose === 'order' || store.entitlements.some(access => access.billing_id === record.id && new Date(access.expires_at).getTime() > Date.now())));
}
function demoQuote(actor: Profile, selection: BillingSelection) {
  const state = demoState();
  if (actor.suspended || !actor.verified || !actor.college_id) throw new AppError('Verified campus access is required.', 403);
  let amount: number | undefined, kind: typeof state.listings[number]['kind'] | undefined;
  if (selection.purpose === 'order') {
    const order = state.orders.find(item => item.id === selection.reference_id && item.buyer_id === actor.id && item.college_id === actor.college_id);
    if (actor.role !== 'student' || !order || order.status !== 'accepted') throw new AppError('Choose your accepted exchange.', 403);
    amount = order.amount; kind = order.kind;
  } else if (selection.purpose === 'boost') {
    const listing = state.listings.find(item => item.id === selection.reference_id && item.owner_id === actor.id && item.college_id === actor.college_id && item.status === 'active');
    if (actor.role !== 'student' || !listing) throw new AppError('Choose your own active listing.', 403);
  } else if (actor.role !== 'business') throw new AppError('Approved business access is required.', 403);
  const existing = existingDemoRecord(actor, selection);
  if (existing) return existing.quote;
  try { return calculateBillingQuote({ ...selection, amount, kind, ...demoStore().settings }); }
  catch (error) { throw new AppError((error as Error).message, 409); }
}
function demoCreate(actor: Profile, selection: BillingSelection, quote: BillingQuote) {
  const store = demoStore();
  const existing = existingDemoRecord(actor, selection);
  if (existing) return existing;
  const now = new Date().toISOString();
  const record: BillingRecord = { id: crypto.randomUUID(), owner_id: actor.id, beneficiary_id: selection.purpose === 'order' ? demoState().orders.find(order => order.id === selection.reference_id)!.seller_id : null,
    college_id: actor.college_id!, purpose: selection.purpose, reference_id: selection.reference_id ?? null, plan: selection.plan ?? null, payment_mode: selection.payment_mode, quote,
    status: 'recorded', provider_mode: 'test', provider_order_id: null, provider_payment_id: null, refunded_amount: 0, created_at: now, expires_at: new Date(Date.now() + 900_000).toISOString(), paid_at: null };
  store.records.unshift(record);
  if (selection.purpose === 'business_plan' && selection.plan && quote.pilot_waived) {
    const starts = new Date();
    const india = new Date(starts.getTime() + 19_800_000), day = india.getUTCDate();
    india.setUTCDate(1); india.setUTCMonth(india.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth() + 1, 0)).getUTCDate();
    india.setUTCDate(Math.min(day, lastDay));
    store.entitlements.push({ id: crypto.randomUUID(), owner_id: actor.id, listing_id: null, feature: selection.plan, starts_at: starts.toISOString(),
      expires_at: new Date(india.getTime() - 19_800_000).toISOString(), billing_id: record.id, provider_mode: 'test' });
  }
  return record;
}
function demoBillingSummary(actor: Profile): BillingSummary {
  return { records: demoStore().records.filter(record => actor.role === 'admin' || record.owner_id === actor.id || record.beneficiary_id === actor.id),
    entitlements: demoStore().entitlements.filter(access => (actor.role === 'admin' || access.owner_id === actor.id) && new Date(access.expires_at).getTime() > Date.now()), settings: demoStore().settings,
    capabilities: billingCapabilities(), totals: { gross: 0, platform_fees: 0, tax: 0, seller_payable: 0, refunded: 0 }, next_cursor: null };
}
