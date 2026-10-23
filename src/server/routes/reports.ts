import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { type Group, openShifts, plannedHours, utilisation } from '../reports/build';
import { csvFilename, toCsv } from '../reports/csv';
import type { Bucket } from '../reports/hours';
import { iso, isTimezone } from '../support/time';

const MAX_PERIOD_DAYS = 366;
const GROUPS = ['employee', 'role', 'department'] as const;
const BUCKETS = ['none', 'month'] as const;

function oneOf<T extends string>(input: Input, key: string, allowed: readonly T[], fallback: T): T {
  const value = input.string(key, 32);
  if (value === null) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    input.error(key, `Must be one of: ${allowed.join(', ')}.`);
    return fallback;
  }
  return value as T;
}

function flag(input: Input, key: string): boolean {
  const value = input.string(key, 5);
  if (value === null) return false;
  if (value !== 'true' && value !== 'false') input.error(key, 'Must be true or false.');
  return value === 'true';
}

/** The parameters every report shares. Field errors come first (422 VALIDATION_ERROR), then the length limit (422 PERIOD_TOO_LONG). */
function common(query: Record<string, string>, extra: (input: Input) => void = () => {}) {
  const input = new Input(query);
  const from = input.date('from', true);
  const to = input.date('to', true);
  const format = oneOf(input, 'format', ['json', 'csv'] as const, 'json');
  // The viewer zone is resolved as GET /api/schedule does.
  const zone = input.has('timezone') ? input.string('timezone', 64) : null;
  if (zone && !isTimezone(zone)) input.error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
  const roleId = input.string('role_id', 64);
  extra(input);
  let tooLong: string | null = null;
  if (from && to) {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days < 1) input.error('to', 'Must be on or after from.');
    else if (days > MAX_PERIOD_DAYS) tooLong = `The period can be at most ${MAX_PERIOD_DAYS} days.`;
  }
  input.check();
  if (tooLong) throw new HttpError(422, 'PERIOD_TOO_LONG', tooLong, { to: tooLong });
  return { from: from!, to: to!, format, zone: zone ?? undefined, roleId: roleId ?? undefined };
}

const periodOf = (from: string, to: string, p: { from: number; to: number; viewZone: string }) =>
  ({ from, to, timezone: p.viewZone, from_at: iso(p.from), to_at: iso(p.to) });

function csv(body: string, report: 'planned-hours' | 'utilisation' | 'open-shifts', from: string, to: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${csvFilename(report, from, to)}"` } });
}

const withLeft = (label: string, left: boolean) => (left ? `${label} (left)` : label);

export function register(r: Router, app: App): void {
  r.add('GET', '/api/reports/planned-hours', 'manager', 'Report planned hours by employee, role or department, with draft and published apart.', async ({ query }) => {
    let group: Group = 'employee';
    let bucket: Bucket = 'none';
    let departmentId: string | null = null;
    const c = common(query, (input) => {
      group = oneOf(input, 'group', GROUPS, 'employee');
      bucket = oneOf(input, 'bucket', BUCKETS, 'none');
      departmentId = input.string('department_id', 64);
    });
    const data = await app.reports().load(c.from, c.to, c.zone, c.roleId, departmentId ?? undefined);
    const { rows, totals } = plannedHours(data, group, bucket);
    if (c.format === 'csv') {
      // Counts go in as text: toCsv writes every number with two decimals.
      const lines: (string | number)[][] = rows.map((x) => [withLeft(x.label, x.left), x.draft_hours, x.published_hours, x.total_hours, String(x.shifts)]);
      lines.push(['Total', totals.draft_hours, totals.published_hours, totals.total_hours, String(totals.shifts)]);
      return csv(toCsv(['Group', 'Draft hours', 'Published hours', 'Total hours', 'Shifts'], lines), 'planned-hours', c.from, c.to);
    }
    return json(200, { period: periodOf(c.from, c.to, data.period), group, rows, totals });
  }, op('Report Planned Hours', 'Total the hours planned in a period, draft and published apart', ['Reviewing planned hours by employee, role or department', 'Exporting hours to a spreadsheet'], ['Reading one week of the schedule'],
    ['from', 'to', 'group', 'role_id', 'department_id', 'bucket', 'format', 'timezone'], ['period', 'group', 'rows[]', 'totals'], ['Planning Manager'], ['GET /api/reports/utilisation', 'GET /api/schedule'],
    ['report', 'planned hours', 'hours', 'export', 'csv']));

  r.add('GET', '/api/reports/utilisation', 'manager', 'Report allocated against available hours per employee, with the days they are over-allocated.', async ({ query }) => {
    let bucket: Bucket = 'none';
    let departmentId: string | null = null;
    const c = common(query, (input) => {
      bucket = oneOf(input, 'bucket', BUCKETS, 'none');
      departmentId = input.string('department_id', 64);
    });
    const data = await app.reports().load(c.from, c.to, c.zone, c.roleId, departmentId ?? undefined);
    const rows = utilisation(data, bucket);
    if (c.format === 'csv') {
      const lines = rows.map((x) => [withLeft(x.name, x.left), x.allocated_hours, x.available_hours, x.utilisation_percent === null ? null : x.utilisation_percent.toFixed(1), x.over_allocated_days.join('; ')]);
      return csv(toCsv(['Employee', 'Allocated hours', 'Available hours', 'Utilisation %', 'Over-allocated days'], lines), 'utilisation', c.from, c.to);
    }
    return json(200, { period: periodOf(c.from, c.to, data.period), rows });
  }, op('Report Utilisation', 'Compare allocated with available hours and find over-allocated employees', ['Checking who is over or under used', 'Finding over-allocated days over a long period'], ['Seeing one week on the planning board'],
    ['from', 'to', 'role_id', 'department_id', 'bucket', 'format', 'timezone'], ['period', 'rows[]'], ['Planning Manager'], ['GET /api/reports/planned-hours', 'GET /api/schedule'],
    ['report', 'utilisation', 'capacity', 'over-allocated', 'csv']));

  r.add('GET', '/api/reports/open-shifts', 'manager', 'Report unfilled open shifts per role per day.', async ({ query }) => {
    let publishedOnly = false;
    const c = common(query, (input) => {
      publishedOnly = flag(input, 'published_only');
    });
    const data = await app.reports().load(c.from, c.to, c.zone, c.roleId);
    const report = openShifts(data, publishedOnly);
    if (c.format === 'csv') {
      const cell = (c: { open: number; total: number }) => (c.total === 0 ? '' : `${c.open}/${c.total}`); // a day with no shifts is blank
      const lines = report.rows.map((x) => [x.label, ...report.days.map((d) => cell(x.cells[d]))]);
      lines.push(['Total', ...report.days.map((d) => cell(report.totals[d]))]);
      return csv(toCsv(['Role', ...report.days], lines), 'open-shifts', c.from, c.to);
    }
    return json(200, { period: periodOf(c.from, c.to, data.period), ...report });
  }, op('Report Open Shifts', 'Count unfilled open shifts per role per day', ['Finding gaps in coverage', 'Exporting coverage to a spreadsheet'], ['Claiming an open shift'],
    ['from', 'to', 'role_id', 'published_only', 'format', 'timezone'], ['period', 'days[]', 'rows[]', 'totals'], ['Planning Manager'], ['GET /api/reports/planned-hours', 'GET /api/my/open-shifts'],
    ['report', 'open shifts', 'coverage', 'csv']));
}
