import { beforeEach, describe, expect, it } from 'vitest';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
  await h.addEmployee('E2', 'Bo Tan');
});

async function shift(ref: string | null, day: string): Promise<string> {
  const { status, body } = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: `${day}T09:00:00+08:00`, end_at: `${day}T17:00:00+08:00` });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.shift.id;
}

describe('publishing (FR-PUB-01, FR-PUB-02) and My Planning (FR-MYP-01)', () => {
  it('publishes and queues one notice per employee', async () => {
    const ids = [await shift('E1', '2026-10-14'), await shift('E1', '2026-10-15'), await shift('E2', '2026-10-14'), await shift(null, '2026-10-16')];
    const { status, body } = await h.call('POST', '/api/publications', { shift_ids: ids });
    expect([status, body]).toEqual([201, { published: 4, employees_notified: 2 }]);

    const rows = await new Outbox(h.database.db, ORG).all();
    expect(rows.map((r) => r.employee_ref).sort()).toEqual(['E1', 'E2']);
    expect(rows.find((r) => r.employee_ref === 'E1')!.payload).toEqual({ shift_ids: [ids[0], ids[1]] });
    expect((await h.call('GET', `/api/shifts/${ids[0]}`)).body.shift.state).toBe('published');
    expect((await h.call('POST', '/api/publications', { shift_ids: ids })).body).toEqual({ published: 0, employees_notified: 0 });
  });

  it('needs a non-empty list', async () => {
    expect((await h.call('POST', '/api/publications', { shift_ids: [] })).status).toBe(422);
    expect((await h.call('POST', '/api/publications', {})).status).toBe(422);
  });

  it('shows employees only their own published, live shifts', async () => {
    const mine = await shift('E1', '2026-10-14');
    const draft = await shift('E1', '2026-10-15');
    const theirs = await shift('E2', '2026-10-14');
    const deleted = await shift('E1', '2026-10-16');
    await h.call('POST', '/api/publications', { shift_ids: [mine, theirs, deleted] });
    await h.call('DELETE', `/api/shifts/${deleted}`);

    h.asEmployee('E1');
    const { status, body } = await h.call('GET', '/api/my/shifts', undefined, { from: '2026-10-12', to: '2026-10-18' });
    expect(status).toBe(200);
    expect(body.shifts.map((s: { id: string }) => s.id)).toEqual([mine]);
    expect(body.shifts.map((s: { id: string }) => s.id)).not.toContain(draft);
    expect(body.timezone).toBe('Asia/Kuala_Lumpur');
    expect(Object.keys(body.shifts[0])).toEqual(['id', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_hours', 'note', 'switch_requested']);
  });

  it('turns away people who are not on the roster, and stops employees publishing', async () => {
    h.asEmployee(null, 'visitor@example.com');
    expect((await h.call('GET', '/api/my/shifts', undefined, { from: '2026-10-12', to: '2026-10-18' })).body.error.code).toBe('NOT_ON_ROSTER');
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/publications', { shift_ids: ['x'] })).status).toBe(403);
  });
});
