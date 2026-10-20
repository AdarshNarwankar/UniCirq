import test from 'node:test';
import assert from 'node:assert/strict';
import { buyListings, sellListings } from '../src/lib/student-marketplace';
import { ids, seedState } from '../src/lib/seed';
import type { Listing } from '../src/lib/domain';
import { applyCommand, snapshotFor } from '../src/lib/demo';

const base = seedState().listings[0];
const member = { id: ids.student, college_id: ids.campus };
const listing = (id: string, patch: Partial<Listing> = {}): Listing => ({ ...base, id, owner_id: ids.seller, college_id: ids.campus, kind: 'sale', status: 'active', ...patch });

test('Buy shows active sale items in the selected campus, including the member’s own published items', () => {
  const rows = [listing('available'), listing('mine', { owner_id: member.id }), listing('elsewhere', { college_id: ids.otherCampus }), listing('rental', { kind: 'rental' }), listing('hardware', { kind: 'hardware' }), listing('service', { kind: 'service' }), listing('pending', { status: 'pending' }), listing('closed', { status: 'closed' }), listing('removed', { status: 'removed' })];
  assert.deepEqual(buyListings(rows, member).map(item => item.id), ['available', 'mine']);
  assert.deepEqual(buyListings(rows, { ...member, college_id: null }), []);
  assert.equal(rows.length, 9, 'Discovery filtering must preserve archived records used by activity and chat');
});

test('a newly published sale appears in Sell and Buy, can be requested by another campus member, and cannot be self-purchased', () => {
  const state = seedState();
  const owner = state.profiles.find(profile => profile.id === ids.student)!;
  const buyer = state.profiles.find(profile => profile.id === ids.seller)!;
  const result = applyCommand(state, owner, {
    type: 'create_listing', title: 'Campus visibility regression book', description: 'A book listed for sale to other students on the same campus.',
    kind: 'sale', category: 'Books & notes', price: 12000, unit: 'item', condition: 'Good', location: 'Main library entrance',
  });
  assert.ok(result.id);
  const ownerSnapshot = snapshotFor(state, owner);
  const buyerSnapshot = snapshotFor(state, buyer);
  assert.ok(sellListings(ownerSnapshot.listings, owner).some(listing => listing.id === result.id));
  for (const snapshot of [ownerSnapshot, buyerSnapshot]) {
    assert.ok(buyListings(snapshot.listings, snapshot.user).some(listing => listing.id === result.id));
  }
  assert.throws(() => applyCommand(state, owner, { type: 'create_order', listing_id: result.id! }), /own listing/);
  const request = applyCommand(state, buyer, { type: 'create_order', listing_id: result.id });
  assert.equal(state.orders.find(order => order.id === request.id)?.seller_id, owner.id);
  applyCommand(state, owner, { type: 'close_listing', listing_id: result.id });
  assert.ok(sellListings(state.listings, owner).some(listing => listing.id === result.id));
  assert.ok(!buyListings(state.listings, owner).some(listing => listing.id === result.id));
  assert.ok(!buyListings(state.listings, buyer).some(listing => listing.id === result.id));
});

test('Sell retains all statuses of owned sale listings without mixing other owners or listing types', () => {
  const owned = (id: string, patch: Partial<Listing> = {}) => listing(id, { owner_id: member.id, ...patch });
  const rows = [owned('active'), owned('pending', { status: 'pending' }), owned('closed', { status: 'closed' }), owned('removed', { status: 'removed' }), listing('someone-else'), owned('rental', { kind: 'rental' }), owned('service', { kind: 'service' }), owned('hardware', { kind: 'hardware' }), owned('old-campus', { college_id: ids.otherCampus })];
  assert.deepEqual(sellListings(rows, member).map(item => item.id), ['active', 'pending', 'closed', 'removed']);
  assert.deepEqual(sellListings(rows, { ...member, college_id: null }), []);
});
