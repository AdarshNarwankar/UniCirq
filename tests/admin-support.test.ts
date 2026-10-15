import test from 'node:test';
import assert from 'node:assert/strict';
import { supportCases, supportCaseContext, supportStatusFilter, supportTypeFilter } from '../src/lib/admin-support';
import { seedState, ids } from '../src/lib/seed';
import type { Snapshot, Ticket } from '../src/lib/domain';

const state = seedState();
const now = Date.parse('2026-10-15T12:00:00Z');
const at = '2026-10-15T11:00:00Z';
function ticket(id: string, patch: Partial<Ticket> = {}): Ticket {
  return { ...state.tickets[0], id, college_id: ids.campus, subject: 'Broken calculator', body: 'The screen does not turn on.', type: 'support', status: 'open', created_at: at, order_id: null, listing_id: null, ...patch };
}
const filters = { campus: 'all', days: 'all', search: '', query: '', type: 'all' as const, status: 'all' as const };
function snapshot(tickets: Ticket[]): Snapshot { return { ...state, tickets, user: state.profiles.find(item => item.role === 'admin')!, demo: true }; }

test('support list respects campus, submission date, status and case type together', () => {
  const data = snapshot([ticket('wanted', { type: 'dispute' }), ticket('resolved', { type: 'dispute', status: 'resolved' }), ticket('support'), ticket('other', { type: 'dispute', college_id: ids.otherCampus }), ticket('old', { type: 'dispute', created_at: '2026-10-01T12:00:00Z' })]);
  const result = supportCases(data, { ...filters, campus: ids.campus, days: '7', type: 'dispute', status: 'open' }, now);
  assert.deepEqual(result.records.map(item => item.id), ['wanted']);
  assert.equal(result.scoped.length, 3);
});

test('support search combines the topbar and local search without losing either', () => {
  const data = snapshot([ticket('wanted'), ticket('other', { body: 'Missing parts only.' })]);
  assert.deepEqual(supportCases(data, { ...filters, search: 'calculator', query: 'screen' }, now).records.map(item => item.id), ['wanted']);
  assert.equal(supportCases(data, { ...filters, search: 'calculator', query: 'unrelated' }, now).records.length, 0);
});

test('support detail uses stored order terms and matching history, without unrelated events', () => {
  const order = state.orders[0];
  const data = snapshot([ticket('case', { order_id: order.id })]);
  data.audit = [{ id: 'decision', actor_id: data.user.id, target_id: 'case', action: 'ticket.resolve', reason: 'Response recorded', created_at: at }, { id: 'unrelated', actor_id: data.user.id, target_id: 'case', action: 'listing.remove', reason: 'Different entity', created_at: at }];
  const context = supportCaseContext(data, data.tickets[0]);
  assert.equal(context.order?.terms_snapshot.title, order.terms_snapshot.title);
  assert.equal(context.listing?.id, order.listing_id);
  assert.deepEqual(context.reviews.map(item => item.id), ['decision']);
  assert.ok(context.events.every(item => item.order_id === order.id));
  assert.equal('messages' in context, false);
});

test('invalid URL filters fall back to all and resolved cases remain available by default', () => {
  assert.equal(supportTypeFilter('unknown'), 'all');
  assert.equal(supportTypeFilter('report'), 'report');
  assert.equal(supportStatusFilter('closed'), 'all');
  assert.equal(supportStatusFilter('resolved'), 'resolved');
  assert.equal(supportCases(snapshot([ticket('resolved', { status: 'resolved' })]), filters, now).records.length, 1);
});
