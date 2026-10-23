import { overAllocatedDays, type ShiftFacts } from '../domain/allocation';
import { Interval } from '../domain/interval';
import { localDate, nextDay } from '../support/time';
import { allocatedInPeriod, availableInPeriod, type Bucket, monthOf, type ReportEmployee, type ReportPeriod } from './hours';

export interface ReportShift {
  id: string;
  employeeRef: string | null;
  roleId: string | null;
  start: Date;
  end: Date;
  breakMinutes: number;
  percent: number;
  state: 'draft' | 'published';
}

export interface ReportData {
  period: ReportPeriod;
  orgZone: string;
  shifts: ReportShift[];
  employees: ReportEmployee[];
  roles: { id: string; name: string }[];
}

export type Group = 'employee' | 'role' | 'department';

export interface HoursCell {
  draft_hours: number;
  published_hours: number;
  total_hours: number;
  shifts: number;
}

export interface PlannedHoursRow extends HoursCell {
  key: string;
  label: string;
  left: boolean;
  months?: ({ month: string } & HoursCell)[];
}

export interface UtilisationRow {
  employee_ref: string;
  name: string;
  left: boolean;
  flexible: boolean;
  allocated_hours: number;
  available_hours: number | null;
  utilisation_percent: number | null;
  over_allocated_days: string[];
  months?: { month: string; allocated_hours: number; available_hours: number | null; over_allocated: boolean }[];
}

export interface OpenShiftCell {
  open: number;
  total: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (values: Iterable<number>) => round2([...values].reduce((a, b) => a + b, 0));

const factsOf = (s: ReportShift): ShiftFacts =>
  ({ id: s.id, employeeRef: s.employeeRef, roleId: s.roleId, interval: Interval.of(s.start, s.end), breakMinutes: s.breakMinutes, percent: s.percent });

const employeesByRef = (d: ReportData) => new Map(d.employees.map((e) => [e.ref, e]));
const zoneOf = (d: ReportData, e: ReportEmployee | undefined) => e?.zone ?? d.period.viewZone;

/** The period's first day and the day after its last, in `zone`: the same cut allocatedInPeriod makes. */
function dayRange(period: ReportPeriod, zone: string): [string, string] {
  return [localDate(period.from, zone), localDate(period.to, zone)];
}

function groupFacts(shifts: ReportShift[], by: (s: ReportShift) => string): Map<string, ShiftFacts[]> {
  const out = new Map<string, ShiftFacts[]>();
  for (const s of shifts) {
    const k = by(s);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(factsOf(s));
  }
  return out;
}

interface Accumulator {
  label: string;
  left: boolean;
  draft: Map<string, number>; // local date -> hours
  published: Map<string, number>;
  starts: Map<string, number>; // local date of the start -> shifts
}

const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);

function cellOf(draft: Iterable<number>, published: Iterable<number>, shifts: number): HoursCell {
  const d = sum(draft);
  const p = sum(published);
  return { draft_hours: d, published_hours: p, total_hours: round2(d + p), shifts };
}

/** FR-RPT-01: planned hours, draft and published apart, grouped by employee, role or department. */
export function plannedHours(d: ReportData, group: Group, bucket: Bucket): { rows: PlannedHoursRow[]; totals: HoursCell } {
  const people = employeesByRef(d);
  const roleNames = new Map(d.roles.map((r) => [r.id, r.name]));

  const keyOf = (s: ReportShift): { key: string; label: string; left: boolean } => {
    const e = s.employeeRef ? people.get(s.employeeRef) : undefined;
    if (group === 'role') {
      return s.roleId ? { key: s.roleId, label: roleNames.get(s.roleId) ?? 'Unknown role', left: false } : { key: 'none', label: 'No role', left: false };
    }
    if (!s.employeeRef) return { key: 'open', label: 'Open shifts', left: false };
    if (group === 'department') {
      return e?.departmentId ? { key: e.departmentId, label: e.departmentName ?? 'Unknown department', left: false } : { key: 'none', label: 'No department', left: false };
    }
    return { key: s.employeeRef, label: e?.name ?? 'Unknown employee', left: !e?.onRoster };
  };

  const accumulators = new Map<string, Accumulator>();
  const accumulator = (s: ReportShift): Accumulator => {
    const { key, label, left } = keyOf(s);
    if (!accumulators.has(key)) accumulators.set(key, { label, left, draft: new Map(), published: new Map(), starts: new Map() });
    return accumulators.get(key)!;
  };

  // Hours: one allocation per (row, employee, state), in the employee's own zone, so the numbers are the schedule's.
  const groups = new Map<string, { shifts: ReportShift[]; zone: string }>();
  for (const s of d.shifts) {
    const id = `${keyOf(s).key}\u0000${s.employeeRef ?? ''}\u0000${s.state}`;
    if (!groups.has(id)) groups.set(id, { shifts: [], zone: zoneOf(d, s.employeeRef ? people.get(s.employeeRef) : undefined) });
    groups.get(id)!.shifts.push(s);
  }
  for (const { shifts, zone } of groups.values()) {
    const acc = accumulator(shifts[0]);
    const target = shifts[0].state === 'draft' ? acc.draft : acc.published;
    const byDay = allocatedInPeriod(shifts.map(factsOf), zone, d.period);
    for (const [date, hours] of Object.entries(byDay)) add(target, date, hours);
  }

  // Shift counts: the day the shift starts, in the employee's zone (view zone for open shifts), inside the period.
  for (const s of d.shifts) {
    const zone = zoneOf(d, s.employeeRef ? people.get(s.employeeRef) : undefined);
    const [first, end] = dayRange(d.period, zone);
    const date = localDate(s.start.getTime(), zone);
    if (date >= first && date < end) add(accumulator(s).starts, date, 1);
  }

  const rows: PlannedHoursRow[] = [];
  for (const [key, acc] of accumulators) {
    const row: PlannedHoursRow = { key, label: acc.label, left: acc.left, ...cellOf(acc.draft.values(), acc.published.values(), sum(acc.starts.values())) };
    if (row.total_hours <= 0 && (group === 'employee' || row.shifts === 0)) continue; // e.g. only a shift in the margin around the period
    if (bucket === 'month') {
      const months = [...new Set([...acc.draft.keys(), ...acc.published.keys(), ...acc.starts.keys()].map(monthOf))].sort();
      const inMonth = (m: Map<string, number>, month: string) => [...m].filter(([date]) => monthOf(date) === month).map(([, v]) => v);
      row.months = months.map((month) => ({ month, ...cellOf(inMonth(acc.draft, month), inMonth(acc.published, month), sum(inMonth(acc.starts, month))) }));
    }
    rows.push(row);
  }
  rows.sort((a, b) => Number(b.key === 'open') - Number(a.key === 'open') || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));

  const totals = cellOf(rows.map((r) => r.draft_hours), rows.map((r) => r.published_hours), rows.reduce((a, r) => a + r.shifts, 0));
  return { rows, totals };
}

/** FR-RPT-03: allocated against available hours, with the days an employee is over-allocated. */
export function utilisation(d: ReportData, bucket: Bucket): UtilisationRow[] {
  const facts = groupFacts(d.shifts.filter((s) => s.employeeRef), (s) => s.employeeRef!);
  const rows: UtilisationRow[] = [];
  for (const e of d.employees) {
    const allocated = allocatedInPeriod(facts.get(e.ref) ?? [], e.zone, d.period);
    const allocatedHours = sum(Object.values(allocated));
    if (!e.onRoster && allocatedHours <= 0) continue;
    const available = availableInPeriod(e, d.period);
    const availableHours = available ? sum(Object.values(available)) : null;
    const over = overAllocatedDays(allocated, available);
    const row: UtilisationRow = {
      employee_ref: e.ref, name: e.name, left: !e.onRoster, flexible: e.workingHours === null,
      allocated_hours: allocatedHours, available_hours: availableHours,
      utilisation_percent: availableHours ? round1((allocatedHours / availableHours) * 100) : null,
      over_allocated_days: over,
    };
    if (bucket === 'month') {
      const months = [...new Set([...Object.keys(allocated), ...Object.keys(available ?? {})].map(monthOf))].sort();
      const inMonth = (byDay: Record<string, number>) => (month: string) => sum(Object.entries(byDay).filter(([date]) => monthOf(date) === month).map(([, v]) => v));
      row.months = months.map((month) => ({
        month, allocated_hours: inMonth(allocated)(month), available_hours: available ? inMonth(available)(month) : null,
        over_allocated: over.some((date) => monthOf(date) === month),
      }));
    }
    rows.push(row);
  }
  return rows.sort((a, b) =>
    Number(b.over_allocated_days.length > 0) - Number(a.over_allocated_days.length > 0)
    || (b.utilisation_percent ?? -1) - (a.utilisation_percent ?? -1)
    || a.name.localeCompare(b.name) || a.employee_ref.localeCompare(b.employee_ref));
}

/** FR-RPT-04: per role and day, how many shifts are still open out of all shifts starting that day (view zone). */
export function openShifts(d: ReportData, publishedOnly: boolean) {
  const zone = d.period.viewZone;
  const [first, end] = dayRange(d.period, zone);
  const days: string[] = [];
  for (let day = first; day < end; day = nextDay(day)) days.push(day);
  const blank = () => Object.fromEntries(days.map((day) => [day, { open: 0, total: 0 } as OpenShiftCell]));
  const roleNames = new Map(d.roles.map((r) => [r.id, r.name]));

  const byRole = new Map<string | null, { label: string; cells: Record<string, OpenShiftCell> }>();
  const totals = blank();
  for (const s of d.shifts) {
    if (publishedOnly && s.state !== 'published') continue;
    const day = localDate(s.start.getTime(), zone);
    if (!(day >= first && day < end)) continue;
    if (!byRole.has(s.roleId)) byRole.set(s.roleId, { label: s.roleId ? roleNames.get(s.roleId) ?? 'Unknown role' : 'No role', cells: blank() });
    for (const cell of [byRole.get(s.roleId)!.cells[day], totals[day]]) {
      cell.total += 1;
      if (!s.employeeRef) cell.open += 1;
    }
  }
  const rows = [...byRole].map(([role_id, v]) => ({ role_id, ...v })).sort((a, b) => Number(a.role_id === null) - Number(b.role_id === null) || a.label.localeCompare(b.label));
  return { days, rows, totals };
}
