import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { employeeDirectory } from '../db/schema';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const WEEK = { from: '2026-10-12', to: '2026-10-18' };

async function week() {
  const { status, body } = await h.call('GET', '/api/schedule', undefined, WEEK);
  expect(status, JSON.stringify(body)).toBe(200);
  return body;
}

const row = (schedule: { employees: any[] }, ref: string) => schedule.employees.find((e: { employee_ref: string }) => e.employee_ref === ref);

async function shift(ref: string | null, start: string, end: string, ack = false) {
  const { status, body } = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: start, end_at: end, acknowledge_conflicts: ack });
  expect(status, JSON.stringify(body)).toBe(201);
}

describe('GET /api/schedule', () => {
  it('gives every employee a row and includes open shifts (FR-SCH-01 AC1, FR-SCH-02)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    await shift(null, '2026-10-14T09:00:00+08:00', '2026-10-14T13:00:00+08:00');
    const schedule = await week();
    expect(schedule.employees.map((e: { name: string }) => e.name)).toEqual(['Ana Lim', 'Bo Tan']);
    expect(schedule.shifts.map((s: { employee_ref: string | null }) => s.employee_ref)).toEqual([null]);
    expect(schedule.period).toEqual({ from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Kuala_Lumpur', from_at: '2026-10-11T16:00:00Z', to_at: '2026-10-18T16:00:00Z' });
  });

  it('reports hours, markers and conflicts (FR-SCH-07, 08, 09; BR-03, BR-04)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const day = [['09:00', '13:00'], ['14:00', '18:00']];
    await h.call('PATCH', '/api/employees/E1', { working_hours: { mon: day, tue: day, wed: day, thu: day, fri: day } });
    await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: '2026-10-16T00:00:00+08:00', end_at: '2026-10-17T00:00:00+08:00', reason: 'Annual leave' });
    await h.call('POST', '/api/holidays', { date: '2026-10-15', name: 'Company Day' });
    await shift('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    await shift('E1', '2026-10-17T09:00:00+08:00', '2026-10-17T13:00:00+08:00'); // Saturday: outside hours is not a conflict (BR-03)
    await shift('E1', '2026-10-16T09:00:00+08:00', '2026-10-16T12:00:00+08:00', true);

    const schedule = await week();
    const ana = row(schedule, 'E1');
    expect(ana).toMatchObject({ flexible: false, allocated_hours: 15, available_hours: 24, over_allocated_days: ['2026-10-16', '2026-10-17'] });
    expect(ana.working_intervals).toHaveLength(10);
    expect(ana.unavailable.map((u: { kind: string }) => u.kind).sort()).toEqual(['holiday', 'time_off']);

    const byStart = Object.fromEntries(schedule.shifts.map((s: { start_at: string }) => [s.start_at, s]));
    expect(byStart['2026-10-17T01:00:00Z'].conflicts).toEqual([]);
    expect(byStart['2026-10-16T01:00:00Z'].conflicts[0].rule).toBe('unavailable');
    expect(byStart['2026-10-16T01:00:00Z'].conflict_acknowledged).toBe(true);
  });

  it('shows flexible-hours employees without availability', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    expect(row(await week(), 'E1')).toMatchObject({ flexible: true, available_hours: null, over_allocated_days: [] });
  });

  it('keeps shifts of someone who left the roster visible (Review Focus 3)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shift('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    await h.database.db.delete(employeeDirectory).where(eq(employeeDirectory.employeeRef, 'E1'));
    await h.addEmployee('E2', 'Bo Tan');
    expect(row(await week(), 'E1')).toMatchObject({ name: 'Unknown employee', on_roster: false });
  });

  it('still loads while the roster is down (Review Focus 2, NFR-06)', async () => {
    h.roster.down = true;
    await shift('E9', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    const schedule = await week();
    expect(schedule.directory_stale).toBe(true);
    expect(schedule.employees.map((e: { employee_ref: string }) => e.employee_ref)).toEqual(['E9']);
  });

  it('finds a conflict with a shift just outside the period', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shift('E1', '2026-10-18T20:00:00+08:00', '2026-10-19T04:00:00+08:00');
    await shift('E1', '2026-10-19T00:00:00+08:00', '2026-10-19T08:00:00+08:00', true);
    expect((await week()).shifts[0].conflicts[0].rule).toBe('overlap');
  });

  it('validates the range and is for managers only', async () => {
    expect((await h.call('GET', '/api/schedule', undefined, { from: '2026-10-12' })).status).toBe(422);
    expect((await h.call('GET', '/api/schedule', undefined, { from: '2026-01-01', to: '2026-12-31' })).status).toBe(422);
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/schedule', undefined, WEEK)).status).toBe(403);
  });
});
