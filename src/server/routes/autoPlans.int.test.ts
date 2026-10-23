import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationOutbox, shifts } from '../db/schema';
import { ShiftRepository } from '../repo/shifts';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';
import { whileLocked } from '../test/races';

const h = useApiHarness();
const WEEK = { from: '2026-10-19', to: '2026-10-25' }; // Monday to Sunday, the week after the harness clock
const DAYS = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
const DAY = [['09:00', '17:00']];
const HOURS = { mon: DAY, tue: DAY, wed: DAY, thu: DAY, fri: DAY };

let tech: string;
beforeEach(async () => {
  tech = await h.addRole('Technician');
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function employee(ref: string, name: string, roleIds: string[] = [tech]) {
  await h.addEmployee(ref, name);
  const { status, body } = await h.call('PATCH', `/api/employees/${ref}`, { role_ids: roleIds, working_hours: HOURS });
  expect(status, JSON.stringify(body)).toBe(200);
}

async function open(start: string, end: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { status, body } = await h.call('POST', '/api/shifts', { employee_ref: null, role_id: tech, start_at: start, end_at: end, ...extra });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.shift.id;
}

const row = async (id: string) => (await h.database.db.select().from(shifts).where(eq(shifts.id, id)))[0]!;
const autoPlan = (body: Record<string, unknown> = WEEK) => h.call('POST', '/api/auto-plans', body);

describe('Auto Plan (FR-AUT-01, FR-AUT-02)', () => {
  it('assigns draft open shifts and sends nothing (FR-AUT-01 AC1)', async () => {
    for (let i = 1; i <= 6; i++) await employee(`E${i}`, `Person ${i}`);
    const ids: string[] = [];
    for (const day of DAYS) {
      ids.push(await open(`${day}T09:00:00+08:00`, `${day}T13:00:00+08:00`));
      ids.push(await open(`${day}T13:00:00+08:00`, `${day}T17:00:00+08:00`));
    }

    const { status, body } = await autoPlan();
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.filled.length + body.unfilled.length).toBe(10);
    expect(body.filled.length).toBe(10);
    expect(body.skipped_published).toEqual([]);
    expect(body.skipped_changed).toEqual([]);

    const schedule = (await h.call('GET', '/api/schedule', undefined, WEEK)).body;
    for (const f of body.filled as { shift_id: string; employee_ref: string }[]) {
      const s = schedule.shifts.find((x: { id: string }) => x.id === f.shift_id);
      expect(s).toMatchObject({ employee_ref: f.employee_ref, state: 'draft', conflicts: [] });
    }
    expect(await h.database.db.select().from(notificationOutbox)).toEqual([]);
  });

  it('reports why a shift stayed open (FR-AUT-02)', async () => {
    await employee('E1', 'Ana Lim');
    const nobody = await h.addRole('Electrician');
    const id = await open('2026-10-20T09:00:00+08:00', '2026-10-20T13:00:00+08:00', { role_id: nobody });

    const { status, body } = await autoPlan();
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toEqual({
      filled: [], unfilled: [{ shift_id: id, reason_code: 'no_role_holder', reason: 'No one on the roster has this role' }], skipped_published: [], skipped_changed: [],
    });
  });

  it('leaves published open shifts for employees (D8)', async () => {
    await employee('E1', 'Ana Lim');
    const id = await open('2026-10-20T09:00:00+08:00', '2026-10-20T13:00:00+08:00');
    expect((await h.call('POST', '/api/publications', { shift_ids: [id] })).status).toBe(201);

    const { status, body } = await autoPlan();
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toEqual({ filled: [], unfilled: [], skipped_published: [id], skipped_changed: [] });
    expect((await row(id)).employeeRef).toBeNull();
  });

  it('leaves shifts that started or start outside the period alone', async () => {
    await employee('E1', 'Ana Lim');
    await open('2026-10-26T09:00:00+08:00', '2026-10-26T13:00:00+08:00'); // the Monday after
    const started = await open('2026-10-13T09:00:00+08:00', '2026-10-13T13:00:00+08:00'); // the harness clock is 10:00 that day

    const { body } = await h.call('POST', '/api/auto-plans', { from: '2026-10-13', to: '2026-10-25' });
    expect(body).toEqual({ filled: [], unfilled: [], skipped_published: [], skipped_changed: [] });
    expect((await row(started)).employeeRef).toBeNull();
  });

  it('detaches a series occurrence it assigns (D13)', async () => {
    await employee('E1', 'Ana Lim');
    const { status, body: created } = await h.call('POST', '/api/shifts', {
      employee_ref: null, role_id: tech, start_at: '2026-10-19T09:00:00+08:00', end_at: '2026-10-19T13:00:00+08:00',
      repeat: { interval: 1, unit: 'day', ends: 'after', count: 2 },
    });
    expect(status, JSON.stringify(created)).toBe(201);

    const { body } = await autoPlan();
    expect(body.filled.length).toBe(2);
    for (const f of body.filled as { shift_id: string }[]) {
      const r = await row(f.shift_id);
      expect([r.employeeRef, r.recurrenceId, r.recurrenceDetached, r.state]).toEqual(['E1', created.recurrence.id, true, 'draft']);
    }
  });

  it('skips a shift changed in the meantime (D14)', async () => {
    await employee('E1', 'Ana Lim');
    const changed = await open('2026-10-20T09:00:00+08:00', '2026-10-20T13:00:00+08:00');
    const kept = await open('2026-10-21T09:00:00+08:00', '2026-10-21T13:00:00+08:00');
    // A manager saves the shift on another connection after Auto Plan read it and before it writes.
    const assign = ShiftRepository.prototype.assign;
    vi.spyOn(ShiftRepository.prototype, 'assign').mockImplementation(async function (this: ShiftRepository, id, ...rest) {
      if (id === changed) await h.database.db.update(shifts).set({ note: 'Edited', version: sql`${shifts.version} + 1` }).where(eq(shifts.id, id));
      return assign.call(this, id, ...rest);
    });

    const { status, body } = await autoPlan();
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toEqual({ filled: [{ shift_id: kept, employee_ref: 'E1' }], unfilled: [], skipped_published: [], skipped_changed: [changed] });
    expect(await row(changed)).toMatchObject({ employeeRef: null, note: 'Edited' });
  });

  it('waits for a claim in progress, then plans around it (BR-02)', async () => {
    await employee('E1', 'Ana Lim');
    const draft = await open('2026-10-20T09:00:00+08:00', '2026-10-20T13:00:00+08:00');
    const published = await open('2026-10-20T10:00:00+08:00', '2026-10-20T12:00:00+08:00');
    expect((await h.call('POST', '/api/publications', { shift_ids: [published] })).status).toBe(201);

    // E1 is claiming the overlapping published shift: the claim holds E1's employee lock and commits while Auto Plan waits for it.
    const { status, body } = await whileLocked(h.database, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${ORG}:E1`]);
      await client.query('update shifts set employee_ref = $1, version = version + 1 where id = $2', ['E1', published]);
    }, () => autoPlan(), 1);

    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.filled).toEqual([]);
    expect(body.unfilled).toEqual([{ shift_id: draft, reason_code: 'busy_or_away', reason: 'Everyone with this role is busy or away then' }]);
    expect((await row(draft)).employeeRef).toBeNull();
  });

  it('lets only one run at a time', async () => {
    await employee('E1', 'Ana Lim');
    const id = await open('2026-10-20T09:00:00+08:00', '2026-10-20T13:00:00+08:00');
    const client = await h.database.pool.connect();
    try {
      await client.query('select pg_advisory_lock(hashtext($1))', [`${ORG}:auto-plan`]);
      const { status, body } = await autoPlan();
      expect(status, JSON.stringify(body)).toBe(409);
      expect(body.error.code).toBe('AUTO_PLAN_RUNNING');
      expect((await row(id)).employeeRef).toBeNull();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [`${ORG}:auto-plan`]);
      client.release();
    }
  });

  it('validates the period like the schedule', async () => {
    const { status, body } = await autoPlan({ from: '2026-10-19', to: '2026-12-31' });
    expect(status).toBe(422);
    expect(body.error.details).toHaveProperty('to');
    expect((await autoPlan({ from: '2026-10-19', to: '2026-10-25', timezone: 'Nowhere/Land' })).status).toBe(422);
  });

  it('is for managers only', async () => {
    h.asEmployee('E1');
    const { status } = await autoPlan();
    expect(status).toBe(403);
  });
});
