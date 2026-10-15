import type { ShiftFacts } from './allocation';
import type { Interval } from './interval';

export interface Conflict {
  rule: 'overlap' | 'unavailable' | 'role';
  message: string;
}

export interface UnavailableSpan {
  interval: Interval;
  kind: 'time_off' | 'holiday';
  label: string;
}

/** Highest total allocated percentage at any moment inside `shift`, counting `shift` itself. */
export function peakPercent(shift: ShiftFacts, all: ShiftFacts[]): number {
  const events: [number, number][] = [];
  for (const other of all) {
    const overlap = other.interval.intersect(shift.interval);
    if (!overlap) continue;
    events.push([overlap.start, other.percent], [overlap.end, -other.percent]);
  }
  // At the same instant, endings (negative) come first, so back-to-back shifts never add up.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

/**
 * BR-01 for ONE employee's shifts (open shifts are never passed in).
 * @param employeeRoleIds empty = the role rule is not checked
 */
export function conflictsForEmployee(shifts: ShiftFacts[], unavailable: UnavailableSpan[], employeeRoleIds: string[]): Map<string, Conflict[]> {
  const result = new Map<string, Conflict[]>();
  for (const shift of shifts) {
    const conflicts: Conflict[] = [];
    const peak = peakPercent(shift, shifts);
    if (peak > 100) conflicts.push({ rule: 'overlap', message: `Overlaps other shifts; allocation reaches ${peak}%.` });
    const away = unavailable.find((span) => span.interval.overlaps(shift.interval));
    if (away) {
      conflicts.push({
        rule: 'unavailable',
        message: away.kind === 'holiday' ? `Falls on a public holiday: ${away.label}.` : `The employee is on time off${away.label ? `: ${away.label}` : ''}.`,
      });
    }
    if (shift.roleId && employeeRoleIds.length > 0 && !employeeRoleIds.includes(shift.roleId)) {
      conflicts.push({ rule: 'role', message: "The employee does not have this shift's role." });
    }
    result.set(shift.id, conflicts);
  }
  return result;
}
