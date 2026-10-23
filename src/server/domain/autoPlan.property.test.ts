import { describe, expect, it } from 'vitest';
import type { Weekday, WorkingHoursMap } from '../db/schema';
import type { ReportPeriod } from '../reports/hours';
import { localMidnight } from '../support/time';
import { allocatedByDay, availableByDay, overAllocatedDays, subtract, type ShiftFacts } from './allocation';
import { planAutoAssignments, type Candidate, type OpenDraft } from './autoPlan';
import { conflictsForEmployee, type UnavailableSpan } from './conflicts';
import { Interval } from './interval';
import { DAYS, workingIntervals } from './workingHours';

/** Small seeded PRNG so every roster can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const viewZone = 'Asia/Kuala_Lumpur';
// The week that holds the end of British Summer Time (25 Oct 2026), so London days have 25 hours.
const period: ReportPeriod = { from: localMidnight('2026-10-19', viewZone), to: localMidnight('2026-10-26', viewZone), viewZone };
const ZONES = ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York'];
const ROLES = ['r1', 'r2', 'r3'];
const DAY_TEMPLATES: [string, string][][] = [
  [], [['09:00', '17:00']], [['06:00', '12:00'], ['13:00', '18:00']], [['22:00', '24:00']], [['00:00', '06:00']],
  [['00:00', '06:00'], ['22:00', '24:00']], [['00:00', '24:00']], [['08:00', '20:00']],
];

function buildRoster(seed: number): { open: OpenDraft[]; people: Candidate[] } {
  const rand = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const hourIn = (from: number, to: number) => from + int(0, Math.floor((to - from) / HOUR) - 1) * HOUR;

  const people: Candidate[] = [];
  for (let i = 0, n = int(2, 8); i < n; i++) {
    const ref = `E${i + 1}`;
    const zone = pick(ZONES);
    const roleIds = rand() < 0.1 ? [] : ROLES.filter(() => rand() < 0.5);
    const defaultRoleId = roleIds.length && rand() < 0.6 ? pick(roleIds) : null;
    let workingHours: WorkingHoursMap | null = null;
    if (rand() >= 0.2) workingHours = Object.fromEntries(DAYS.map((d: Weekday) => [d, pick(DAY_TEMPLATES)])) as WorkingHoursMap;
    const away: UnavailableSpan[] = [];
    for (let t = int(0, 2); t > 0; t--) {
      const start = hourIn(period.from - DAY, period.to);
      away.push({ interval: new Interval(start, start + int(1, 30) * HOUR), kind: 'time_off', label: '' });
    }
    if (rand() < 0.3) {
      const date = `2026-10-${19 + int(0, 6)}`;
      const start = localMidnight(date, zone);
      away.push({ interval: new Interval(start, start + DAY), kind: 'holiday', label: 'Holiday' });
    }
    const existing: ShiftFacts[] = [];
    for (let s = int(0, 4); s > 0; s--) {
      const start = hourIn(period.from - DAY, period.to + DAY);
      existing.push({
        id: `${ref}-x${s}`, employeeRef: ref, roleId: roleIds.length && rand() < 0.7 ? pick(roleIds) : null,
        interval: new Interval(start, start + int(2, 9) * HOUR), breakMinutes: pick([0, 30, 60]), percent: pick([50, 100]),
      });
    }
    people.push({
      ref, name: pick(['Ann', 'Ben', 'Cara', 'Dan', 'Eve']), onRoster: rand() < 0.9, departmentId: null, departmentName: null,
      zone, workingHours, roleIds, defaultRoleId, away, existing,
    });
  }

  const open: OpenDraft[] = [];
  for (let i = 0, n = int(1, 15); i < n; i++) {
    const start = hourIn(period.from, period.to);
    open.push({
      id: `s${String(i).padStart(2, '0')}`, roleId: rand() < 0.15 ? null : pick([...ROLES, 'r4']),
      start: new Date(start), end: new Date(start + int(2, 10) * HOUR), breakMinutes: pick([0, 30, 60]), percent: pick([50, 100, 100]), version: 1,
    });
  }
  return { open, people };
}

const factsOf = (d: OpenDraft, ref: string): ShiftFacts =>
  ({ id: d.id, employeeRef: ref, roleId: d.roleId, interval: Interval.of(d.start, d.end), breakMinutes: d.breakMinutes, percent: d.percent });

/** Over-allocated days, derived from scratch over a window wide enough to hold every shift. */
function overDays(p: Candidate, shifts: ShiftFacts[]): string[] {
  const working = workingIntervals(p.workingHours!, period.from - 4 * DAY, period.to + 4 * DAY, p.zone);
  return overAllocatedDays(allocatedByDay(shifts, p.zone), availableByDay(working, p.away.map((s) => s.interval), p.zone));
}

function checkRoster(seed: number): number {
  const { open, people } = buildRoster(seed);
  const result = planAutoAssignments(open, people, period);
  expect(planAutoAssignments(open, people, period)).toEqual(result);

  const seen = [...result.assignments.map((a) => a.shiftId), ...result.unfilled.map((u) => u.shiftId)].sort();
  expect(seen).toEqual(open.map((d) => d.id).sort());

  for (const p of people) {
    const mine = result.assignments.filter((a) => a.employeeRef === p.ref).map((a) => open.find((d) => d.id === a.shiftId)!);
    if (!mine.length) continue;
    expect(p.onRoster).toBe(true);
    expect(p.workingHours).not.toBeNull();
    expect(p.roleIds.length).toBeGreaterThan(0);

    const added = mine.map((d) => factsOf(d, p.ref));
    const all = [...p.existing, ...added];
    const conflicts = conflictsForEmployee(all, p.away, p.roleIds);
    for (const f of added) {
      expect(conflicts.get(f.id), `conflict on ${f.id} for ${p.ref}`).toEqual([]);
      const working = workingIntervals(p.workingHours!, f.interval.start - DAY, f.interval.end + DAY, p.zone);
      expect(subtract(f.interval, working), `${f.id} outside working hours of ${p.ref}`).toEqual([]);
    }
    const before = new Set(overDays(p, p.existing));
    expect(overDays(p, all).filter((d) => !before.has(d)), `new over-allocated days for ${p.ref}`).toEqual([]);
  }
  return result.assignments.length;
}

describe('Auto Plan planner over generated rosters', () => {
  it('never creates a conflict or new over-allocation, and is deterministic (300 rosters)', () => {
    let assigned = 0;
    for (let seed = 1; seed <= 300; seed++) {
      try {
        assigned += checkRoster(seed);
      } catch (error) {
        console.error(`Auto Plan property failed for seed ${seed}`);
        if (error instanceof Error) error.message = `seed ${seed}: ${error.message}`;
        throw error;
      }
    }
    // The rosters must actually exercise assignments, or the checks above prove nothing.
    expect(assigned).toBeGreaterThan(300);
  }, 30_000);
});
