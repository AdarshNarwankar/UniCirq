import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/lib/demo';
import { commandSchema, type Command } from '../src/lib/domain';
import { ids, seedId, seedState } from '../src/lib/seed';
import {
  indiaDateTimeInput, indiaDateTimeISO, indiaToday, rentalBoundaryLabel,
  rentalInputMin, rentalOverlaps, rentalPeriods, rentalQuote, rentalRange,
  validRentalStart, type RentalPeriod,
} from '../src/lib/rental-pricing';

const hour = 3_600_000;
const day = 24 * hour;
const iso = (time: number) => new Date(time).toISOString();
const laterDate = (value: string, days: number) => iso(Date.parse(value + 'T00:00:00Z') + days * day).slice(0, 10);
const future = () => Math.ceil((Date.now() + day) / 60_000) * 60_000;
const hourly = (start: number, duration = hour) => ({ starts_at: iso(start), ends_at: iso(start + duration) });
const dated = (days: number) => ({ starts_on: '2030-01-01', ends_on: laterDate('2030-01-01', days) });
const listingPayload = {
  type: 'create_listing' as const, title: 'Campus rental camera',
  description: 'Working camera with a carry case and its charger.', kind: 'rental' as const,
  category: 'Creative', price: 1001, condition: 'Good' as const, location: 'Main library entrance',
};

function fixture(unit: RentalPeriod = 'hour', price = 1001) {
  const state = seedState();
  const seller = state.profiles.find(profile => profile.id === ids.seller)!;
  const buyer = state.profiles.find(profile => profile.id === ids.student)!;
  const other = state.profiles.find(profile => profile.id === ids.tutor)!;
  const result = applyCommand(state, seller, { ...listingPayload, unit, price });
  const listing = state.listings.find(item => item.id === result.id)!;
  return { state, seller, buyer, other, listing };
}

test('rental pricing exposes hour, day, week and month and bills whole listed periods', () => {
  assert.deepEqual(rentalPeriods, ['hour', 'day', 'week', 'month']);
  const start = Date.parse('2030-01-01T10:00:00+05:30');
  for (const [duration, billingUnits] of [[1, 1], [hour / 2, 1], [hour, 1], [hour + 1, 2], [2 * hour, 2]]) {
    const quote = rentalQuote({ unit: 'hour', price: 1001 }, hourly(start, duration));
    assert.equal(quote?.billingUnits, billingUnits);
    assert.equal(quote?.amount, 1001 * billingUnits);
    assert.equal(quote?.durationHours, duration / hour);
  }
  for (const [unit, days, units] of [
    ['day', 1, 1], ['day', 8, 8], ['week', 1, 1], ['week', 7, 1],
    ['week', 8, 2], ['week', 30, 5], ['month', 1, 1], ['month', 29, 1], ['month', 30, 1],
  ] as const) {
    assert.deepEqual(rentalQuote({ unit, price: 1001 }, dated(days)), {
      billingUnits: units, amount: 1001 * units, durationDays: days, durationHours: days * 24,
    });
  }
});

test('rental pricing keeps free rentals valid and rejects unsafe rates and amounts', () => {
  for (const unit of rentalPeriods) {
    const selection = unit === 'hour' ? hourly(future()) : dated(1);
    assert.equal(rentalQuote({ unit, price: 0 }, selection)?.amount, 0);
  }
  for (const price of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(rentalQuote({ unit: 'day', price }, dated(1)), null);
  }
  assert.equal(rentalQuote({ unit: 'day', price: Number.MAX_SAFE_INTEGER }, dated(2)), null);
  assert.equal(rentalQuote({ unit: 'session', price: 100 }, dated(1)), null);
});

test('all rental periods keep the existing 30-day maximum without silently reducing the duration', () => {
  for (const unit of ['day', 'week', 'month']) {
    assert.ok(rentalQuote({ unit, price: 100 }, dated(30)));
    assert.equal(rentalQuote({ unit, price: 100 }, dated(31)), null);
    assert.equal(rentalQuote({ unit, price: 100 }, dated(0)), null);
  }
  const start = future();
  assert.equal(rentalQuote({ unit: 'hour', price: 100 }, hourly(start, 30 * day))?.billingUnits, 720);
  assert.equal(rentalQuote({ unit: 'hour', price: 100 }, hourly(start, 30 * day + 1)), null);
  assert.equal(rentalQuote({ unit: 'hour', price: 100 }, hourly(start, 0)), null);
  assert.equal(rentalQuote({ unit: 'hour', price: 100 }, hourly(start, -hour)), null);
});

test('India input conversion is independent of the host timezone and respects the local day boundary', () => {
  const beforeMidnight = Date.parse('2030-01-01T18:29:59Z');
  assert.equal(indiaToday(beforeMidnight), '2030-01-01');
  assert.equal(indiaToday(beforeMidnight + 1000), '2030-01-02');
  assert.equal(indiaDateTimeISO('2030-01-02T10:15'), '2030-01-02T04:45:00.000Z');
  assert.equal(indiaDateTimeISO('2030-01-02T10:15:00'), '2030-01-02T04:45:00.000Z');
  assert.equal(indiaDateTimeISO('2030-01-02T10:15:00.000'), '2030-01-02T04:45:00.000Z');
  assert.equal(indiaDateTimeISO('2030-01-02T10:15:30'), '');
  assert.equal(indiaDateTimeInput('2030-01-02T10:15:00+05:30'), '2030-01-02T10:15');
  assert.equal(indiaDateTimeInput('2030-01-02T04:45:00Z'), '2030-01-02T10:15');
  assert.equal(rentalInputMin('hour', beforeMidnight), '2030-01-02T00:00');
  assert.equal(rentalInputMin('day', beforeMidnight), '2030-01-01');
});

test('rental dates and timestamps reject malformed calendars, offsetless times and missing hourly times', () => {
  for (const value of ['2030-02-30T10:00', '2030-01-01T24:00', '2030-01-01T12:60', '2030-01-01', 'not a date']) {
    assert.equal(indiaDateTimeISO(value), '', value);
  }
  for (const value of [
    '2030-02-30T10:00:00Z', '2030-01-01T24:00:00Z', '2030-01-01T12:60:00Z',
    '2030-01-01T10:00:00', '2030-01-01T10:00:00+05:99', 'not a date',
  ]) {
    assert.equal(rentalRange({ starts_at: value, ends_at: '2030-01-03T12:00:00Z' }), null, value);
    assert.equal(indiaDateTimeInput(value), '', value);
  }
  assert.equal(rentalQuote({ unit: 'hour', price: 100 }, dated(1)), null);
  assert.equal(rentalQuote({ unit: 'week', price: 100 }, hourly(future())), null);
  for (const date of ['2030-02-30', '2030-13-01', '2030-1-01', '']) {
    assert.equal(rentalQuote({ unit: 'day', price: 100 }, { starts_on: date, ends_on: '2030-03-02' }), null);
  }
});

test('rental pickup validation rejects past instants while date-based rentals use the India calendar day', () => {
  const now = Date.parse('2030-01-01T18:30:00Z');
  assert.equal(validRentalStart(hourly(now), 'hour', now), true);
  assert.equal(validRentalStart(hourly(now - 1), 'hour', now), false);
  assert.equal(validRentalStart({ starts_on: '2030-01-01', ends_on: '2030-01-02' }, 'day', now), false);
  assert.equal(validRentalStart({ starts_on: '2030-01-02', ends_on: '2030-01-03' }, 'day', now), true);
  assert.equal(validRentalStart({}, 'hour', now), false);
});

test('rental overlaps compare instants, allow adjacent pickups and include legacy date-only reservations', () => {
  const first = { starts_at: '2030-01-01T10:00:00+05:30', ends_at: '2030-01-01T11:00:00+05:30' };
  assert.equal(rentalOverlaps(first, { starts_at: '2030-01-01T04:30:00Z', ends_at: '2030-01-01T05:30:00Z' }), true);
  assert.equal(rentalOverlaps(first, { starts_at: first.ends_at, ends_at: '2030-01-01T12:00:00+05:30' }), false);
  assert.equal(rentalOverlaps({ starts_on: '2030-01-01', ends_on: '2030-01-02' }, first), true);
  assert.deepEqual(rentalRange({ starts_on: '2030-01-01', ends_on: '2030-01-02' }), [
    Date.parse('2030-01-01T00:00:00+05:30'), Date.parse('2030-01-02T00:00:00+05:30'),
  ]);
  assert.equal(rentalOverlaps(first, { starts_on: '2030-01-02', ends_on: '2030-01-03' }), false);
  assert.equal(rentalOverlaps(first, {}), false);
});

test('rental labels retain hourly pickup and return times in India time while supporting date-only records', () => {
  const rental = { starts_at: '2030-01-01T04:30:00Z', ends_at: '2030-01-01T05:30:00Z', terms_snapshot: { unit: 'hour' } };
  assert.match(rentalBoundaryLabel(rental, 'start'), /10:00.*IST/);
  assert.match(rentalBoundaryLabel(rental, 'end'), /11:00.*IST/);
  assert.match(rentalBoundaryLabel({ ...dated(1), terms_snapshot: { unit: 'day' } }, 'start'), /1 Jan/);
  assert.equal(rentalBoundaryLabel({}, 'start'), 'Not set');
});

test('listing validation accepts every rental rate and keeps service and item pricing rules', () => {
  for (const unit of rentalPeriods) assert.equal(commandSchema.safeParse({ ...listingPayload, unit }).success, true);
  for (const unit of ['hour', 'session', 'project']) {
    assert.equal(commandSchema.safeParse({ ...listingPayload, kind: 'service', condition: 'Service', unit }).success, true);
  }
  for (const unit of ['week', 'month', 'day']) {
    assert.equal(commandSchema.safeParse({ ...listingPayload, kind: 'service', unit }).success, false);
  }
  for (const kind of ['sale', 'hardware']) {
    for (const unit of rentalPeriods) assert.equal(commandSchema.safeParse({ ...listingPayload, kind, unit }).success, false);
    assert.equal(commandSchema.safeParse({ ...listingPayload, kind, unit: 'item' }).success, true);
  }
});

test('order validation requires valid offset-qualified timestamp values and strips client pricing metadata', () => {
  const command = { type: 'create_order', listing_id: seedId(3, 3), ...hourly(future()) };
  assert.equal(commandSchema.safeParse(command).success, true);
  assert.equal(commandSchema.safeParse({ ...command, starts_at: '2030-02-30T10:00:00Z' }).success, false);
  assert.equal(commandSchema.safeParse({ ...command, starts_at: '2030-01-01T24:00:00Z' }).success, false);
  assert.equal(commandSchema.safeParse({ ...command, starts_at: '2030-01-01T10:00:00' }).success, false);
  const safe = commandSchema.parse({ ...command, amount: 1, billing_units: 0, terms_snapshot: { unit: 'free' }, buyer_id: ids.admin, seller_id: ids.admin });
  for (const key of ['amount', 'billing_units', 'terms_snapshot', 'buyer_id', 'seller_id']) assert.equal(key in safe, false);
});

test('demo hourly requests charge whole actual hours and preserve server-owned original terms', () => {
  const { state, seller, buyer, listing } = fixture();
  const selection = hourly(future(), hour + 60_000);
  const command = commandSchema.parse({ type: 'create_order', listing_id: listing.id, ...selection, amount: 1, billing_units: 1, terms_snapshot: { unit: 'day', price: 1 } });
  const result = applyCommand(state, buyer, command);
  const order = state.orders.find(item => item.id === result.id)!;
  assert.equal(order.amount, 2002);
  assert.equal(order.buyer_id, buyer.id);
  assert.equal(order.seller_id, seller.id);
  assert.equal(order.college_id, listing.college_id);
  assert.equal(order.terms_snapshot.unit, 'hour');
  assert.equal(order.terms_snapshot.price, 1001);
  assert.equal(order.terms_snapshot.billing_units, 2);
  assert.equal(order.starts_at, selection.starts_at);
  assert.equal(order.ends_at, selection.ends_at);
  assert.equal(order.starts_on, indiaToday(Date.parse(selection.starts_at)));
  const original = structuredClone(order.terms_snapshot);
  listing.price = 1; listing.unit = 'month'; listing.title = 'Edited after request';
  assert.deepEqual(order.terms_snapshot, original);
  assert.equal(order.amount, 2002);
  assert.equal(state.orderEvents.find(event => event.order_id === order.id)?.actor_id, buyer.id);
});

test('demo day, week and month requests calculate the same whole-period amounts as the preview', () => {
  for (const [unit, duration, quantity] of [['day', 2, 2], ['week', 8, 2], ['month', 30, 1]] as const) {
    const { state, buyer, listing } = fixture(unit);
    const starts_on = indiaToday(future());
    const selection = { starts_on, ends_on: laterDate(starts_on, duration) };
    const result = applyCommand(state, buyer, { type: 'create_order', listing_id: listing.id, ...selection });
    const order = state.orders.find(item => item.id === result.id)!;
    assert.equal(order.amount, 1001 * quantity);
    assert.equal(order.terms_snapshot.unit, unit);
    assert.equal(order.terms_snapshot.billing_units, quantity);
    assert.deepEqual(rentalRange(order), rentalRange(selection));
  }
});

test('demo rejects invalid hourly selections, past pickups and excessive duration before writing activity', () => {
  const { state, buyer, listing } = fixture();
  const count = state.orders.length, events = state.orderEvents.length;
  const start = future();
  const invalid = [
    {}, dated(1), hourly(start, 0), hourly(start, -hour), hourly(start, 30 * day + 1),
    hourly(Date.now() - hour), { starts_at: '2030-01-01T10:00:00', ends_at: '2030-01-01T11:00:00' },
  ];
  for (const selection of invalid) {
    assert.throws(() => applyCommand(state, buyer, { type: 'create_order', listing_id: listing.id, ...selection }), /valid rental|past/);
    assert.equal(state.orders.length, count);
    assert.equal(state.orderEvents.length, events);
  }
});

test('demo accepts only an owner decision and rechecks conflicting hourly requests at acceptance', () => {
  const { state, seller, buyer, other, listing } = fixture();
  const start = future();
  const first = applyCommand(state, buyer, { type: 'create_order', listing_id: listing.id, ...hourly(start) });
  const second = applyCommand(state, other, { type: 'create_order', listing_id: listing.id, ...hourly(start + hour / 2) });
  for (const profile of [buyer, other, state.profiles.find(item => item.id === ids.admin)!]) {
    assert.throws(() => applyCommand(state, profile, { type: 'transition_order', order_id: first.id!, status: 'accepted' }));
  }
  applyCommand(state, seller, { type: 'transition_order', order_id: first.id!, status: 'accepted' });
  assert.throws(() => applyCommand(state, seller, { type: 'transition_order', order_id: second.id!, status: 'accepted' }), /reserves/);
  assert.equal(state.orders.find(item => item.id === second.id)?.status, 'requested');
  applyCommand(state, other, { type: 'transition_order', order_id: second.id!, status: 'cancelled' });
  const adjacent = applyCommand(state, other, { type: 'create_order', listing_id: listing.id, ...hourly(start + hour) });
  applyCommand(state, seller, { type: 'transition_order', order_id: adjacent.id!, status: 'accepted' });
  assert.equal(state.orders.find(item => item.id === adjacent.id)?.status, 'accepted');
});

test('demo hourly availability includes legacy date-only rentals and cannot be bypassed with offsets', () => {
  const { state, buyer, other, seller, listing } = fixture();
  const starts_on = indiaToday(future());
  state.orders.push({
    ...state.orders[0], id: seedId(7, 901), listing_id: listing.id,
    buyer_id: other.id, seller_id: seller.id, starts_on, ends_on: laterDate(starts_on, 1),
    starts_at: null, ends_at: null, status: 'accepted',
  });
  const start = Date.parse(starts_on + 'T12:00:00+05:30');
  assert.throws(() => applyCommand(state, buyer, { type: 'create_order', listing_id: listing.id, ...hourly(start) }), /unavailable/);
  const offset = { starts_at: starts_on + 'T12:00:00+05:30', ends_at: starts_on + 'T13:00:00+05:30' };
  assert.throws(() => applyCommand(state, buyer, { type: 'create_order', listing_id: listing.id, ...offset }), /unavailable/);
});

test('hourly rentals retain student, campus, seller and duplicate-request authorization', () => {
  for (const actorId of [ids.admin, ids.business, ids.unverified, ids.outsider, ids.seller]) {
    const { state, listing } = fixture();
    const actor = state.profiles.find(profile => profile.id === actorId)!;
    const count = state.orders.length;
    assert.throws(() => applyCommand(state, actor, { type: 'create_order', listing_id: listing.id, ...hourly(future()) }));
    assert.equal(state.orders.length, count);
  }
  const { state, buyer, listing } = fixture();
  const command: Command = { type: 'create_order', listing_id: listing.id, ...hourly(future()) };
  applyCommand(state, buyer, command);
  assert.throws(() => applyCommand(state, buyer, command), /active request/);
});

test('service hourly bookings still charge one listed unit and discard irrelevant rental dates and times', () => {
  const { state, seller, buyer } = fixture();
  const created = applyCommand(state, seller, { ...listingPayload, kind: 'service', unit: 'hour', condition: 'Service' });
  const result = applyCommand(state, buyer, { type: 'create_order', listing_id: created.id!, ...hourly(future(), 3 * hour), ...dated(3) });
  const order = state.orders.find(item => item.id === result.id)!;
  assert.equal(order.amount, 1001);
  assert.equal(order.terms_snapshot.unit, 'hour');
  assert.equal(order.terms_snapshot.billing_units, undefined);
  for (const key of ['starts_on', 'ends_on', 'starts_at', 'ends_at'] as const) assert.equal(order[key], null);
});
