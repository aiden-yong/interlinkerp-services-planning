import { query } from '../api';
import { addDays } from '../schedule/period';

export type Preset = 'this-week' | 'this-month' | 'last-month' | 'custom';
export type ReportName = 'planned-hours' | 'utilisation' | 'open-shifts';

export interface ReportQuery {
  from: string;
  to: string;
  group?: string;
  roleId?: string;
  departmentId?: string;
  publishedOnly?: boolean;
  timezone?: string;
}

const monthBounds = (year: number, month: number) => {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(Date.UTC(year, month, 1)), to: iso(Date.UTC(year, month + 1, 0)) };
};

/** The period a preset stands for, from `today` (YYYY-MM-DD in the viewer's zone). Weeks start on Monday. */
export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  if (preset === 'this-month') return monthBounds(y, m - 1);
  if (preset === 'last-month') return monthBounds(y, m - 2);
  const from = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** The API URL of a report; empty filters are left out. */
export function reportUrl(report: ReportName, q: ReportQuery, format: 'json' | 'csv'): string {
  return `/api/reports/${report}${query({
    from: q.from, to: q.to, group: q.group, role_id: q.roleId, department_id: q.departmentId,
    published_only: q.publishedOnly ? 'true' : undefined, timezone: q.timezone, format,
  })}`;
}
