import { z } from 'zod';
import { billingGroupSelectionSchema, billingSelectionSchema } from '@/lib/billing';
import { requireApiUser } from '@/lib/server/auth';
import { body, checkOrigin, failure, json } from '@/lib/server/http';
import { billingFailure, billingGroupQuote, billingQuote, billingSummary, configureBilling, createBilling, createBillingGroup, resumeBilling, limitBilling, submitManualUtr, reviewManualUtr } from '@/lib/server/billing';

export const runtime = 'nodejs';
const actionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('quote'), selection: billingSelectionSchema }),
  z.strictObject({ action: z.literal('group_quote'), selection: billingGroupSelectionSchema }),
  z.strictObject({ action: z.literal('create'), selection: billingSelectionSchema }),
  z.strictObject({ action: z.literal('group_create'), selection: billingGroupSelectionSchema }),
  z.strictObject({ action: z.literal('resume'), billing_id: z.string().uuid() }),
  z.strictObject({ action: z.literal('settings'), settings: z.strictObject({ tax_bps: z.number().int().min(0).max(10000).nullable(), business_pilot: z.boolean(), reason: z.string().trim().min(5).max(500) }) }),
  z.strictObject({ action: z.literal('manual_submit'), billing_id: z.string().uuid(), utr: z.string().trim().regex(/^[A-Za-z0-9]{8,40}$/) }),
  z.strictObject({ action: z.literal('manual_review'), billing_id: z.string().uuid(), decision: z.enum(['approve', 'reject']), note: z.string().trim().min(5).max(500) }),
]);
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    await limitBilling(user.id, 60);
    return json(await billingSummary(user, new URL(request.url).searchParams.get('cursor') ?? undefined));
  } catch (error) { return failure(billingFailure(error)); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireApiUser();
    await limitBilling(user.id);
    const input = actionSchema.parse(await body(request));
    if (input.action === 'settings') return json({ settings: await configureBilling(user, input.settings) });
    if (input.action === 'manual_submit') return json({ record: await submitManualUtr(user, input.billing_id, input.utr) });
    if (input.action === 'manual_review') return json({ record: await reviewManualUtr(user, input.billing_id, input.decision, input.note) });
    if (input.action === 'resume') return json(await resumeBilling(user, input.billing_id));
    if (input.action === 'group_quote') return json({ quote: await billingGroupQuote(user, input.selection) });
    if (input.action === 'group_create') return json(await createBillingGroup(user, input.selection));
    if (input.action === 'quote') return json({ quote: await billingQuote(user, input.selection) });
    return json(await createBilling(user, input.selection));
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Choose a valid billing option. Amounts are calculated by UniCirq.' }, 400);
    return failure(billingFailure(error));
  }
}
