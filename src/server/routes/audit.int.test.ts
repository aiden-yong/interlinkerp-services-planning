import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditEntries, employeeDirectory, shifts } from '../db/schema';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const M = 'm@x.com';
const ANA = ['E1', 'ana@example.com'] as const;
const BO = ['E2', 'bo@example.com'] as const;

beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
  await h.addEmployee('E2', 'Bo Tan');
  h.asManager(M);
});

async function create(body: Record<string, unknown> = {}): Promise<string> {
  const { status, body: res } = await h.call('POST', '/api/shifts', {
    employee_ref: 'E1', start_at: '2026-10-20T09:00:00+08:00', end_at: '2026-10-20T17:00:00+08:00', acknowledge_conflicts: true, ...body,
  });
  expect(status, JSON.stringify(res)).toBe(201);
  return res.shift.id as string;
}

async function publish(id: string): Promise<void> {
  expect((await h.call('POST', '/api/publications', { shift_ids: [id] })).status).toBe(201);
}

async function history(id: string) {
  h.asManager(M);
  const { status, body } = await h.call('GET', `/api/shifts/${id}/history`);
  expect(status, JSON.stringify(body)).toBe(200);
  return body.entries as { action: string; actor: string | null; actor_kind: string; actor_name: string; changes: Record<string, unknown> | null; at: string }[];
}

const actions = async (id: string) => (await history(id)).map((e) => e.action);

describe('audit trail (DR-04)', () => {
  it('records who created, changed, published and deleted a shift (DR-04)', async () => {
    const id = await create();
    expect((await h.call('PATCH', `/api/shifts/${id}`, { version: 1, note: 'Bring keys' })).status).toBe(200);
    await publish(id);
    expect((await h.call('DELETE', `/api/shifts/${id}`)).status).toBe(204);

    const entries = await history(id);
    expect(entries.map((e) => e.action)).toEqual(['deleted', 'published', 'changed', 'created']);
    for (const e of entries) expect(e).toMatchObject({ actor: M, actor_kind: 'manager', actor_name: M, at: '2026-10-13T02:00:00Z' });
    expect(entries[2]!.changes).toEqual({ note: [null, 'Bring keys'] });
    expect(entries[3]!.changes).toBeNull();
  });

  it('records a conflict acknowledgement on its own as a change by the manager', async () => {
    const id = await create({ acknowledge_conflicts: false });
    expect((await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: '2026-10-20T00:00:00+08:00', end_at: '2026-10-21T00:00:00+08:00', reason: 'Annual leave' })).status).toBe(201);
    expect((await h.call('PATCH', `/api/shifts/${id}`, { version: 1 })).status).toBe(409);
    const ok = await h.call('PATCH', `/api/shifts/${id}`, { version: 1, acknowledge_conflicts: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await history(id))[0]).toMatchObject({ action: 'changed', actor: M, actor_kind: 'manager', changes: { conflict_acknowledged: [false, true] } });
  });

  it('records employee actions under the employee', async () => {
    const id = await create({ employee_ref: null });
    await publish(id);
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/shift-claims', { shift_id: id })).status).toBe(201);

    const [claimed] = await history(id);
    expect(claimed).toMatchObject({ action: 'claimed', actor: 'E1', actor_kind: 'employee', actor_name: 'Ana Lim', changes: { employee_ref: [null, 'E1'] } });
  });

  it('records switch requests, take-overs and give-ups under the employee', async () => {
    const swapped = await create();
    await publish(swapped);
    expect((await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: swapped })).status).toBe(201);
    expect((await h.callAs(...ANA, 'DELETE', `/api/switch-requests/${swapped}`)).status).toBe(204);
    expect((await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: swapped })).status).toBe(201);
    expect((await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: swapped })).status).toBe(201);
    const entries = await history(swapped);
    expect(entries.map((e) => [e.action, e.actor, e.actor_kind])).toEqual([
      ['taken_over', 'E2', 'employee'], ['switch_requested', 'E1', 'employee'], ['switch_cancelled', 'E1', 'employee'],
      ['switch_requested', 'E1', 'employee'], ['published', M, 'manager'], ['created', M, 'manager'],
    ]);
    expect(entries[0]!.changes).toEqual({ employee_ref: ['E1', 'E2'] });
    expect(entries[0]!.actor_name).toBe('Bo Tan');

    const given = await create({ start_at: '2026-10-28T09:00:00+08:00', end_at: '2026-10-28T17:00:00+08:00' });
    await publish(given);
    expect((await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign' })).status).toBe(200);
    expect((await h.callAs(...ANA, 'POST', '/api/unassignments', { shift_id: given })).status).toBe(201);
    expect((await history(given))[0]).toMatchObject({ action: 'unassigned', actor: 'E1', actor_kind: 'employee', changes: { employee_ref: ['E1', null] } });
  });

  it('records the switch requests a change to Unassign cancels under the manager (BR-07)', async () => {
    const id = await create();
    await publish(id);
    expect((await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id })).status).toBe(201);
    expect((await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign' })).status).toBe(200);
    expect((await history(id))[0]).toMatchObject({ action: 'switch_cancelled', actor: M, actor_kind: 'manager', changes: null });
  });

  it('records splits, the new part and undone deletions', async () => {
    const id = await create();
    const { status, body } = await h.call('POST', '/api/shift-splits', { shift_id: id, version: 1, at: '2026-10-20T13:00:00+08:00' });
    expect(status, JSON.stringify(body)).toBe(201);
    expect((await history(id))[0]).toMatchObject({ action: 'split', actor: M, changes: { end_at: ['2026-10-20T09:00:00Z', '2026-10-20T05:00:00Z'] } });
    expect(await actions(body.shifts[1].id)).toEqual(['created']);

    expect((await h.call('DELETE', `/api/shifts/${id}`)).status).toBe(204);
    expect((await h.call('POST', '/api/shift-restorations', { shift_id: id })).status).toBe(201);
    expect(await actions(id)).toEqual(['restored', 'deleted', 'split', 'created']);
  });

  it('records series generation by the manager, series edits per shift, and generation by the system', async () => {
    const START = Date.parse('2026-10-13T02:00:00Z');
    h.clock.advance(Math.round((Date.parse('2026-01-01T02:00:00Z') - START) / 1000));
    const created = await h.call('POST', '/api/shifts', {
      employee_ref: 'E1', start_at: '2026-01-02T09:00:00+08:00', end_at: '2026-01-02T17:00:00+08:00', repeat: { interval: 1, unit: 'week', ends: 'never' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const seriesId = created.body.recurrence.id as string;
    const rows = async () => (await h.database.db.select().from(shifts).where(eq(shifts.recurrenceId, seriesId))).sort((a, b) => a.recurrenceIndex! - b.recurrenceIndex!);
    const original = await rows();
    expect(await actions(original[0]!.id)).toEqual(['created']);
    expect((await history(original[1]!.id)).map((e) => [e.action, e.actor, e.actor_kind])).toEqual([['generated', M, 'manager']]);

    const patched = await h.call('PATCH', `/api/shifts/${original[1]!.id}`, { version: 1, note: 'Bring keys', scope: 'following' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await history(original[2]!.id))[0]).toMatchObject({ action: 'changed', actor: M, changes: { note: [null, 'Bring keys'] } });
    expect((await actions(original[1]!.id))).toEqual(['changed', 'generated']);

    h.clock.advance(31 * 24 * 3600);
    await h.app.recurrences().extendAll(h.clock.now());
    const extended = (await rows()).filter((r) => !original.some((o) => o.id === r.id));
    expect(extended.length).toBeGreaterThan(0);
    for (const row of extended) {
      expect(await history(row.id)).toEqual([{ action: 'generated', actor: 'system', actor_kind: 'system', actor_name: 'System', changes: null, at: '2026-02-01T02:00:00Z' }]);
    }

    expect((await h.call('DELETE', `/api/shifts/${extended[0]!.id}`, undefined, { scope: 'following' })).status).toBe(200);
    expect(await actions(extended[0]!.id)).toEqual(['deleted', 'generated']);
  });

  it('records Auto Plan and week copies', async () => {
    const tech = await h.addRole('Technician');
    const day = [['09:00', '17:00']];
    expect((await h.call('PATCH', '/api/employees/E1', { role_ids: [tech], working_hours: { mon: day, tue: day, wed: day, thu: day, fri: day } })).status).toBe(200);
    const open = await create({ employee_ref: null, role_id: tech, start_at: '2026-10-20T09:00:00+08:00', end_at: '2026-10-20T13:00:00+08:00' });
    const plan = await h.call('POST', '/api/auto-plans', { from: '2026-10-19', to: '2026-10-25' });
    expect(plan.body.filled, JSON.stringify(plan.body)).toEqual([{ shift_id: open, employee_ref: 'E1' }]);
    expect((await history(open))[0]).toMatchObject({ action: 'auto_planned', actor: M, actor_kind: 'manager', changes: { employee_ref: [null, 'E1'] } });

    const copied = await h.call('POST', '/api/week-copies', { week_start: '2026-10-26' });
    expect(copied.body.created, JSON.stringify(copied.body)).toBe(1);
    const [copy] = await h.database.db.select().from(shifts).where(eq(shifts.copiedFrom, open));
    expect((await history(copy!.id)).map((e) => [e.action, e.actor, e.changes])).toEqual([['copied', M, null]]);
  });

  it('keeps history of a deleted shift', async () => {
    const id = await create();
    expect((await h.call('DELETE', `/api/shifts/${id}`)).status).toBe(204);
    h.clock.advance(60);
    expect(await actions(id)).toEqual(['deleted', 'created']);
    expect((await h.call('GET', '/api/shifts/00000000-0000-4000-8000-000000000000/history')).status).toBe(404);
    expect((await h.call('GET', '/api/shifts/not-a-uuid/history')).status).toBe(404);
  });

  it('names employees no longer in the directory, and back-filled entries without an actor', async () => {
    const id = await create({ employee_ref: null });
    await publish(id);
    expect((await h.callAs(...ANA, 'POST', '/api/shift-claims', { shift_id: id })).status).toBe(201);
    await h.database.db.delete(employeeDirectory).where(eq(employeeDirectory.employeeRef, 'E1'));
    await h.database.db.insert(auditEntries).values({ organisationId: ORG, shiftId: id, action: 'published', actor: null, actorKind: 'system', at: new Date('2026-10-01T00:00:00Z') });
    const entries = await history(id);
    expect(entries[0]).toMatchObject({ action: 'claimed', actor: 'E1', actor_name: 'Unknown employee' });
    expect(entries.at(-1)).toEqual({ action: 'published', actor: null, actor_kind: 'system', actor_name: 'Unknown', changes: null, at: '2026-10-01T00:00:00Z' });
  });

  it('is for managers only', async () => {
    const id = await create();
    h.asEmployee('E1');
    const { status } = await h.call('GET', `/api/shifts/${id}/history`);
    expect(status).toBe(403);
  });
});
