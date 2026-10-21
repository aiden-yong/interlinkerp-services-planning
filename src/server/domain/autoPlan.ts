import { allocatedInPeriod, type ReportEmployee, type ReportPeriod } from '../reports/hours';
import { localMidnight, nextDay } from '../support/time';
import { allocatedByDay, availableByDay, overAllocatedDays, subtract, type ShiftFacts } from './allocation';
import { conflictsForEmployee } from './conflicts';
import { Interval } from './interval';
import { splitByLocalDay } from './localDays';
import { workingIntervals } from './workingHours';

/** A draft open shift that Auto Plan may fill. */
export interface OpenDraft {
  id: string;
  roleId: string | null;
  start: Date;
  end: Date;
  breakMinutes: number;
  percent: number;
  version: number;
}

/** An employee Auto Plan may assign, with their live shifts overlapping the period ± 7 days. */
export interface Candidate extends ReportEmployee {
  existing: ShiftFacts[];
}

export type UnfilledReason = 'no_role_holder' | 'all_flexible' | 'outside_working_hours' | 'busy_or_away' | 'over_available';

export const REASON_TEXT: Record<UnfilledReason, string> = {
  no_role_holder: 'No one on the roster has this role',
  all_flexible: 'Everyone with this role is on flexible hours',
  outside_working_hours: "Outside everyone's working hours",
  busy_or_away: 'Everyone with this role is busy or away then',
  over_available: 'Would put everyone over their available hours',
};

export interface AutoPlanResult {
  assignments: { shiftId: string; employeeRef: string }[];
  unfilled: { shiftId: string; reason: UnfilledReason }[];
}

/** Each employee's shifts as the run goes: their existing ones plus what this run gave them. */
type RunningState = Map<string, ShiftFacts[]>;

const factsOf = (d: OpenDraft, employeeRef: string | null): ShiftFacts =>
  ({ id: d.id, employeeRef, roleId: d.roleId, interval: Interval.of(d.start, d.end), breakMinutes: d.breakMinutes, percent: d.percent });

/** Plain code-unit order, so the result never depends on the server's locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** S4: on every local day the shift touches, allocated (existing + run + shift) stays within working hours minus away. */
function staysWithinAvailable(p: Candidate, withShift: ShiftFacts[], shift: ShiftFacts): boolean {
  const days = [...splitByLocalDay(shift.interval, p.zone).keys()];
  const from = localMidnight(days[0], p.zone);
  const to = localMidnight(nextDay(days[days.length - 1]), p.zone);
  const available = availableByDay(workingIntervals(p.workingHours!, from, to, p.zone), p.away.map((s) => s.interval), p.zone);
  const allocated = allocatedByDay(withShift, p.zone);
  const onShiftDays = Object.fromEntries(days.map((d) => [d, allocated[d] ?? 0]));
  return overAllocatedDays(onShiftDays, available).length === 0;
}

/** D9 as successive filters; the first filter that empties the pool names the reason (D12). */
const STEPS: [UnfilledReason, (p: Candidate, shift: ShiftFacts, state: RunningState) => boolean][] = [
  ['no_role_holder', (p, s) => p.onRoster && p.roleIds.length > 0 && (s.roleId === null || p.roleIds.includes(s.roleId))],
  ['all_flexible', (p) => p.workingHours !== null],
  ['outside_working_hours', (p, s) => subtract(s.interval, workingIntervals(p.workingHours!, s.interval.start, s.interval.end, p.zone)).length === 0],
  ['busy_or_away', (p, s, state) => conflictsForEmployee([...state.get(p.ref)!, s], p.away, p.roleIds).get(s.id)!.length === 0],
  ['over_available', (p, s, state) => staysWithinAvailable(p, [...state.get(p.ref)!, s], s)],
];

function narrow(shift: ShiftFacts, people: Candidate[], state: RunningState): { pool: Candidate[]; reason: UnfilledReason | null } {
  let pool = people;
  for (const [reason, keep] of STEPS) {
    pool = pool.filter((p) => keep(p, shift, state));
    if (pool.length === 0) return { pool, reason };
  }
  return { pool, reason: null };
}

const hoursInPeriod = (p: Candidate, state: RunningState, period: ReportPeriod) =>
  Math.round(Object.values(allocatedInPeriod(state.get(p.ref)!, p.zone, period)).reduce((sum, h) => sum + h, 0) * 100) / 100;

/** D10: default role first, then fewest allocated hours in the period (spread evenly), then name, then ref. */
function choose(pool: Candidate[], shift: ShiftFacts, state: RunningState, period: ReportPeriod): Candidate {
  const ranked = pool.map((p) => ({ p, byDefault: shift.roleId !== null && p.defaultRoleId === shift.roleId ? 0 : 1, hours: hoursInPeriod(p, state, period) }));
  ranked.sort((a, b) => a.byDefault - b.byDefault || a.hours - b.hours || compare(a.p.name, b.p.name) || compare(a.p.ref, b.p.ref));
  return ranked[0].p;
}

/**
 * Auto Plan (FR-AUT-01, BR-09, D9-D12): assigns draft open shifts without creating any conflict or new over-allocation.
 * Pure: it reads neither the clock nor the database, so the same input always gives the same result.
 */
export function planAutoAssignments(open: OpenDraft[], people: Candidate[], period: ReportPeriod): AutoPlanResult {
  const state: RunningState = new Map(people.map((p) => [p.ref, [...p.existing]]));
  const shifts = open.map((d) => factsOf(d, null));

  // D11: hardest first, by the number of candidates against the starting state.
  const startingPool = new Map(shifts.map((s) => [s.id, narrow(s, people, state).pool.length]));
  shifts.sort((a, b) => startingPool.get(a.id)! - startingPool.get(b.id)! || a.interval.start - b.interval.start || compare(a.id, b.id));

  const result: AutoPlanResult = { assignments: [], unfilled: [] };
  for (const shift of shifts) {
    const { pool, reason } = narrow(shift, people, state);
    if (reason) {
      result.unfilled.push({ shiftId: shift.id, reason });
      continue;
    }
    const winner = choose(pool, shift, state, period);
    state.get(winner.ref)!.push({ ...shift, employeeRef: winner.ref });
    result.assignments.push({ shiftId: shift.id, employeeRef: winner.ref });
  }
  return result;
}
