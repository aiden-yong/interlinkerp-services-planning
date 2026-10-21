import type { WorkingHoursMap } from '../db/schema';
import { allocatedByDay, availableByDay, type ShiftFacts } from '../domain/allocation';
import type { UnavailableSpan } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import { workingIntervals } from '../domain/workingHours';
import type { DirectoryRow } from '../repo/directory';
import type { Profile } from '../repo/profiles';
import { localDate } from '../support/time';

/** Epoch ms, [from, to). `viewZone` is the viewer's zone that the period's days were cut in. */
export interface ReportPeriod {
  from: number;
  to: number;
  viewZone: string;
}

export interface ReportEmployee {
  ref: string;
  name: string;
  onRoster: boolean;
  departmentId: string | null;
  departmentName: string | null;
  zone: string;
  workingHours: WorkingHoursMap | null;
  roleIds: string[];
  defaultRoleId: string | null;
  /** Time off and holidays, in this employee's zone. */
  away: UnavailableSpan[];
}

/** Allocated hours by the employee's local date, only dates inside the period (the schedule's rule). */
export function allocatedInPeriod(facts: ShiftFacts[], zone: string, period: ReportPeriod): Record<string, number> {
  const firstDay = localDate(period.from, zone);
  const endDay = localDate(period.to, zone);
  return Object.fromEntries(Object.entries(allocatedByDay(facts, zone)).filter(([d]) => d >= firstDay && d < endDay));
}

/** Available hours by local date inside the period; null for flexible hours. */
export function availableInPeriod(e: ReportEmployee, period: ReportPeriod): Record<string, number> | null {
  if (!e.workingHours) return null;
  const working = workingIntervals(e.workingHours, period.from, period.to, e.zone);
  const window = new Interval(period.from, period.to);
  const away = e.away.filter((s) => s.interval.overlaps(window)).map((s) => s.interval);
  return availableByDay(working, away, e.zone);
}

export type Bucket = 'none' | 'month';
export const monthOf = (date: string) => date.slice(0, 7); // 'YYYY-MM'

/** The one way an employee becomes a ReportEmployee, so the schedule and the reports agree. `away` is time off and holidays in `zone`. */
export function reportEmployee(ref: string, directory: DirectoryRow | undefined, profile: Profile, zone: string, away: UnavailableSpan[]): ReportEmployee {
  return {
    ref, name: directory?.displayName ?? 'Unknown employee', onRoster: directory !== undefined,
    departmentId: directory?.departmentId ?? null, departmentName: directory?.departmentName ?? null,
    zone, workingHours: profile.workingHours, roleIds: profile.roleIds, defaultRoleId: profile.defaultRoleId, away,
  };
}
