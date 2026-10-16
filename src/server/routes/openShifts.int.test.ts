import { describe, expect, it } from 'vitest';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const WEEK = { from: '2026-10-12', to: '2026-10-18' };
const outbox = () => new Outbox(h.database.db, ORG).all();

/** Creates and publishes a shift as the manager; returns its id. The clock is 2026-10-13T02:00Z (Tue 10:00 in Kuala Lumpur). */
async function published(employeeRef: string | null, start: string, end: string, roleId: string | null = null): Promise<string> {
  h.asManager();
  const created = await h.call('POST', '/api/shifts', { employee_ref: employeeRef, role_id: roleId, start_at: start, end_at: end, acknowledge_conflicts: true });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const done = await h.call('POST', '/api/publications', { shift_ids: [created.body.shift.id] });
  expect(done.status).toBe(201);
  return created.body.shift.id as string;
}

describe('open shifts', () => {
  it('lists published open shifts the employee is eligible for (FR-OPN-01, BR-05)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const nurse = await h.addRole('Nurse');
    const free = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    await published(null, '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00', nurse); // E1 lacks the role
    h.asEmployee('E1');
    const { status, body } = await h.call('GET', '/api/my/open-shifts', undefined, WEEK);
    expect(status).toBe(200);
    expect(body.open.map((s: { id: string }) => s.id)).toEqual([free]);
    expect(body.up_for_switch).toEqual([]);
    expect(body.give_up).toEqual({ mode: 'switch', window_days: 2 });
  });

  it('assigns a claimed shift, keeps it published and tells the managers (FR-OPN-02 AC1)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    h.asEmployee('E1');
    const { status, body } = await h.call('POST', '/api/shift-claims', { shift_id: id });
    expect(status).toBe(201);
    expect(body.shift.id).toBe(id);
    h.asManager();
    expect((await h.call('GET', `/api/shifts/${id}`)).body.shift).toMatchObject({ employee_ref: 'E1', state: 'published' });
    expect((await outbox()).filter((r) => r.kind === 'shift_claimed')).toEqual([
      expect.objectContaining({ employee_ref: null, subject_id: id, payload: { shift_id: id, employee_ref: 'E1' } }),
    ]);
  });

  it('refuses a claim that breaks BR-01, with the reason (FR-OPN-02 AC2)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await published('E1', '2026-10-14T08:00:00+08:00', '2026-10-14T12:00:00+08:00');
    const id = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    h.asEmployee('E1');
    const { status, body } = await h.call('POST', '/api/shift-claims', { shift_id: id });
    expect(status).toBe(409);
    expect(body.error.code).toBe('NOT_ELIGIBLE');
    expect(body.error.details.reasons[0].rule).toBe('overlap');
  });

  it('refuses a claim for a role the employee does not have', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00', await h.addRole('Nurse'));
    h.asEmployee('E1');
    const { body } = await h.call('POST', '/api/shift-claims', { shift_id: id });
    expect([body.error.code, body.error.details.reasons[0].rule]).toEqual(['NOT_ELIGIBLE', 'role']);
  });

  it('lets employees claim an open shift on a public holiday (BR-05 v0.4)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.call('POST', '/api/holidays', { date: '2026-10-14', name: 'Company Day' });
    const id = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/my/open-shifts', undefined, WEEK)).body.open.map((s: { id: string }) => s.id)).toEqual([id]);
    expect((await h.call('POST', '/api/shift-claims', { shift_id: id })).status).toBe(201);
  });

  it('refuses a claim during the employee\'s own time off', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: '2026-10-14T00:00:00+08:00', end_at: '2026-10-15T00:00:00+08:00', reason: 'Leave' });
    const id = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/my/open-shifts', undefined, WEEK)).body.open).toEqual([]);
    const { body } = await h.call('POST', '/api/shift-claims', { shift_id: id });
    expect([body.error.code, body.error.details.reasons[0].rule]).toEqual(['NOT_ELIGIBLE', 'unavailable']);
  });

  it('lets exactly one of two simultaneous claims win (FR-OPN-02 AC3, NFR-04)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    const results = await Promise.all([
      h.callAs('E1', 'ana@example.com', 'POST', '/api/shift-claims', { shift_id: id }),
      h.callAs('E2', 'bo@example.com', 'POST', '/api/shift-claims', { shift_id: id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SHIFT_TAKEN');
  });

  it('never gives one employee two overlapping shifts claimed at the same moment', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const a = await published(null, '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    const b = await published(null, '2026-10-14T12:00:00+08:00', '2026-10-14T20:00:00+08:00');
    const results = await Promise.all([
      h.callAs('E1', 'ana@example.com', 'POST', '/api/shift-claims', { shift_id: a }),
      h.callAs('E1', 'ana@example.com', 'POST', '/api/shift-claims', { shift_id: b }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('refuses started shifts, drafts, unknown ids and people off the roster (FR-OPN-05)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const soon = await published(null, '2026-10-13T11:00:00+08:00', '2026-10-13T15:00:00+08:00');
    h.clock.advance(2 * 3600); // now 12:00 local: started
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/shift-claims', { shift_id: soon })).body.error.code).toBe('SHIFT_STARTED');
    h.asManager();
    const draft = (await h.call('POST', '/api/shifts', { employee_ref: null, start_at: '2026-10-16T09:00:00+08:00', end_at: '2026-10-16T17:00:00+08:00' })).body.shift.id;
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/shift-claims', { shift_id: draft })).status).toBe(404);
    expect((await h.call('POST', '/api/shift-claims', { shift_id: 'nope' })).status).toBe(404);
    expect((await h.call('POST', '/api/shift-claims', {})).status).toBe(422);
    h.asEmployee(null);
    expect((await h.call('POST', '/api/shift-claims', { shift_id: soon })).body.error.code).toBe('NOT_ON_ROSTER');
  });
});
