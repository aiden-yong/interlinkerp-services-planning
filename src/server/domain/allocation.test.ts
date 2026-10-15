import { describe, expect, it } from 'vitest';
import { localMidnight } from '../support/time';
import { allocatedByDay, availableByDay, overAllocatedDays, type ShiftFacts, shiftHours, subtract } from './allocation';
import { Interval } from './interval';
import { parseWorkingHours, workingIntervals } from './workingHours';

const KL = 'Asia/Kuala_Lumpur';
const shift = (start: string, end: string, breakMinutes = 0, percent = 100): ShiftFacts =>
  ({ id: 's1', employeeRef: 'E1', roleId: null, interval: Interval.of(start, end), breakMinutes, percent });

describe('allocation', () => {
  it('subtracts the break and applies the percentage', () => {
    expect(shiftHours(shift('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00', 60))).toBe(7);
    expect(shiftHours(shift('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00', 60, 50))).toBe(3.5);
  });

  it('counts an overnight shift on both days and shares the break', () => {
    expect(allocatedByDay([shift('2026-10-12T22:00:00+08:00', '2026-10-13T06:00:00+08:00', 60)], KL)).toEqual({ '2026-10-12': 1.75, '2026-10-13': 5.25 });
  });

  it('takes time off out of available hours', () => {
    const from = localMidnight('2026-10-12', KL);
    const working = workingIntervals(parseWorkingHours({ mon: [['09:00', '13:00'], ['14:00', '18:00']] }), from, from + 86_400_000, KL);
    expect(availableByDay(working, [Interval.of('2026-10-12T14:00:00+08:00', '2026-10-12T18:00:00+08:00')], KL)).toEqual({ '2026-10-12': 4 });
  });

  it('flags days over the available hours, including days with none', () => {
    const allocated = { '2026-10-12': 9, '2026-10-13': 2, '2026-10-17': 4 };
    expect(overAllocatedDays(allocated, { '2026-10-12': 8, '2026-10-13': 8 })).toEqual(['2026-10-12', '2026-10-17']);
    expect(overAllocatedDays(allocated, null)).toEqual([]);
  });

  it('subtracts a cut from the middle', () => {
    const pieces = subtract(Interval.of('2026-10-12T00:00:00Z', '2026-10-12T10:00:00Z'), [Interval.of('2026-10-12T04:00:00Z', '2026-10-12T06:00:00Z')]);
    expect(pieces.map((p) => p.hours)).toEqual([4, 4]);
  });
});
