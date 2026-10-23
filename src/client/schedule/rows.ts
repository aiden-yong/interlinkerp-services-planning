import type { ScheduleEmployee, SchedulePayload, Shift } from '../types';

export type GroupBy = 'employee' | 'role' | 'department';
export interface Filters { roleId: string; departmentId: string; name: string; state: '' | 'draft' | 'published' | 'open' }
export const NO_FILTERS: Filters = { roleId: '', departmentId: '', name: '', state: '' };
export interface Row { key: string; label: string; kind: 'open' | 'employee' | 'header'; employee: ScheduleEmployee | null; shifts: Shift[] }

function filterShifts(shifts: Shift[], f: Filters): Shift[] {
  return shifts.filter((s) => (!f.roleId || s.role_id === f.roleId)
    && (f.state !== 'draft' || s.state === 'draft')
    && (f.state !== 'published' || s.state === 'published')
    && (f.state !== 'open' || s.employee_ref === null));
}

function filterEmployees(employees: ScheduleEmployee[], f: Filters): ScheduleEmployee[] {
  const q = f.name.trim().toLowerCase();
  return employees.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!f.departmentId || e.department_id === f.departmentId));
}

export function buildRows(data: SchedulePayload, groupBy: GroupBy, f: Filters): Row[] {
  const shifts = filterShifts(data.shifts, f);
  const employees = filterEmployees(data.employees, f);
  const rows: Row[] = [{ key: 'open', label: 'Open shifts', kind: 'open', employee: null, shifts: shifts.filter((s) => s.employee_ref === null) }];
  if (groupBy === 'employee') {
    for (const e of employees) rows.push({ key: e.employee_ref, label: e.name, kind: 'employee', employee: e, shifts: shifts.filter((s) => s.employee_ref === e.employee_ref) });
    return rows;
  }
  if (groupBy === 'department') {
    const named = new Map<string, string>();
    for (const e of employees) if (e.department_id) named.set(e.department_id, e.department_name ?? e.department_id);
    const groups = [...named].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ id: id as string | null, name }));
    groups.push({ id: null, name: 'No department' });
    for (const group of groups) {
      const members = employees.filter((e) => (e.department_id ?? null) === group.id);
      if (members.length === 0) continue;
      rows.push({ key: `dept:${group.id ?? 'none'}`, label: group.name, kind: 'header', employee: null, shifts: [] });
      for (const e of members) {
        rows.push({ key: `dept:${group.id ?? 'none'}:${e.employee_ref}`, label: e.name, kind: 'employee', employee: e, shifts: shifts.filter((s) => s.employee_ref === e.employee_ref) });
      }
    }
    return rows;
  }
  const groups = [...data.roles.map((r) => ({ id: r.id as string | null, name: r.name })), { id: null, name: 'No role' }];
  const known = new Set(data.roles.map((r) => r.id));
  for (const group of groups) {
    const inGroup = shifts.filter((s) => s.employee_ref !== null && (group.id === null ? s.role_id === null || !known.has(s.role_id) : s.role_id === group.id));
    const members = employees.filter((e) => inGroup.some((s) => s.employee_ref === e.employee_ref));
    if (members.length === 0) continue;
    rows.push({ key: `role:${group.id ?? 'none'}`, label: group.name, kind: 'header', employee: null, shifts: [] });
    for (const e of members) {
      rows.push({ key: `role:${group.id ?? 'none'}:${e.employee_ref}`, label: e.name, kind: 'employee', employee: e, shifts: inGroup.filter((s) => s.employee_ref === e.employee_ref) });
    }
  }
  return rows;
}
