import { DateTime } from 'luxon';
import { localDate } from '../support/time';
import { Interval } from './interval';

/** Local date (YYYY-MM-DD) -> the part of `interval` that falls on it. */
export function splitByLocalDay(interval: Interval, zone: string): Map<string, Interval> {
  const out = new Map<string, Interval>();
  let cursor = interval.start;
  while (cursor < interval.end) {
    const nextMidnight = DateTime.fromMillis(cursor, { zone }).startOf('day').plus({ days: 1 }).toMillis();
    const pieceEnd = Math.min(nextMidnight, interval.end);
    out.set(localDate(cursor, zone), new Interval(cursor, pieceEnd));
    cursor = pieceEnd;
  }
  return out;
}
