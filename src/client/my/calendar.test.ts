import { describe, expect, it } from 'vitest';
import type { MyShift } from '../types';
import { type CalendarEvent, chunkRange, eventsFrom, eventsStartingOn, firstVisibleHour, hoursByDay, MAX_REQUEST_DAYS, monthGrid, placeOnDay, scaleForKey, summarise, visibleRange } from './calendar';

const ZONE = 'Asia/Kuala_Lumpur'; // UTC+8, no daylight saving
const shift = (id: string, start: string, end: string, hours = 8): MyShift => ({ id, role_id: null, start_at: start, end_at: end, break_minutes: 0, allocated_hours: hours, note: null, switch_requested: false });
const event = (id: string, start: string, end: string): CalendarEvent => ({ id, kind: 'mine', shift: shift(id, start, end) });

describe('monthGrid', () => {
  it('shows whole weeks, Monday first, around the month', () => {
    const days = monthGrid('2026-11-15');
    expect(days[0]).toBe('2026-10-26');
    expect(days[days.length - 1]).toBe('2026-12-06');
    expect(days).toHaveLength(42);
  });

  it('needs only four weeks for a February that starts on a Monday', () => {
    expect(monthGrid('2027-02-10')).toHaveLength(28);
  });

  it('never needs more days than one request allows', () => {
    for (let m = 1; m <= 12; m++) expect(monthGrid(`2026-${String(m).padStart(2, '0')}-01`).length).toBeLessThanOrEqual(MAX_REQUEST_DAYS);
  });
});

describe('visibleRange', () => {
  it('loads what each view shows', () => {
    expect(visibleRange('day', '2026-11-05')).toEqual({ from: '2026-11-05', to: '2026-11-05' });
    expect(visibleRange('week', '2026-11-05')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(visibleRange('month', '2026-11-05')).toEqual({ from: '2026-10-26', to: '2026-12-06' });
    expect(visibleRange('year', '2026-11-05')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('chunkRange', () => {
  it('covers a whole year, with no gaps, overlaps or piece over the limit', () => {
    const chunks = chunkRange('2026-01-01', '2026-12-31');
    expect(chunks[0]!.from).toBe('2026-01-01');
    expect(chunks[chunks.length - 1]!.to).toBe('2026-12-31');
    for (const [i, c] of chunks.entries()) {
      expect((Date.parse(c.to) - Date.parse(c.from)) / 86_400_000 + 1).toBeLessThanOrEqual(MAX_REQUEST_DAYS);
      if (i > 0) expect((Date.parse(c.from) - Date.parse(chunks[i - 1]!.to)) / 86_400_000).toBe(1);
    }
  });

  it('leaves a short range whole', () => {
    expect(chunkRange('2026-11-02', '2026-11-08')).toEqual([{ from: '2026-11-02', to: '2026-11-08' }]);
  });
});

describe('placeOnDay', () => {
  it('positions a shift by its local time', () => {
    // 09:00 to 18:00 in Kuala Lumpur
    const [p] = placeOnDay([event('a', '2026-11-05T01:00:00Z', '2026-11-05T10:00:00Z')], '2026-11-05', ZONE);
    expect(p).toMatchObject({ top: 37.5, height: 37.5, column: 0, columns: 1, continuesBefore: false, continuesAfter: false });
  });

  it('shows an overnight shift on both days, clipped at midnight', () => {
    // 22:00 to 06:00
    const overnight = event('n', '2026-11-05T14:00:00Z', '2026-11-05T22:00:00Z');
    const [first] = placeOnDay([overnight], '2026-11-05', ZONE);
    const [second] = placeOnDay([overnight], '2026-11-06', ZONE);
    expect(first).toMatchObject({ continuesAfter: true, continuesBefore: false });
    expect(first!.top + first!.height).toBeCloseTo(100);
    expect(second).toMatchObject({ top: 0, continuesBefore: true, continuesAfter: false, height: 25 });
  });

  it('leaves out a day the shift does not touch', () => {
    expect(placeOnDay([event('a', '2026-11-05T01:00:00Z', '2026-11-05T10:00:00Z')], '2026-11-06', ZONE)).toEqual([]);
  });

  it('puts overlapping shifts side by side and shifts that merely touch in one column', () => {
    const placed = placeOnDay([
      event('a', '2026-11-05T01:00:00Z', '2026-11-05T05:00:00Z'), // 09:00-13:00
      event('b', '2026-11-05T03:00:00Z', '2026-11-05T07:00:00Z'), // 11:00-15:00
      event('c', '2026-11-05T07:00:00Z', '2026-11-05T09:00:00Z'), // 15:00-17:00, starts as b ends
    ], '2026-11-05', ZONE);
    const by = (id: string) => placed.find((p) => p.event.id === id)!;
    expect(by('a')).toMatchObject({ column: 0, columns: 2 });
    expect(by('b')).toMatchObject({ column: 1, columns: 2 });
    expect(by('c')).toMatchObject({ column: 0, columns: 1 });
  });

  it('handles the day clocks change without drifting', () => {
    // New York, clocks go back on 1 Nov 2026, so the day has 25 hours. 09:00 local is 13:00 UTC... after the change, 14:00 UTC.
    const [p] = placeOnDay([event('a', '2026-11-01T14:00:00Z', '2026-11-01T15:00:00Z')], '2026-11-01', 'America/New_York');
    expect(p!.height).toBeCloseTo(100 / 25);
    expect(p!.top).toBeCloseTo((10 / 25) * 100);
  });
});

describe('grouping and totals', () => {
  it('lists events under the local day they start, in order', () => {
    const late = event('late', '2026-11-05T16:30:00Z', '2026-11-05T20:00:00Z'); // 00:30 on the 6th locally
    const early = event('early', '2026-11-06T01:00:00Z', '2026-11-06T02:00:00Z');
    expect(eventsStartingOn([early, late], '2026-11-06', ZONE).map((e) => e.id)).toEqual(['late', 'early']);
    expect(eventsStartingOn([early, late], '2026-11-05', ZONE)).toEqual([]);
  });

  it('adds up hours per local day', () => {
    const hours = hoursByDay([shift('a', '2026-11-05T01:00:00Z', '2026-11-05T05:00:00Z', 4), shift('b', '2026-11-05T06:00:00Z', '2026-11-05T10:00:00Z', 3.5)], ZONE);
    expect(hours.get('2026-11-05')).toBe(7.5);
  });

  it('summarises only the period, not the neighbouring days a month grid shows', () => {
    const shifts = [shift('oct', '2026-10-30T01:00:00Z', '2026-10-30T05:00:00Z', 4), shift('nov', '2026-11-05T01:00:00Z', '2026-11-05T05:00:00Z', 4)];
    expect(summarise(shifts, '2026-11-01', '2026-11-30', ZONE)).toEqual({ count: 1, hours: 4 });
  });

  it('marks where each event came from', () => {
    const open = shift('o', '2026-11-05T01:00:00Z', '2026-11-05T02:00:00Z');
    const events = eventsFrom([shift('m', '2026-11-05T03:00:00Z', '2026-11-05T04:00:00Z')], {
      timezone: ZONE, from: '2026-11-05', to: '2026-11-05', give_up: { mode: 'switch', window_days: 2 }, roles: [], open: [open],
      up_for_switch: [{ ...shift('s', '2026-11-05T05:00:00Z', '2026-11-05T06:00:00Z'), owner_name: 'Bo Tan' }],
    });
    expect(events.map((e) => [e.id, e.kind, e.ownerName])).toEqual([['m', 'mine', undefined], ['o', 'open', undefined], ['s', 'switch', 'Bo Tan']]);
  });
});

describe('firstVisibleHour', () => {
  const days = ['2026-11-05'];

  it('opens an hour before the earliest shift', () => {
    expect(firstVisibleHour([event('a', '2026-11-05T01:00:00Z', '2026-11-05T05:00:00Z')], days, ZONE)).toBe(8);
  });

  it('never scrolls before midnight', () => {
    expect(firstVisibleHour([event('a', '2026-11-04T16:30:00Z', '2026-11-04T20:00:00Z')], days, ZONE)).toBe(0);
  });

  it('opens on a usual working morning when nothing is planned', () => {
    expect(firstVisibleHour([], days, ZONE)).toBe(7);
  });
});

describe('scaleForKey', () => {
  it('matches Google Calendar', () => {
    expect(['d', 'W', 'm', 'Y'].map(scaleForKey)).toEqual(['day', 'week', 'month', 'year']);
    expect(scaleForKey('x')).toBeNull();
  });
});
