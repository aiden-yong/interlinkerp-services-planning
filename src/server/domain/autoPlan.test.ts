import { describe, expect, it } from 'vitest';
import type { ReportPeriod } from '../reports/hours';
import { localMidnight } from '../support/time';
import { allocatedByDay, availableByDay, overAllocatedDays, subtract, type ShiftFacts } from './allocation';
import { planAutoAssignments, REASON_TEXT, type Candidate, type OpenDraft, type UnfilledReason } from './autoPlan';
import { conflictsForEmployee, type UnavailableSpan } from './conflicts';
import { Interval } from './interval';
import { parseWorkingHours, workingIntervals } from './workingHours';

const zone = 'Asia/Kuala_Lumpur';
// Mon 12 Oct 2026 .. Sun 18 Oct 2026
const at = (date: string, hhmm: string) => `2026-10-${date}T${hhmm}:00+08:00`;
const period: ReportPeriod = { from: localMidnight('2026-10-12', zone), to: localMidnight('2026-10-19', zone), viewZone: zone };
const weekdays = parseWorkingHours({ mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '17:00']] });

const person = (ref: string, name: string, over: Partial<Candidate> = {}): Candidate => ({
  ref, name, onRoster: true, departmentId: null, departmentName: null, zone,
  workingHours: weekdays, roleIds: ['tech'], defaultRoleId: null, away: [], existing: [], ...over,
});

const draft = (id: string, date: string, from: string, to: string, roleId: string | null = 'tech', over: Partial<OpenDraft> = {}): OpenDraft => ({
  id, roleId, start: new Date(at(date, from)), end: new Date(at(date, to)), breakMinutes: 0, percent: 100, version: 1, ...over,
});

const existing = (id: string, ref: string, date: string, from: string, to: string): ShiftFacts =>
  ({ id, employeeRef: ref, roleId: null, interval: Interval.of(at(date, from), at(date, to)), breakMinutes: 0, percent: 100 });

const assignedTo = (result: ReturnType<typeof planAutoAssignments>) => Object.fromEntries(result.assignments.map((a) => [a.shiftId, a.employeeRef]));

function expectUnfilled(open: OpenDraft[], people: Candidate[], reason: UnfilledReason, text: string) {
  const result = planAutoAssignments(open, people, period);
  expect(result.assignments).toEqual([]);
  expect(result.unfilled).toEqual([{ shiftId: open[0].id, reason }]);
  expect(REASON_TEXT[reason]).toBe(text);
}

describe('Auto Plan planner (BR-09, D9-D12)', () => {
  it('fills 10 open shifts from 6 eligible employees (FR-AUT-01 AC1)', () => {
    const people = ['Ann', 'Ben', 'Cara', 'Dan', 'Eve', 'Finn'].map((name, i) => person(`E${i + 1}`, name, { roleIds: ['tech', 'desk'], defaultRoleId: i % 2 ? 'desk' : 'tech' }));
    const open: OpenDraft[] = [];
    for (const date of ['12', '13', '14', '15', '16']) {
      open.push(draft(`t${date}`, date, '09:00', '13:00', 'tech'), draft(`d${date}`, date, '13:00', '17:00', 'desk'));
    }
    const result = planAutoAssignments(open, people, period);
    expect(result.unfilled).toEqual([]);
    expect(result.assignments).toHaveLength(10);

    // Check every assignment independently against BR-09.
    for (const p of people) {
      const mine = result.assignments.filter((a) => a.employeeRef === p.ref).map((a) => open.find((d) => d.id === a.shiftId)!);
      const facts: ShiftFacts[] = mine.map((d) => ({ id: d.id, employeeRef: p.ref, roleId: d.roleId, interval: Interval.of(d.start, d.end), breakMinutes: d.breakMinutes, percent: d.percent }));
      const conflicts = conflictsForEmployee(facts, p.away, p.roleIds);
      const working = workingIntervals(p.workingHours!, period.from, period.to, p.zone);
      for (const f of facts) {
        expect(p.roleIds).toContain(f.roleId);
        expect(subtract(f.interval, working)).toEqual([]);
        expect(conflicts.get(f.id)).toEqual([]);
      }
      expect(overAllocatedDays(allocatedByDay(facts, zone), availableByDay(working, [], zone))).toEqual([]);
    }
    // Spread evenly: 10 shifts over 6 people, nobody gets more than 2.
    const counts = people.map((p) => result.assignments.filter((a) => a.employeeRef === p.ref).length);
    expect(Math.max(...counts)).toBe(2);
  });

  it('prefers the default role, then spreads evenly (OI-04)', () => {
    const ann = person('E1', 'Ann');
    const ben = person('E2', 'Ben', { defaultRoleId: 'tech' });
    expect(assignedTo(planAutoAssignments([draft('s1', '12', '09:00', '13:00')], [ann, ben], period))).toEqual({ s1: 'E2' });

    const cara = person('E3', 'Cara', { existing: [existing('x1', 'E3', '13', '09:00', '15:00')] });
    const dan = person('E4', 'Dan');
    expect(assignedTo(planAutoAssignments([draft('s1', '12', '09:00', '13:00')], [cara, dan], period))).toEqual({ s1: 'E4' });

    const cara2 = person('E3', 'Cara');
    const both = planAutoAssignments([draft('s1', '12', '09:00', '13:00'), draft('s2', '14', '09:00', '13:00')], [dan, cara2], period);
    expect(assignedTo(both)).toEqual({ s1: 'E3', s2: 'E4' });
  });

  it('skips flexible and role-less employees', () => {
    const flexible = person('E1', 'Ann', { workingHours: null });
    const roleless = person('E2', 'Ben', { roleIds: [] });
    const able = person('E3', 'Zed');
    const result = planAutoAssignments([draft('s1', '12', '09:00', '13:00'), draft('s2', '13', '09:00', '13:00', null)], [flexible, roleless, able], period);
    expect(assignedTo(result)).toEqual({ s1: 'E3', s2: 'E3' });
  });

  it('treats back-to-back working ranges across midnight as one', () => {
    const night = person('E1', 'Ann', { workingHours: parseWorkingHours({ mon: [['22:00', '24:00']], tue: [['00:00', '06:00']] }) });
    const shift = { ...draft('s1', '12', '22:00', '23:00'), end: new Date(at('13', '06:00')) };
    expect(assignedTo(planAutoAssignments([shift], [night], period))).toEqual({ s1: 'E1' });
  });

  it('counts public holidays as away', () => {
    const holiday: UnavailableSpan = { interval: Interval.of(at('12', '00:00'), at('13', '00:00')), kind: 'holiday', label: 'Deepavali' };
    expectUnfilled([draft('s1', '12', '09:00', '13:00')], [person('E1', 'Ann', { away: [holiday] })], 'busy_or_away', 'Everyone with this role is busy or away then');
  });

  it('reports no_role_holder', () => {
    const offRoster = person('E2', 'Ben', { onRoster: false, roleIds: ['chef'] });
    expectUnfilled([draft('s1', '12', '09:00', '13:00', 'chef')], [person('E1', 'Ann'), offRoster], 'no_role_holder', 'No one on the roster has this role');
  });

  it('reports all_flexible', () => {
    expectUnfilled([draft('s1', '12', '09:00', '13:00')], [person('E1', 'Ann', { workingHours: null }), person('E2', 'Ben', { roleIds: ['desk'] })],
      'all_flexible', 'Everyone with this role is on flexible hours');
  });

  it('reports outside_working_hours', () => {
    expectUnfilled([draft('s1', '17', '09:00', '13:00')], [person('E1', 'Ann')], 'outside_working_hours', "Outside everyone's working hours");
    expectUnfilled([draft('s1', '12', '15:00', '18:00')], [person('E1', 'Ann')], 'outside_working_hours', "Outside everyone's working hours");
  });

  it('reports busy_or_away', () => {
    const busy = person('E1', 'Ann', { existing: [existing('x1', 'E1', '12', '12:00', '14:00')] });
    const leave: UnavailableSpan = { interval: Interval.of(at('12', '08:00'), at('12', '10:00')), kind: 'time_off', label: '' };
    expectUnfilled([draft('s1', '12', '09:00', '13:00')], [busy, person('E2', 'Ben', { away: [leave] })], 'busy_or_away', 'Everyone with this role is busy or away then');
  });

  it('reports over_available', () => {
    // An evening shift assigned by hand, outside working hours, already uses 4 of the day's 8 hours.
    const loaded = person('E1', 'Ann', { existing: [existing('x1', 'E1', '12', '18:00', '22:00')] });
    expectUnfilled([draft('s1', '12', '09:00', '17:00')], [loaded], 'over_available', 'Would put everyone over their available hours');
  });

  it('counts this run when checking conflicts and available hours', () => {
    const result = planAutoAssignments([draft('s1', '12', '09:00', '13:00'), draft('s2', '12', '11:00', '15:00')], [person('E1', 'Ann')], period);
    expect(result.assignments).toEqual([{ shiftId: 's1', employeeRef: 'E1' }]);
    expect(result.unfilled).toEqual([{ shiftId: 's2', reason: 'busy_or_away' }]);
  });

  it('gives hard shifts first pick', () => {
    const ann = person('E1', 'Ann', { roleIds: ['tech', 'rare'] });
    const ben = person('E2', 'Ben');
    const y = draft('y', '12', '09:00', '13:00', 'tech');
    const x = draft('x', '12', '10:00', '14:00', 'rare');
    const result = planAutoAssignments([y, x], [ann, ben], period);
    expect(assignedTo(result)).toEqual({ x: 'E1', y: 'E2' });
    expect(result.unfilled).toEqual([]);
  });
});
