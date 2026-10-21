import { DateTime } from 'luxon';
import type { AutoPlanReport, SchedulePayload } from '../types';
import { formatTime } from './tz';

export interface AutoPlanLine { key: string; text: string }
export interface AutoPlanSummary { heading: string; filled: AutoPlanLine[]; unfilled: AutoPlanLine[]; notes: string[] }

/** Plain-language lines for the Auto Plan result, in the viewer's zone. */
export function describeAutoPlan(report: AutoPlanReport, data: SchedulePayload, zone: string): AutoPlanSummary {
  const shifts = new Map(data.shifts.map((s) => [s.id, s]));
  const roles = new Map(data.roles.map((r) => [r.id, r.name]));
  const people = new Map(data.employees.map((e) => [e.employee_ref, e.name]));
  const label = (shiftId: string) => {
    const s = shifts.get(shiftId);
    if (!s) return 'Shift';
    const day = DateTime.fromISO(s.start_at, { zone }).setLocale('en').toFormat('ccc d LLL');
    const role = (s.role_id && roles.get(s.role_id)) || 'No role';
    return `${day} ${formatTime(s.start_at, zone)}–${formatTime(s.end_at, zone)} · ${role}`;
  };
  const filled = report.filled.map((f) => ({ key: f.shift_id, text: `${label(f.shift_id)} → ${people.get(f.employee_ref) ?? f.employee_ref}` }));
  const unfilled = report.unfilled.map((u) => ({ key: u.shift_id, text: `${label(u.shift_id)} · ${u.reason}` }));
  const notes: string[] = [];
  const published = report.skipped_published.length;
  const changed = report.skipped_changed.length;
  if (published > 0) notes.push(`${published} published open shift${published === 1 ? ' was' : 's were'} left for employees to claim.`);
  if (changed > 0) notes.push(`${changed} shift${changed === 1 ? '' : 's'} changed while Auto Plan ran and ${changed === 1 ? 'was' : 'were'} skipped.`);
  return { heading: `Filled ${filled.length} of ${filled.length + unfilled.length} open shifts`, filled, unfilled, notes };
}
