import { DateTime } from 'luxon';
import { addDays, periodFor, type Scale } from '../schedule/period';
import { isoToWall } from '../schedule/tz';
import type { MyShift, OpenShiftsPayload } from '../types';

/** The server answers at most this many days per request (MAX_RANGE_DAYS). */
export const MAX_REQUEST_DAYS = 62;

export type EventKind = 'mine' | 'open' | 'switch';
export interface CalendarEvent { id: string; kind: EventKind; shift: MyShift; ownerName?: string }

/** Every day a month's grid shows: whole weeks, Monday first, so 28 to 42 days. */
export function monthGrid(anchor: string): string[] {
  const month = periodFor('month', anchor);
  const from = periodFor('week', month.from).from;
  const to = periodFor('week', month.to).to;
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The dates a view has to load. A month includes the neighbouring days its grid shows. */
export function visibleRange(scale: Scale, anchor: string): { from: string; to: string } {
  if (scale === 'month') {
    const days = monthGrid(anchor);
    return { from: days[0]!, to: days[days.length - 1]! };
  }
  const { from, to } = periodFor(scale, anchor);
  return { from, to };
}

/** Splits a range into pieces the server accepts, so Year can be loaded in several requests. */
export function chunkRange(from: string, to: string, size = MAX_REQUEST_DAYS): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  for (let start = from; start <= to; start = addDays(start, size)) {
    const end = addDays(start, size - 1);
    chunks.push({ from: start, to: end < to ? end : to });
  }
  return chunks;
}

export function eventsFrom(mine: MyShift[], available: OpenShiftsPayload | null): CalendarEvent[] {
  return [
    ...mine.map((shift): CalendarEvent => ({ id: shift.id, kind: 'mine', shift })),
    ...(available?.open ?? []).map((shift): CalendarEvent => ({ id: shift.id, kind: 'open', shift })),
    ...(available?.up_for_switch ?? []).map((shift): CalendarEvent => ({ id: shift.id, kind: 'switch', shift, ownerName: shift.owner_name })),
  ];
}

/** Events listed under the local day they start, earliest first. */
export function eventsStartingOn(events: CalendarEvent[], date: string, zone: string): CalendarEvent[] {
  return events
    .filter((e) => isoToWall(e.shift.start_at, zone).date === date)
    .sort((a, b) => Date.parse(a.shift.start_at) - Date.parse(b.shift.start_at));
}

export interface PlacedEvent {
  event: CalendarEvent;
  /** Percentages of the day column. */
  top: number;
  height: number;
  /** Side by side when events overlap: which slot, out of how many. */
  column: number;
  columns: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Where each event sits in one day's column. An overnight shift appears on both days, clipped at midnight. */
export function placeOnDay(events: CalendarEvent[], date: string, zone: string): PlacedEvent[] {
  const dayStart = DateTime.fromISO(date, { zone }).startOf('day').toMillis();
  const dayEnd = DateTime.fromISO(date, { zone }).plus({ days: 1 }).startOf('day').toMillis();
  const length = dayEnd - dayStart;
  const clipped = events
    .map((event) => ({ event, start: Date.parse(event.shift.start_at), end: Date.parse(event.shift.end_at) }))
    .filter((e) => e.end > dayStart && e.start < dayEnd)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: PlacedEvent[] = [];
  let cluster: { item: (typeof clipped)[number]; column: number }[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    const columns = Math.max(0, ...cluster.map((c) => c.column)) + 1;
    for (const { item, column } of cluster) {
      const start = Math.max(item.start, dayStart);
      const end = Math.min(item.end, dayEnd);
      placed.push({
        event: item.event, column, columns,
        top: ((start - dayStart) / length) * 100,
        height: ((end - start) / length) * 100,
        continuesBefore: item.start < dayStart,
        continuesAfter: item.end > dayEnd,
      });
    }
    cluster = [];
  };
  for (const item of clipped) {
    if (cluster.length > 0 && item.start >= clusterEnd) {
      flush();
      clusterEnd = Number.NEGATIVE_INFINITY;
    }
    const taken = new Set(cluster.filter((c) => c.item.end > item.start).map((c) => c.column));
    let column = 0;
    while (taken.has(column)) column++;
    cluster.push({ item, column });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return placed;
}

/** Worked hours per local day, for Year's shading and the period total. */
export function hoursByDay(shifts: MyShift[], zone: string): Map<string, number> {
  const hours = new Map<string, number>();
  for (const s of shifts) {
    const date = isoToWall(s.start_at, zone).date;
    hours.set(date, (hours.get(date) ?? 0) + s.allocated_hours);
  }
  return hours;
}

/** My shifts that start inside a period: what the summary counts, ignoring the neighbouring days a month grid shows. */
export function summarise(shifts: MyShift[], from: string, to: string, zone: string): { count: number; hours: number } {
  const inside = shifts.filter((s) => {
    const date = isoToWall(s.start_at, zone).date;
    return date >= from && date <= to;
  });
  return { count: inside.length, hours: inside.reduce((sum, s) => sum + s.allocated_hours, 0) };
}

/** The hour a time grid first scrolls to: an hour before the earliest shift, or the start of a usual working day. */
export function firstVisibleHour(events: CalendarEvent[], days: string[], zone: string): number {
  const hours = events
    .filter((e) => days.includes(isoToWall(e.shift.start_at, zone).date))
    .map((e) => Number(isoToWall(e.shift.start_at, zone).time.slice(0, 2)));
  return hours.length > 0 ? Math.max(0, Math.min(...hours) - 1) : 7;
}

/** The view a key chooses, as in Google Calendar: D, W, M, Y. */
export function scaleForKey(key: string): Scale | null {
  return ({ d: 'day', w: 'week', m: 'month', y: 'year' } as Record<string, Scale>)[key.toLowerCase()] ?? null;
}
