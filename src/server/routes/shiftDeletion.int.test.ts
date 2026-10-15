import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { shifts } from '../db/schema';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(() => h.addEmployee('E1', 'Ana Lim'));
const outbox = () => new Outbox(h.database.db, ORG).all();

async function shift(published = false) {
  const { body } = await h.call('POST', '/api/shifts', { employee_ref: 'E1', start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' });
  if (published) await h.database.db.update(shifts).set({ state: 'published' }).where(eq(shifts.id, body.shift.id));
  return body.shift;
}

describe('delete, undo and duplicate', () => {
  it('deletes a draft without telling anyone', async () => {
    const s = await shift();
    expect((await h.call('DELETE', `/api/shifts/${s.id}`)).status).toBe(204);
    expect((await h.call('GET', `/api/shifts/${s.id}`)).status).toBe(404);
    expect(await outbox()).toEqual([]);
    expect((await h.call('DELETE', `/api/shifts/${s.id}`)).status).toBe(404);
  });

  it('undo within the window restores the shift and cancels the notice (FR-SHF-07 AC1)', async () => {
    const s = await shift(true);
    await h.call('DELETE', `/api/shifts/${s.id}`);
    expect((await outbox())[0]).toMatchObject({ kind: 'shift_deleted', deliver_after: '2026-10-13T02:00:30Z', cancelled: false });

    h.clock.advance(10);
    const { status, body } = await h.call('POST', '/api/shift-restorations', { shift_id: s.id });
    expect([status, body.shift.id]).toEqual([201, s.id]);
    expect((await h.call('GET', `/api/shifts/${s.id}`)).status).toBe(200);
    expect((await outbox())[0].cancelled).toBe(true);
  });

  it('refuses undo after the window and for shifts that were not deleted', async () => {
    const s = await shift();
    expect((await h.call('POST', '/api/shift-restorations', { shift_id: s.id })).status).toBe(404);
    await h.call('DELETE', `/api/shifts/${s.id}`);
    h.clock.advance(31);
    expect((await h.call('POST', '/api/shift-restorations', { shift_id: s.id })).body.error.code).toBe('UNDO_EXPIRED');
  });

  it('treats exactly 30 seconds as expired', async () => {
    const s = await shift();
    await h.call('DELETE', `/api/shifts/${s.id}`);
    h.clock.advance(30);
    const res = await h.call('POST', '/api/shift-restorations', { shift_id: s.id });
    expect([res.status, res.body.error.code]).toEqual([409, 'UNDO_EXPIRED']);
  });

  it('leaves the deletion notice pending when an undo is too late', async () => {
    const s = await shift(true);
    await h.call('DELETE', `/api/shifts/${s.id}`);
    h.clock.advance(31);
    expect((await h.call('POST', '/api/shift-restorations', { shift_id: s.id })).status).toBe(409);
    expect(await outbox()).toHaveLength(1);
    expect((await outbox())[0].cancelled).toBe(false);
  });

  it('a second delete of a published shift is a 404 and queues one notice', async () => {
    const s = await shift(true);
    expect((await h.call('DELETE', `/api/shifts/${s.id}`)).status).toBe(204);
    expect((await h.call('DELETE', `/api/shifts/${s.id}`)).status).toBe(404);
    expect(await outbox()).toHaveLength(1);
  });

  it('duplicates to the next day as a draft', async () => {
    const s = await shift(true);
    const { status, body } = await h.call('POST', '/api/shifts', { duplicate_of: s.id });
    expect(status).toBe(201);
    expect(body.shift).toMatchObject({ state: 'draft', employee_ref: 'E1', start_at: '2026-10-15T01:00:00Z', end_at: '2026-10-15T09:00:00Z' });
    expect(body.shift.id).not.toBe(s.id);
  });

  it('duplicates to the same wall-clock time across a DST change', async () => {
    await h.call('PATCH', '/api/settings', { timezone: 'America/New_York' });
    const { body: created } = await h.call('POST', '/api/shifts', { employee_ref: 'E1', start_at: '2026-03-07T09:00:00-05:00', end_at: '2026-03-07T17:00:00-05:00' });
    const { status, body } = await h.call('POST', '/api/shifts', { duplicate_of: created.shift.id });
    expect(status, JSON.stringify(body)).toBe(201);
    // 2026-03-08 is the day US clocks go forward: 09:00 EDT is 13:00Z.
    expect([body.shift.start_at, body.shift.end_at]).toEqual(['2026-03-08T13:00:00Z', '2026-03-08T21:00:00Z']);
  });

  it('warns when the copy lands on top of the original', async () => {
    const s = await shift();
    const clash = { duplicate_of: s.id, start_at: '2026-10-14T10:00:00+08:00' };
    expect((await h.call('POST', '/api/shifts', clash)).body.error.code).toBe('SHIFT_CONFLICT');
    const { status, body } = await h.call('POST', '/api/shifts', { ...clash, acknowledge_conflicts: true });
    expect([status, body.shift.start_at, body.shift.end_at]).toEqual([201, '2026-10-14T02:00:00Z', '2026-10-14T10:00:00Z']);
  });

  it('404s when duplicating a missing shift', async () => {
    expect((await h.call('POST', '/api/shifts', { duplicate_of: 'nope' })).status).toBe(404);
  });
});
