import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { notifications, shifts } from '../db/schema';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';
import { whileLocked } from '../test/races';

/** Backlog items 22 and 31: the worst interleavings, forced with row locks instead of left to timing. */
const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
  await h.addEmployee('E2', 'Bo Tan');
});

async function published(employeeRef: string | null) {
  const { body } = await h.call('POST', '/api/shifts', { employee_ref: employeeRef, start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' });
  await h.call('POST', '/api/publications', { shift_ids: [body.shift.id] });
  return (await h.call('GET', `/api/shifts/${body.shift.id}`)).body.shift as { id: string; version: number };
}

const lockShift = (id: string) => async (client: import('pg').PoolClient) => {
  await client.query('select id from shifts where id = $1 for update', [id]);
};

describe('forced races', () => {
  it('two claims that both saw the shift open: exactly one wins (FR-OPN-02 AC3)', async () => {
    const shift = await published(null);
    const results = await whileLocked(h.database, lockShift(shift.id), () => Promise.all([
      h.callAs('E1', 'ana@example.com', 'POST', '/api/shift-claims', { shift_id: shift.id }),
      h.callAs('E2', 'bo@example.com', 'POST', '/api/shift-claims', { shift_id: shift.id }),
    ]), 2);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SHIFT_TAKEN');
    const [row] = await h.database.db.select().from(shifts).where(eq(shifts.id, shift.id));
    expect(['E1', 'E2']).toContain(row!.employeeRef);
  });

  it('a manager edit and an employee claim of the same open shift: one wins, the other gets a clear 409 (item 31)', async () => {
    const shift = await published(null);
    const results = await whileLocked(h.database, lockShift(shift.id), () => Promise.all([
      h.call('PATCH', `/api/shifts/${shift.id}`, { version: shift.version, note: 'Bring the van' }),
      h.callAs('E1', 'ana@example.com', 'POST', '/api/shift-claims', { shift_id: shift.id }),
    ]), 2);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200 || s === 201)).toHaveLength(1);
    const loser = results.find((r) => r.status === 409);
    expect(loser, JSON.stringify(results.map((r) => r.body))).toBeDefined();
    expect(['STALE_SHIFT', 'SHIFT_TAKEN', 'SHIFT_CHANGED']).toContain(loser!.body.error.code);
  });

  it('undo that loses to the delivery sweep is refused, so nobody is told about a deletion that was undone (item 31)', async () => {
    const shift = await published('E1');
    await h.call('DELETE', `/api/shifts/${shift.id}`);
    h.clock.advance(30); // the notice is due and the undo window is closing: both can act at once
    h.clock.advance(-1);
    const result = await whileLocked(h.database, async (client) => {
      // What the sweep does: lock the due notice and mark it delivered.
      await client.query("select id from notification_outbox where subject_id = $1 and kind = 'shift_deleted' for update", [shift.id]);
      await client.query("update notification_outbox set delivered_at = now() where subject_id = $1 and kind = 'shift_deleted'", [shift.id]);
    }, () => h.call('POST', '/api/shift-restorations', { shift_id: shift.id }), 1);
    expect([result.status, result.body.error?.code]).toEqual([409, 'UNDO_EXPIRED']);
    expect((await h.call('GET', `/api/shifts/${shift.id}`)).status).toBe(404); // still deleted, matching what the employee was told
    expect(await h.database.db.select().from(notifications).where(eq(notifications.organisationId, ORG))).toEqual([]);
  });
});
