import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { shifts } from '../db/schema';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
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

const split = (shiftId: string, version: number, at: string) => h.call('POST', '/api/shift-splits', { shift_id: shiftId, version, at });

describe('shift splits API', () => {
  it('splits a draft and keeps the break with the longer part', async () => {
    const shift = await created();
    const { status, body } = await split(shift.id, shift.version, '2026-10-14T11:00:00+08:00');
    expect(status, JSON.stringify(body)).toBe(201);
    const [first, second] = body.shifts;
    expect(first).toMatchObject({
      id: shift.id, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T03:00:00Z', break_minutes: 0,
      employee_ref: 'E1', role_id: shift.role_id, version: 2,
    });
    expect(second).toMatchObject({
      start_at: '2026-10-14T03:00:00Z', end_at: '2026-10-14T09:00:00Z', break_minutes: 60,
      employee_ref: 'E1', role_id: shift.role_id, version: 1,
    });
    expect(second.id).not.toBe(shift.id);
  });

  it('refuses a split too near an edge or outside', async () => {
    const shift = await created();
    const tooEarly = await split(shift.id, shift.version, '2026-10-14T09:10:00+08:00');
    expect([tooEarly.status, tooEarly.body.error.code, tooEarly.body.error.details.at]).toEqual([422, 'SPLIT_OUTSIDE', expect.any(String)]);

    const tooLate = await split(shift.id, shift.version, '2026-10-14T18:00:00+08:00');
    expect([tooLate.status, tooLate.body.error.code]).toEqual([422, 'SPLIT_OUTSIDE']);
  });

  it('refuses when the break does not fit', async () => {
    const shift = await created({ start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T10:00:00+08:00', break_minutes: 40 });
    const { status, body } = await split(shift.id, shift.version, '2026-10-14T09:30:00+08:00');
    expect([status, body.error.code]).toEqual([422, 'BREAK_DOES_NOT_FIT']);
  });

  it('tells the employee once about a published split', async () => {
    const shift = await created();
    await markPublished(shift.id);
    const { status, body } = await split(shift.id, shift.version, '2026-10-14T11:00:00+08:00');
    expect(status, JSON.stringify(body)).toBe(201);
    const [first, second] = body.shifts;
    expect(first.state).toBe('published');
    expect(second.state).toBe('published');
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect([rows[0].kind, rows[0].employee_ref, rows[0].payload]).toEqual(['shift_changed', 'E1', { shift_id: first.id, changed: ['end'] }]);
  });

  it('detaches a series shift it splits', async () => {
    const { status, body } = await h.call('POST', '/api/shifts', {
      employee_ref: 'E1', start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00', break_minutes: 60,
      repeat: { interval: 1, unit: 'week', ends: 'never' },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    const shift = body.shift;
    const res = await split(shift.id, shift.version, '2026-10-14T11:00:00+08:00');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [first, second] = res.body.shifts;

    const firstRow = await h.call('GET', `/api/shifts/${first.id}`);
    expect(firstRow.body.shift.recurrence.detached).toBe(true);
    const secondRow = await h.call('GET', `/api/shifts/${second.id}`);
    expect(secondRow.body.shift.recurrence).toBeNull();
  });

  it('refuses a stale version', async () => {
    const shift = await created();
    const { status, body } = await split(shift.id, shift.version + 1, '2026-10-14T11:00:00+08:00');
    expect([status, body.error.code]).toEqual([409, 'STALE_SHIFT']);
  });
});
