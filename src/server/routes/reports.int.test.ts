import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const WEEK = { from: '2026-10-12', to: '2026-10-18' };

async function shift(ref: string | null, start: string, end: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { status, body } = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: start, end_at: end, acknowledge_conflicts: true, ...extra });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.shift.id;
}

async function get(path: string, query: Record<string, string> = {}) {
  const { status, body } = await h.call('GET', `/api/reports/${path}`, undefined, { ...WEEK, ...query });
  expect(status, JSON.stringify(body)).toBe(200);
  return body;
}

describe('reports', () => {
  it('matches the schedule for the same week', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    await h.call('PATCH', '/api/employees/E1', { timezone: 'Europe/London' });
    await shift('E1', '2026-10-13T09:00:00+01:00', '2026-10-13T17:30:00+01:00', { break_minutes: 30 });
    await shift('E1', '2026-10-14T20:00:00+01:00', '2026-10-15T04:00:00+01:00'); // across midnight
    await shift('E2', '2026-10-15T09:00:00+08:00', '2026-10-15T13:00:00+08:00', { allocated_percent: 50 });
    await shift('E2', '2026-10-18T20:00:00+08:00', '2026-10-19T04:00:00+08:00'); // runs past the end of the week

    const schedule = (await h.call('GET', '/api/schedule', undefined, WEEK)).body;
    const report = await get('planned-hours', { group: 'employee' });
    expect(report.rows).toHaveLength(2);
    for (const e of schedule.employees) {
      expect(report.rows.find((r: { key: string }) => r.key === e.employee_ref).total_hours, e.name).toBe(e.allocated_hours);
    }
    const utilisation = await get('utilisation');
    for (const e of schedule.employees) {
      const row = utilisation.rows.find((r: { employee_ref: string }) => r.employee_ref === e.employee_ref);
      expect(row).toMatchObject({ allocated_hours: e.allocated_hours, available_hours: e.available_hours, over_allocated_days: e.over_allocated_days });
    }
  });

  it('separates draft and published (FR-RPT-01)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shift('E1', '2026-10-13T09:00:00+08:00', '2026-10-13T17:00:00+08:00');
    const published = await shift('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T13:00:00+08:00');
    await h.call('POST', '/api/publications', { shift_ids: [published] });
    const report = await get('planned-hours', { group: 'employee' });
    expect(report.rows).toEqual([{ key: 'E1', label: 'Ana Lim', left: false, draft_hours: 8, published_hours: 4, total_hours: 12, shifts: 2 }]);
    expect(report.totals).toEqual({ draft_hours: 8, published_hours: 4, total_hours: 12, shifts: 2 });
    expect(report.period).toEqual({ ...WEEK, timezone: 'Asia/Kuala_Lumpur', from_at: '2026-10-11T16:00:00Z', to_at: '2026-10-18T16:00:00Z' });
    expect(report.group).toBe('employee');
  });

  it('exports CSV (FR-RPT-02)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shift('E1', '2026-10-13T09:00:00+08:00', '2026-10-13T17:00:00+08:00');
    const response = await h.app.kernel().handle(new Request(`http://localhost/api/reports/planned-hours?from=2026-10-12&to=2026-10-18&format=csv`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="planned-hours_2026-10-12_2026-10-18.csv"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // text() would drop the BOM
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith('﻿Group,Draft hours,Published hours,Total hours,Shifts\r\n')).toBe(true);
    expect(text).toContain('Ana Lim,8.00,0.00,8.00,1\r\n');
    expect(text.endsWith('Total,8.00,0.00,8.00,1\r\n')).toBe(true);
  });

  it('leaves the utilisation of flexible employees empty in CSV', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const response = await h.app.kernel().handle(new Request(`http://localhost/api/reports/utilisation?from=2026-10-12&to=2026-10-18&format=csv`));
    expect(await response.text()).toBe('Employee,Allocated hours,Available hours,Utilisation %,Over-allocated days\r\nAna Lim,0.00,,,\r\n');
  });

  it('lists over-allocated employees (FR-RPT-03)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const day = [['09:00', '17:00']];
    const hours = { mon: day, tue: day, wed: day, thu: day, fri: day };
    await h.call('PATCH', '/api/employees/E1', { working_hours: hours });
    await h.call('PATCH', '/api/employees/E2', { working_hours: hours });
    await shift('E1', '2026-10-12T09:00:00+08:00', '2026-10-12T15:00:00+08:00');
    await shift('E1', '2026-10-12T11:00:00+08:00', '2026-10-12T17:00:00+08:00');
    await shift('E2', '2026-10-13T09:00:00+08:00', '2026-10-13T13:00:00+08:00');
    const { rows } = await get('utilisation');
    expect(rows.map((r: { employee_ref: string }) => r.employee_ref)).toEqual(['E1', 'E2']);
    expect(rows[0]).toMatchObject({ allocated_hours: 12, available_hours: 40, utilisation_percent: 30, over_allocated_days: ['2026-10-12'], flexible: false });
    expect(rows[1]).toMatchObject({ utilisation_percent: 10, over_allocated_days: [] });
  });

  it('counts unfilled open shifts per role per day (FR-RPT-04)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const roleA = await h.addRole('Barista');
    await h.call('PATCH', '/api/employees/E1', { role_ids: [roleA] });
    await shift(null, '2026-10-13T09:00:00+08:00', '2026-10-13T13:00:00+08:00', { role_id: roleA });
    await shift(null, '2026-10-13T14:00:00+08:00', '2026-10-13T18:00:00+08:00', { role_id: roleA });
    await shift('E1', '2026-10-13T09:00:00+08:00', '2026-10-13T13:00:00+08:00', { role_id: roleA });
    const report = await get('open-shifts');
    expect(report.days).toHaveLength(7);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ role_id: roleA, label: 'Barista' });
    expect(report.rows[0].cells['2026-10-13']).toEqual({ open: 2, total: 3 });
    expect(report.totals['2026-10-13']).toEqual({ open: 2, total: 3 });
    expect((await get('open-shifts', { published_only: 'true' })).rows).toEqual([]);
  });

  it('refuses a period over 366 days', async () => {
    const { status, body } = await h.call('GET', '/api/reports/planned-hours', undefined, { from: '2026-01-01', to: '2027-01-02' });
    expect([status, body.error.code, Object.keys(body.error.details)]).toEqual([422, 'PERIOD_TOO_LONG', ['to']]);
    expect((await h.call('GET', '/api/reports/planned-hours', undefined, { from: '2026-01-01', to: '2027-01-01' })).status).toBe(200);
    expect((await h.call('GET', '/api/reports/planned-hours', undefined, { from: '2026-02-01', to: '2026-01-01' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await h.call('GET', '/api/reports/planned-hours', undefined, { ...WEEK, group: 'team' })).body.error.details).toHaveProperty('group');
  });

  it('is for managers only', async () => {
    h.asEmployee('E1');
    for (const path of ['planned-hours', 'utilisation', 'open-shifts']) {
      const { status, body } = await h.call('GET', `/api/reports/${path}`, undefined, WEEK);
      expect([status, body.error.code]).toEqual([403, 'FORBIDDEN']);
    }
  });
});
