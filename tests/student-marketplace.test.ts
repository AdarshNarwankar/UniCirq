import test from 'node:test';
import assert from 'node:assert/strict';
import { buyListings, sellListings } from '../src/lib/student-marketplace';
import { ids, seedState } from '../src/lib/seed';
import type { Listing } from '../src/lib/domain';

const base = seedState().listings[0];
const member = { id: ids.student, college_id: ids.campus };
const listing = (id: string, patch: Partial<Listing> = {}): Listing => ({ ...base, id, owner_id: ids.seller, college_id: ids.campus, kind: 'sale', status: 'active', ...patch });

test('Buy shows available sale items from other members in the selected campus only', () => {
  const rows = [listing('available'), listing('mine', { owner_id: member.id }), listing('elsewhere', { college_id: ids.otherCampus }), listing('rental', { kind: 'rental' }), listing('hardware', { kind: 'hardware' }), listing('service', { kind: 'service' }), listing('pending', { status: 'pending' }), listing('closed', { status: 'closed' }), listing('removed', { status: 'removed' })];
  assert.deepEqual(buyListings(rows, member).map(item => item.id), ['available']);
  assert.deepEqual(buyListings(rows, { ...member, college_id: null }), []);
  assert.equal(rows.length, 9, 'Discovery filtering must preserve archived records used by activity and chat');
});

test('Sell retains all statuses of owned sale listings without mixing other owners or listing types', () => {
  const owned = (id: string, patch: Partial<Listing> = {}) => listing(id, { owner_id: member.id, ...patch });
  const rows = [owned('active'), owned('pending', { status: 'pending' }), owned('closed', { status: 'closed' }), owned('removed', { status: 'removed' }), listing('someone-else'), owned('rental', { kind: 'rental' }), owned('service', { kind: 'service' }), owned('hardware', { kind: 'hardware' }), owned('old-campus', { college_id: ids.otherCampus })];
  assert.deepEqual(sellListings(rows, member).map(item => item.id), ['active', 'pending', 'closed', 'removed']);
  assert.deepEqual(sellListings(rows, { ...member, college_id: null }), []);
});
