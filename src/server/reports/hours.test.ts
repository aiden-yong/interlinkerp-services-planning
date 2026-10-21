import { describe, expect, it } from 'vitest';
import type { ShiftFacts } from '../domain/allocation';
import type { UnavailableSpan } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import { parseWorkingHours } from '../domain/workingHours';
import { localMidnight } from '../support/time';
import { allocatedInPeriod, availableInPeriod, type ReportEmployee, type ReportPeriod } from './hours';

const shift = (start: string, end: string, breakMinutes = 0, percent = 100): ShiftFacts =>
  ({ id: 's1', employeeRef: 'E1', roleId: null, interval: Interval.of(start, end), breakMinutes, percent });

const employee = (over: Partial<ReportEmployee>): ReportEmployee => ({
  ref: 'E1', name: 'Ann', onRoster: true, departmentId: null, departmentName: null,
  zone: 'Asia/Kuala_Lumpur', workingHours: null, roleIds: [], defaultRoleId: null, away: [], ...over,
});

describe('report hours', () => {
  it("counts only the part inside the period, on the employee's own days", () => {
    const period: ReportPeriod = { from: Date.parse('2026-03-28T00:00:00Z'), to: Date.parse('2026-03-29T23:00:00Z'), viewZone: 'Europe/London' };
    const facts = [shift('2026-03-29T22:00:00Z', '2026-03-30T05:00:00Z')];
    expect(allocatedInPeriod(facts, 'Europe/London', period)).toEqual({ '2026-03-29': 1 });
  });

  it('splits a night shift across two days', () => {
    const zone = 'Asia/Kuala_Lumpur';
    const period: ReportPeriod = { from: localMidnight('2026-10-12', zone), to: localMidnight('2026-10-14', zone), viewZone: zone };
    const facts = [shift('2026-10-12T22:00:00+08:00', '2026-10-13T06:00:00+08:00', 60)];
    expect(allocatedInPeriod(facts, zone, period)).toEqual({ '2026-10-12': 1.75, '2026-10-13': 5.25 });
  });

  it('has no available hours for flexible employees', () => {
    const period: ReportPeriod = { from: 0, to: 86_400_000, viewZone: 'UTC' };
    expect(availableInPeriod(employee({ workingHours: null }), period)).toBeNull();
  });

  it('removes time off and holidays from available hours', () => {
    const zone = 'Asia/Kuala_Lumpur';
    const period: ReportPeriod = { from: localMidnight('2026-10-12', zone), to: localMidnight('2026-10-15', zone), viewZone: zone };
    const away: UnavailableSpan[] = [
      { interval: Interval.of('2026-10-12T14:00:00+08:00', '2026-10-12T18:00:00+08:00'), kind: 'time_off', label: 'Leave' },
      { interval: Interval.of('2026-10-13T00:00:00+08:00', '2026-10-14T00:00:00+08:00'), kind: 'holiday', label: 'Holiday' },
    ];
    const workingHours = parseWorkingHours({ mon: [['09:00', '13:00'], ['14:00', '18:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']] });
    expect(availableInPeriod(employee({ workingHours, away }), period)).toEqual({ '2026-10-12': 4, '2026-10-14': 8 });
  });
});
