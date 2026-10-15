import { DateTime, IANAZone } from 'luxon';

/** API format: 2026-10-13T09:00:00Z */
export function iso(value: Date | number): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Epoch ms of local midnight at the start of `date` (YYYY-MM-DD) in `zone`. */
export function localMidnight(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).startOf('day').toMillis();
}

export function localDate(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toISODate()!;
}

export function isTimezone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

/** The calendar date after `date` (both YYYY-MM-DD). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
