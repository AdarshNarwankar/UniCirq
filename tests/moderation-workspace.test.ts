import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModerationWorkspace, moderationAttention, moderationDecisions } from '../src/lib/moderation-workspace';
import { seedState, ids } from '../src/lib/seed';
import type { Deal, Listing, Snapshot, State, Ticket } from '../src/lib/domain';

const seed = seedState();
const now = Date.parse('2026-10-15T06:30:00Z');
const instant = new Date(now).toISOString();
function snapshot(patch: Partial<State> = {}): Snapshot {
  return { ...seed, user: seed.profiles.find(profile => profile.role === 'admin')!, demo: true, listings: [], deals: [], tickets: [], ...patch };
}
function listing(id: string, patch: Partial<Listing> = {}): Listing { return { ...seed.listings[0], id, created_at: instant, status: 'active', ...patch }; }
function deal(id: string, patch: Partial<Deal> = {}): Deal { return { ...seed.deals[0], id, created_at: instant, status: 'pending', ...patch }; }
function report(id: string, listing_id: string | null, patch: Partial<Ticket> = {}): Ticket { return { ...seed.tickets[0], id, listing_id, type: 'report', status: 'open', created_at: instant, ...patch }; }

test('default queue includes pending submissions and reported listings once, without arbitrary active inventory', () => {
  const data = snapshot({ listings: [listing('normal'), listing('pending', { status: 'pending' }), listing('reported'), listing('removed-reported', { status: 'removed' })], deals: [deal('new-offer'), deal('old-offer', { status: 'active' })], tickets: [report('a', 'reported'), report('b', 'reported'), report('c', 'pending'), report('d', 'removed-reported')] });
  const attention = moderationAttention(data);
  assert.equal(attention.count, 4);
  assert.deepEqual(attention.listings.map(item => item.id), ['pending', 'reported', 'removed-reported']);
  assert.deepEqual(attention.deals.map(item => item.id), ['new-offer']);
  const result = buildModerationWorkspace(data, { campus: 'all', days: 'all' }, now);
  assert.deepEqual(new Set(result.records.map(item => item.id)), new Set(['pending', 'reported', 'removed-reported', 'new-offer']));
  assert.equal(result.records.find(item => item.id === 'reported')?.openReports, 2);
  assert.equal(result.attentionCount, 4);
  assert.equal(result.pendingListingCount, 1);
  assert.equal(result.pendingDealCount, 1);
  assert.equal(result.reportedListingCount, 3);
});

test('a current open report brings an older listing into the selected date window', () => {
  const data = snapshot({ listings: [listing('reported-old', { created_at: '2026-01-01T00:00:00Z' }), listing('old-pending', { status: 'pending', created_at: '2026-01-01T00:00:00Z' })], tickets: [report('new-report', 'reported-old')] });
  const result = buildModerationWorkspace(data, { campus: 'all', days: '7' }, now);
  assert.deepEqual(result.records.map(item => item.id), ['reported-old']);
  assert.equal(result.records[0].latestReportAt, instant);
  assert.equal(result.records[0].activityAt, instant);
});

test('resolved reports and unlinked support tickets do not inflate queue attention', () => {
  const data = snapshot({ listings: [listing('not-reported')], tickets: [report('resolved', 'not-reported', { status: 'resolved' }), report('support', 'not-reported', { type: 'support' }), report('no-listing', null), report('missing-listing', 'missing')] });
  assert.equal(moderationAttention(data).count, 0);
  assert.equal(buildModerationWorkspace(data, { campus: 'all', days: 'all' }, now).attentionCount, 0);
});

test('campus, kind and independent global/local searches combine without mutating records', () => {
  const data = snapshot({ listings: [listing('target', { status: 'pending', title: 'Blue Arduino starter kit', description: 'Components for campus robotics', kind: 'hardware' }), listing('other-campus', { status: 'pending', title: 'Blue Arduino starter kit', description: 'Components for campus robotics', kind: 'hardware', college_id: ids.otherCampus })], deals: [deal('deal', { title: 'Blue Arduino offer', description: 'Components for campus robotics' })] });
  const before = JSON.stringify(data);
  const result = buildModerationWorkspace(data, { campus: ids.campus, days: 'all', kind: 'listing', globalSearch: 'Arduino', query: 'robotics' }, now);
  assert.deepEqual(result.records.map(item => item.id), ['target']);
  assert.equal(JSON.stringify(data), before);
  assert.equal(buildModerationWorkspace(data, { campus: ids.campus, days: 'all', kind: 'deal', query: 'Arduino' }, now).records[0].entity, 'deal');
  assert.equal(buildModerationWorkspace(data, { campus: 'all', days: 'all', globalSearch: 'Arduino', query: 'missing' }, now).records.length, 0);
});

test('all-record catalogue and explicit status filters expose history without changing the default queue', () => {
  const data = snapshot({ listings: [listing('active'), listing('closed', { status: 'closed' }), listing('removed', { status: 'removed' })], deals: [deal('offer', { status: 'active' })] });
  assert.equal(buildModerationWorkspace(data, { campus: 'all', days: 'all' }, now).records.length, 0);
  assert.equal(buildModerationWorkspace(data, { campus: 'all', days: 'all', status: 'all' }, now).records.length, 4);
  assert.deepEqual(buildModerationWorkspace(data, { campus: 'all', days: 'all', status: 'closed' }, now).records.map(item => item.id), ['closed']);
  assert.equal(buildModerationWorkspace(data, { campus: 'all', days: 'all', status: 'active' }, now).records.length, 2);
});

test('seven-day window uses India calendar midnight and excludes future or missing-zone timestamps', () => {
  const data = snapshot({ listings: [listing('before', { status: 'pending', created_at: '2026-10-08T18:29:59Z' }), listing('boundary', { status: 'pending', created_at: '2026-10-08T18:30:00Z' }), listing('future', { status: 'pending', created_at: '2026-11-01T00:00:00Z' }), listing('no-zone', { status: 'pending', created_at: '2026-10-15T06:30:00' })] });
  assert.deepEqual(buildModerationWorkspace(data, { campus: 'all', days: '7' }, now).records.map(item => item.id), ['boundary']);
});

test('a future or resolved report cannot pull old content into the current queue window', () => {
  const data = snapshot({ listings: [listing('old', { created_at: '2026-01-01T00:00:00Z' })], tickets: [report('future', 'old', { created_at: '2026-11-01T00:00:00Z' }), report('resolved', 'old', { status: 'resolved' })] });
  assert.equal(buildModerationWorkspace(data, { campus: 'all', days: '7' }, now).records.length, 0);
});

test('review actions reflect state and expiry; removed and closed records remain read-only', () => {
  assert.deepEqual(moderationDecisions('pending'), ['approve', 'remove']);
  assert.deepEqual(moderationDecisions('pending', true), ['remove']);
  assert.deepEqual(moderationDecisions('active'), ['remove']);
  assert.deepEqual(moderationDecisions('removed'), []);
  assert.deepEqual(moderationDecisions('closed'), []);
});
