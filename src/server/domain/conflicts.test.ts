import { describe, expect, it } from 'vitest';
import type { ShiftFacts } from './allocation';
import { conflictsForEmployee, peakPercent, type UnavailableSpan } from './conflicts';
import { Interval } from './interval';

const at = (hhmm: string) => `2026-10-12T${hhmm}:00+08:00`;
const shift = (id: string, from: string, to: string, percent = 100, roleId: string | null = null): ShiftFacts =>
  ({ id, employeeRef: 'E1', roleId, interval: Interval.of(at(from), at(to)), breakMinutes: 0, percent });
const rules = (map: Map<string, { rule: string }[]>, id: string) => map.get(id)!.map((c) => c.rule);

describe('conflicts (BR-01)', () => {
  it('flags both of two full overlapping shifts', () => {
    const result = conflictsForEmployee([shift('a', '09:00', '13:00'), shift('b', '12:00', '17:00')], [], []);
    expect(rules(result, 'a')).toEqual(['overlap']);
    expect(rules(result, 'b')).toEqual(['overlap']);
  });

  it('allows two half-time shifts to overlap, and back-to-back shifts', () => {
    expect(rules(conflictsForEmployee([shift('a', '09:00', '17:00', 50), shift('b', '09:00', '17:00', 50)], [], []), 'a')).toEqual([]);
    expect(rules(conflictsForEmployee([shift('a', '09:00', '13:00'), shift('b', '13:00', '17:00')], [], []), 'a')).toEqual([]);
  });

  it('measures the peak inside the shift', () => {
    const all = [shift('a', '09:00', '17:00', 60), shift('b', '09:00', '11:00', 30), shift('c', '15:00', '17:00', 30)];
    expect(peakPercent(all[0], all)).toBe(90);
  });

  it('describes time off and holidays', () => {
    const leave: UnavailableSpan = { interval: Interval.of(at('12:00'), at('18:00')), kind: 'time_off', label: 'Medical appointment' };
    // b ends when a starts, so it neither overlaps a nor the time off.
    const result = conflictsForEmployee([shift('a', '09:00', '13:00'), shift('b', '07:00', '09:00')], [leave], []);
    expect(result.get('a')![0].message).toBe('The employee is on time off: Medical appointment.');
    expect(result.get('b')).toEqual([]);

    const holiday: UnavailableSpan = { interval: Interval.of(at('00:00'), at('23:59')), kind: 'holiday', label: 'Deepavali' };
    expect(conflictsForEmployee([shift('a', '09:00', '13:00')], [holiday], []).get('a')![0].message).toBe('Falls on a public holiday: Deepavali.');
  });

  it('checks the role only when the employee has roles', () => {
    const s = shift('a', '09:00', '13:00', 100, 'tech');
    expect(rules(conflictsForEmployee([s], [], ['reception']), 'a')).toEqual(['role']);
    expect(rules(conflictsForEmployee([s], [], ['tech']), 'a')).toEqual([]);
    expect(rules(conflictsForEmployee([s], [], []), 'a')).toEqual([]);
  });
});
