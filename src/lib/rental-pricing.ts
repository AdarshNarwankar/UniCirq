export const rentalPeriods = ['hour', 'day', 'week', 'month'] as const;
export type RentalPeriod = typeof rentalPeriods[number];
export type RentalSelection = { starts_on?: string; ends_on?: string; starts_at?: string; ends_at?: string };
type RentalRange = { starts_on?: string | null; ends_on?: string | null; starts_at?: string | null; ends_at?: string | null };
const dayMs = 86_400_000;
const hourMs = 3_600_000;
const indiaOffsetMs = 19_800_000;
const zonedTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function instant(value?: string | null): number | null {
  if (!value || !zonedTimestamp.test(value) || !calendarDate(value.slice(0, 10))) return null;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || value[16] === ':' && Number(value.slice(17, 19)) > 59) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function indiaToday(now = Date.now()): string {
  return new Date(now + indiaOffsetMs).toISOString().slice(0, 10);
}

export function indiaDateTimeInput(iso: string): string {
  const time = instant(iso);
  return time === null ? '' : new Date(time + indiaOffsetMs).toISOString().slice(0, 16);
}

export function indiaDateTimeISO(value: string): string {
  // Native datetime-local controls can serialize zero seconds and milliseconds
  // even when their visible precision and step are one minute.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.0{1,3})?)?$/.test(value) || !calendarDate(value.slice(0, 10))) return '';
  const minute = value.slice(0, 16);
  const time = instant(minute + ':00+05:30');
  if (time === null) return '';
  const iso = new Date(time).toISOString();
  return indiaDateTimeInput(iso) === minute ? iso : '';
}

export function rentalInputMin(unit: string, now = Date.now()): string {
  return unit === 'hour' ? new Date(Math.ceil(now / 60_000) * 60_000 + indiaOffsetMs).toISOString().slice(0, 16) : indiaToday(now);
}

// Legacy date-only rentals occupy the same IST-midnight interval as new ones.
export function rentalRange(selection: RentalRange): [number, number] | null {
  const boundary = (timestamp?: string | null, date?: string | null) => timestamp
    ? instant(timestamp)
    : date && calendarDate(date) ? Date.parse(date + 'T00:00:00+05:30') : null;
  const start = boundary(selection.starts_at, selection.starts_on);
  const end = boundary(selection.ends_at, selection.ends_on);
  return start === null || end === null || end <= start ? null : [start, end];
}

export function rentalQuote(listing: { unit: string; price: number }, selection: RentalSelection) {
  if (!rentalPeriods.includes(listing.unit as RentalPeriod) || !Number.isSafeInteger(listing.price) || listing.price < 0) return null;
  const range = rentalRange(listing.unit === 'hour'
    ? { starts_at: selection.starts_at, ends_at: selection.ends_at }
    : { starts_on: selection.starts_on, ends_on: selection.ends_on });
  if (!range || range[1] - range[0] > 30 * dayMs) return null;
  const duration = range[1] - range[0];
  const period = listing.unit === 'hour' ? hourMs : listing.unit === 'week' ? 7 * dayMs : listing.unit === 'month' ? 30 * dayMs : dayMs;
  const billingUnits = Math.ceil(duration / period);
  const amount = billingUnits * listing.price;
  return Number.isSafeInteger(amount) ? { billingUnits, amount, durationDays: duration / dayMs, durationHours: duration / hourMs } : null;
}

export function validRentalStart(selection: RentalSelection, unit: string, now = Date.now()): boolean {
  if (unit === 'hour') {
    const range = rentalRange({ starts_at: selection.starts_at, ends_at: selection.ends_at });
    return Boolean(range && range[0] >= now);
  }
  return Boolean(selection.starts_on && calendarDate(selection.starts_on) && selection.starts_on >= indiaToday(now));
}

export function rentalOverlaps(a: RentalRange, b: RentalRange): boolean {
  const first = rentalRange(a), second = rentalRange(b);
  return Boolean(first && second && first[0] < second[1] && first[1] > second[0]);
}

export function rentalBoundaryLabel(order: RentalRange & { terms_snapshot?: { unit: string } }, boundary: 'start' | 'end'): string {
  const timestamp = boundary === 'start' ? order.starts_at : order.ends_at;
  const date = boundary === 'start' ? order.starts_on : order.ends_on;
  const hourly = order.terms_snapshot?.unit === 'hour';
  const time = hourly ? instant(timestamp) : date && calendarDate(date) ? Date.parse(date + 'T12:00:00+05:30') : null;
  return time === null ? 'Not set' : new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    ...(hourly ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(time)) + (hourly ? ' IST' : '');
}
