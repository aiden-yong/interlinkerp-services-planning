import { describe, expect, it } from 'vitest';
import type { MyShift } from '../types';
import { groupByDay } from './days';

const shift = (id: string, start: string, end: string): MyShift => ({ id, role_id: null, start_at: start, end_at: end, break_minutes: 0, allocated_hours: 8, note: null, switch_requested: false });
const days = ['2026-10-12', '2026-10-13', '2026-10-14'];

describe('groupByDay', () => {
  it('lists each shift once, under the local day it starts', () => {
    const groups = groupByDay([
      shift('overnight', '2026-10-12T14:00:00Z', '2026-10-12T22:00:00Z'), // 22:00–06:00 in Kuala Lumpur
      shift('late', '2026-10-13T16:30:00Z', '2026-10-13T20:00:00Z'), // 00:30 on the 14th locally
      shift('early', '2026-10-13T01:00:00Z', '2026-10-13T09:00:00Z'),
    ], days, 'Asia/Kuala_Lumpur');
    expect(groups.map((g) => [g.date, g.shifts.map((s) => s.id)])).toEqual([['2026-10-12', ['overnight']], ['2026-10-13', ['early']], ['2026-10-14', ['late']]]);
  });

  it('keeps empty days so the calendar has every column', () => {
    expect(groupByDay([], days, 'Asia/Kuala_Lumpur').map((g) => g.shifts.length)).toEqual([0, 0, 0]);
  });
});
