import { DateTime } from 'luxon';
import type { Weekday, WorkingHoursMap } from '../db/schema';
import { Interval } from './interval';

export const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export class WorkingHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkingHoursError';
  }
}

const validTime = (t: unknown): t is string => typeof t === 'string' && (t === '24:00' || /^([01]\d|2[0-3]):[0-5]\d$/.test(t));

/** FR-CFG-02: an employee's regular weekly schedule, in local wall-clock time. */
export function parseWorkingHours(data: unknown): WorkingHoursMap {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new WorkingHoursError('Give an object keyed by weekday (mon to sun).');
  const hours = Object.fromEntries(DAYS.map((d) => [d, [] as [string, string][]])) as WorkingHoursMap;
  for (const [day, ranges] of Object.entries(data)) {
    if (!DAYS.includes(day as Weekday)) throw new WorkingHoursError(`Unknown weekday "${day}"; use mon to sun.`);
    if (!Array.isArray(ranges)) throw new WorkingHoursError(`${day}: give a list of [from, to] pairs.`);
    const clean: [string, string][] = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2 || !validTime(range[0]) || !validTime(range[1])) {
        throw new WorkingHoursError(`${day}: each range is ["HH:MM", "HH:MM"] between 00:00 and 24:00.`);
      }
      if (range[0] >= range[1]) throw new WorkingHoursError(`${day}: ${range[0]}-${range[1]} must end after it starts.`);
      clean.push([range[0], range[1]]);
    }
    clean.sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 1; i < clean.length; i++) {
      if (clean[i][0] < clean[i - 1][1]) throw new WorkingHoursError(`${day}: ranges overlap.`);
    }
    hours[day as Weekday] = clean;
  }
  return hours;
}

function at(localMidnight: DateTime, hhmm: string): number {
  if (hhmm === '24:00') return localMidnight.plus({ days: 1 }).toMillis();
  const [hour, minute] = hhmm.split(':').map(Number);
  return localMidnight.set({ hour, minute }).toMillis();
}

/** Working time inside [fromMs, toMs), as intervals. Luxon handles daylight-saving days. */
export function workingIntervals(hours: WorkingHoursMap, fromMs: number, toMs: number, zone: string): Interval[] {
  const range = new Interval(fromMs, toMs);
  const out: Interval[] = [];
  const end = DateTime.fromMillis(toMs, { zone });
  for (let day = DateTime.fromMillis(fromMs, { zone }).startOf('day'); day < end; day = day.plus({ days: 1 }).startOf('day')) {
    for (const [from, to] of hours[DAYS[day.weekday - 1]]) {
      const start = at(day, from);
      const stop = at(day, to);
      if (stop <= start) continue; // the range sits in a daylight-saving gap
      const piece = new Interval(start, stop).intersect(range);
      if (piece) out.push(piece);
    }
  }
  return out;
}
