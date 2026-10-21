import type { PlannedHoursRow, UtilisationRow } from '../types';
import type { Filters } from './rows';

export interface YearMonth { month: string; draft: number; published: number; over: boolean; openCount?: number }
export interface YearRow { key: string; label: string; kind: 'open' | 'employee' | 'header'; months: YearMonth[] }
/** Department of each employee, by employee_ref. */
export type Departments = Record<string, { id: string | null; name: string | null }>;

const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

/**
 * Rows come from utilisation (every roster employee); hours come from planned hours (grouped by employee).
 * The state filter picks draft, published or both; "open" keeps only the open row.
 */
export function yearRows(planned: PlannedHoursRow[], util: UtilisationRow[], f: Filters, groupBy: 'employee' | 'department', departments: Departments, year: number): YearRow[] {
  const months = monthsOf(year);
  const hours = new Map(planned.map((r) => [r.key, new Map((r.months ?? []).map((m) => [m.month, m]))]));
  const build = (key: string, label: string, hoursKey: string, kind: 'open' | 'employee', over?: Set<string>): YearRow => ({
    key, label, kind,
    months: months.map((month) => {
      const h = hours.get(hoursKey)?.get(month);
      const cell: YearMonth = {
        month,
        draft: f.state === 'published' ? 0 : h?.draft_hours ?? 0,
        published: f.state === 'draft' ? 0 : h?.published_hours ?? 0,
        over: over?.has(month) ?? false,
      };
      if (kind === 'open') cell.openCount = h?.shifts ?? 0;
      return cell;
    }),
  });
  const rows = [build('open', 'Open shifts', 'open', 'open')];
  if (f.state === 'open') return rows;
  const q = f.name.trim().toLowerCase();
  const people = util.filter((u) => (!q || u.name.toLowerCase().includes(q)) && (!f.departmentId || departments[u.employee_ref]?.id === f.departmentId));
  const rowFor = (u: UtilisationRow, key: string) => build(key, u.name, u.employee_ref, 'employee', new Set((u.months ?? []).filter((m) => m.over_allocated).map((m) => m.month)));
  if (groupBy === 'employee') return [...rows, ...people.map((u) => rowFor(u, u.employee_ref))];
  const named = new Map<string, string>();
  for (const u of people) {
    const d = departments[u.employee_ref];
    if (d?.id) named.set(d.id, d.name ?? d.id);
  }
  const groups = [...named].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ id: id as string | null, name }));
  groups.push({ id: null, name: 'No department' });
  for (const g of groups) {
    const members = people.filter((u) => (departments[u.employee_ref]?.id ?? null) === g.id);
    if (members.length === 0) continue;
    rows.push({ key: `dept:${g.id ?? 'none'}`, label: g.name, kind: 'header', months: [] });
    for (const u of members) rows.push(rowFor(u, `dept:${g.id ?? 'none'}:${u.employee_ref}`));
  }
  return rows;
}
