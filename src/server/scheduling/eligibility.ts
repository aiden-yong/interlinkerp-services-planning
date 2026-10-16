import { conflictsForEmployee } from '../domain/conflicts';
import type { ProfileRepository } from '../repo/profiles';
import { factsOf, type ShiftRecord, type ShiftRepository } from '../repo/shifts';
import type { TimeOffRepository } from '../repo/timeOff';
import { ConflictContext } from './conflictContext';

export interface Ineligible {
  rule: 'role' | 'overlap' | 'unavailable';
  message: string;
}

/**
 * BR-05 (v0.4): an employee may take a shift when it has no role or one of their roles, and taking it creates
 * no overlap or time-off conflict. Public holidays do not count: a manager who publishes a holiday shift wants it worked.
 * The role rule is BR-05's own (an employee with no roles cannot take a role shift), so BR-01's role check is not used.
 */
export class Eligibility {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly timeOff: TimeOffRepository,
    private readonly context: ConflictContext,
  ) {}

  /** Reasons this employee may not take this shift; empty means they may. */
  async check(shift: ShiftRecord, employeeRef: string): Promise<Ineligible[]> {
    const reasons: Ineligible[] = [];
    if (shift.roleId && !(await this.profiles.find(employeeRef)).roleIds.includes(shift.roleId)) {
      reasons.push({ rule: 'role', message: "You do not have this shift's role." });
    }
    for (const conflict of await this.context.conflictsFor({ ...shift, employeeRef }, { holidays: false })) {
      if (conflict.rule !== 'role') reasons.push({ rule: conflict.rule, message: conflict.message });
    }
    return reasons;
  }

  /** The same rule for many employees and shifts at once, from 3 reads. Maps employee_ref to the ids they may take. */
  async eligibleShifts(candidates: ShiftRecord[], refs: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (candidates.length === 0 || refs.length === 0) return result;
    const from = new Date(Math.min(...candidates.map((s) => s.start.getTime())));
    const to = new Date(Math.max(...candidates.map((s) => s.end.getTime())));
    const [profiles, existing, away] = await Promise.all([this.profiles.all(), this.shifts.overlapping(from, to), this.timeOff.between(from, to)]);
    for (const ref of refs) {
      const roles = profiles.get(ref)?.roleIds ?? [];
      const theirs = existing.filter((s) => s.employeeRef === ref);
      const spans = ConflictContext.spans(away.filter((t) => t.employeeRef === ref), [], 'UTC'); // no holidays, so the zone is unused
      const fits: string[] = [];
      for (const shift of candidates) {
        if (shift.roleId && !roles.includes(shift.roleId)) continue;
        const candidate = { ...shift, employeeRef: ref };
        const facts = [...theirs.filter((s) => s.id !== shift.id).map(factsOf), factsOf(candidate)];
        if ((conflictsForEmployee(facts, spans, []).get(shift.id) ?? []).length === 0) fits.push(shift.id);
      }
      if (fits.length > 0) result.set(ref, fits);
    }
    return result;
  }
}
