import type { Template } from '../types';
import type { ShiftForm } from './shiftForm';
import { isoToWall, wallToIso } from './tz';

/** FR-TPL-03, D9: templates whose role matches one of the employee's roles, plus role-less ones. An employee with no roles sees every template. */
export function templatesFor(templates: Template[], employeeRoleIds: string[]): Template[] {
  if (employeeRoleIds.length === 0) return templates;
  return templates.filter((t) => t.role_id === null || employeeRoleIds.includes(t.role_id));
}

/** FR-TPL-02: keeps the form's own date, sets the start time and role (when the template has one), and computes
 * the end as start + duration + break on the wall clock — rolling over past midnight when it does. */
export function applyTemplate(form: ShiftForm, t: Template, zone: string): ShiftForm {
  const startIso = wallToIso(form.start_date, t.start_time, zone);
  const endMs = new Date(startIso).getTime() + (t.duration_minutes + t.break_minutes) * 60_000;
  const end = isoToWall(new Date(endMs).toISOString(), zone);
  return {
    ...form,
    start_time: t.start_time,
    role_id: t.role_id ?? form.role_id,
    break_minutes: String(t.break_minutes),
    end_date: end.date,
    end_time: end.time,
  };
}
