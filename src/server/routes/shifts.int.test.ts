import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { shifts } from '../db/schema';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
  await h.addEmployee('E2', 'Bo Tan');
});

const create = (overrides: Record<string, unknown> = {}) =>
  h.call('POST', '/api/shifts', { employee_ref: 'E1', start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00', break_minutes: 60, ...overrides });

async function created(overrides: Record<string, unknown> = {}) {
  const { status, body } = await create(overrides);
  expect(status, JSON.stringify(body)).toBe(201);
  return body.shift;
}

const markPublished = (id: string) => h.database.db.update(shifts).set({ state: 'published', publishedAt: h.clock.now() }).where(eq(shifts.id, id));
const outbox = () => new Outbox(h.database.db, ORG).all();

describe('shifts API', () => {
  it('makes an open draft shift from times alone (FR-SHF-01 AC1)', async () => {
    const { status, body } = await h.call('POST', '/api/shifts', { start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T13:00:00+08:00' });
    expect(status).toBe(201);
    expect(body.shift).toMatchObject({ employee_ref: null, state: 'draft', start_at: '2026-10-14T01:00:00Z', allocated_percent: 100, allocated_hours: 4, version: 1, conflicts: [] });
  });

  it("uses the employee's default role unless a role is sent (FR-SHF-01 AC2)", async () => {
    const tech = await h.addRole('Technician');
    await h.call('PATCH', '/api/employees/E1', { role_ids: [tech], default_role_id: tech });
    expect((await created()).role_id).toBe(tech);
    expect((await created({ role_id: null, start_at: '2026-10-15T09:00:00+08:00', end_at: '2026-10-15T17:00:00+08:00' })).role_id).toBeNull();
  });

  it('accepts an overnight shift as one shift (FR-SHF-04)', async () => {
    const shift = await created({ start_at: '2026-10-14T22:00:00+08:00', end_at: '2026-10-15T06:00:00+08:00', break_minutes: 0 });
    expect([shift.start_at, shift.end_at, shift.allocated_hours]).toEqual(['2026-10-14T14:00:00Z', '2026-10-14T22:00:00Z', 8]);
  });

  it('names every bad field instead of failing (Review Focus 4)', async () => {
    const archived = await h.addRole('Old');
    await h.call('PATCH', `/api/roles/${archived}`, { archived: true });
    const { status, body } = await h.call('POST', '/api/shifts', {
      employee_ref: 'E404', role_id: archived, start_at: '2026-10-14T09:00:00', end_at: '2026-02-30T10:00:00+08:00', allocated_percent: 0,
    });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details).sort()).toEqual(['allocated_percent', 'employee_ref', 'end_at', 'role_id', 'start_at']);
    expect((await create({ end_at: '2026-10-14T08:00:00+08:00' })).body.error.details.end_at).toBe('The shift must end after it starts.');
    expect((await create({ break_minutes: 480 })).body.error.details.break_minutes).toBe('The break must be shorter than the shift.');
    expect((await create({ end_at: '2026-10-22T09:00:00+08:00' })).body.error.details.end_at).toBe('A shift can last at most 7 days.');
  });

  it('warns about time off and saves when acknowledged (FR-SHF-09 AC1)', async () => {
    await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: '2026-10-16T00:00:00+08:00', end_at: '2026-10-17T00:00:00+08:00', reason: 'Annual leave' });
    const friday = { start_at: '2026-10-16T09:00:00+08:00', end_at: '2026-10-16T17:00:00+08:00' };
    const refused = await create(friday);
    expect([refused.status, refused.body.error.code, refused.body.error.details.conflicts[0].rule]).toEqual([409, 'SHIFT_CONFLICT', 'unavailable']);
    const saved = await created({ ...friday, acknowledge_conflicts: true });
    expect(saved.conflict_acknowledged).toBe(true);
    expect(saved.conflicts[0].message).toBe('The employee is on time off: Annual leave.');
  });

  it('treats an overlapping full-time shift as a conflict', async () => {
    await created();
    const { status, body } = await create({ start_at: '2026-10-14T16:00:00+08:00', end_at: '2026-10-14T20:00:00+08:00', break_minutes: 0 });
    expect([status, body.error.details.conflicts[0].rule]).toEqual([409, 'overlap']);
  });

  it('moves a shift and refuses a stale edit (Review Focus 1)', async () => {
    const shift = await created();
    const moved = await h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, start_at: '2026-10-15T09:00:00+08:00', end_at: '2026-10-15T18:00:00+08:00' });
    expect([moved.status, moved.body.shift.start_at, moved.body.shift.version]).toEqual([200, '2026-10-15T01:00:00Z', 2]);

    const stale = await h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, note: 'Bring keys' });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'STALE_SHIFT']);
    expect((await h.call('PATCH', `/api/shifts/${shift.id}`, { note: 'no version' })).status).toBe(422);
  });

  it('tells both employees when a published shift is reassigned (FR-SHF-03 AC1, BR-11)', async () => {
    const shift = await created();
    await markPublished(shift.id);
    const { status, body } = await h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, employee_ref: 'E2' });
    expect([status, body.shift.state]).toEqual([200, 'published']);
    expect((await outbox()).map((r) => [r.kind, r.employee_ref])).toEqual([['shift_unassigned', 'E1'], ['shift_assigned', 'E2']]);
  });

  it('notifies about published changes only', async () => {
    const draft = await created();
    await h.call('PATCH', `/api/shifts/${draft.id}`, { version: 1, note: 'x' });
    expect(await outbox()).toEqual([]);

    const published = await created({ start_at: '2026-10-20T09:00:00+08:00', end_at: '2026-10-20T17:00:00+08:00' });
    await markPublished(published.id);
    await h.call('PATCH', `/api/shifts/${published.id}`, { version: 1, note: 'Bring keys' });
    const [row] = await outbox();
    expect([row.kind, row.payload]).toEqual(['shift_changed', { shift_id: published.id, changed: ['note'] }]);
  });

  it('reads one shift and 404s on unknown ids; employees cannot plan', async () => {
    const shift = await created();
    expect((await h.call('GET', `/api/shifts/${shift.id}`)).body.shift.id).toBe(shift.id);
    expect((await h.call('GET', '/api/shifts/nope')).status).toBe(404);
    expect((await h.call('PATCH', '/api/shifts/nope', { version: 1 })).status).toBe(404);
    h.asEmployee('E1');
    expect((await create()).status).toBe(403);
  });

  it('lets only one of two simultaneous edits with the same version win (Review Focus 1)', async () => {
    const shift = await created();
    const results = await Promise.all([
      h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, note: 'A' }),
      h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, note: 'B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('STALE_SHIFT');
  });

  it('names bad times on edit instead of returning 500 (Review Focus 4)', async () => {
    const shift = await created();
    const url = `/api/shifts/${shift.id}`;
    for (const [patch, field] of [
      [{ end_at: '2026-02-30T10:00:00+08:00' }, 'end_at'],
      [{ start_at: '2026-10-14T09:00:00' }, 'start_at'],
      [{ start_at: '2026-10-14T18:00:00+08:00' }, 'end_at'],
      [{ break_minutes: 480 }, 'break_minutes'],
    ] as const) {
      const r = await h.call('PATCH', url, { version: 1, ...patch });
      expect([r.status, Object.keys(r.body.error.details)]).toEqual([422, [field]]);
    }
  });
});
