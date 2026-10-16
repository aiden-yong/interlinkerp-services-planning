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
    expect([status, body]).toEqual([201, { published: 4, employees_notified: 2, open_shift_notices: 0 }]);

    const rows = await new Outbox(h.database.db, ORG).all();
    expect(rows.map((r) => r.employee_ref).sort()).toEqual(['E1', 'E2']);
    expect(rows.find((r) => r.employee_ref === 'E1')!.payload).toEqual({ shift_ids: [ids[0], ids[1]] });
    expect((await h.call('GET', `/api/shifts/${ids[0]}`)).body.shift.state).toBe('published');
    expect((await h.call('POST', '/api/publications', { shift_ids: ids })).body).toEqual({ published: 0, employees_notified: 0, open_shift_notices: 0 });
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

describe('publishing open shifts (FR-PUB-03)', () => {
  it('sends each eligible employee one notice listing their open shifts (Review Focus 5)', async () => {
    await h.addEmployee('E3', 'Cy Ong');
    const nurse = await h.addRole('Nurse');
    await h.call('PATCH', '/api/employees/E1', { role_ids: [nurse] });
    await h.call('PATCH', '/api/employees/E3', { role_ids: [nurse] });
    await h.call('POST', '/api/unavailabilities', { employee_ref: 'E3', start_at: '2026-10-14T00:00:00+08:00', end_at: '2026-10-16T00:00:00+08:00' });
    const ids: string[] = [];
    for (const day of ['14', '15']) {
      ids.push((await h.call('POST', '/api/shifts', { employee_ref: null, role_id: nurse, start_at: `2026-10-${day}T09:00:00+08:00`, end_at: `2026-10-${day}T17:00:00+08:00` })).body.shift.id);
    }
    const { status, body } = await h.call('POST', '/api/publications', { shift_ids: ids, notify_open_shifts: true });
    expect(status).toBe(201);
    expect(body).toEqual({ published: 2, employees_notified: 0, open_shift_notices: 1 });
    const notices = (await new Outbox(h.database.db, ORG).all()).filter((r) => r.kind === 'open_shifts_available');
    expect(notices.map((r) => [r.employee_ref, r.payload])).toEqual([['E1', { shift_ids: ids }]]); // E2 lacks the role, E3 is away
  });

  it('skips employees with an overlapping shift or time off, and open shifts that have started', async () => {
    await h.addEmployee('E3', 'Cy Ong');
    const nurse = await h.addRole('Nurse');
    for (const ref of ['E1', 'E2', 'E3']) await h.call('PATCH', `/api/employees/${ref}`, { role_ids: [nurse] });
    await shift('E1', '2026-10-14'); // E1 already works the 14th (left as a draft)
    await h.call('POST', '/api/unavailabilities', { employee_ref: 'E2', start_at: '2026-10-14T00:00:00+08:00', end_at: '2026-10-15T00:00:00+08:00' });
    const open = (await h.call('POST', '/api/shifts', { employee_ref: null, role_id: nurse, start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' })).body.shift.id;
    // The clock is 2026-10-13 10:00 +08:00, so this open shift has already started.
    const started = (await h.call('POST', '/api/shifts', { employee_ref: null, role_id: nurse, start_at: '2026-10-13T08:00:00+08:00', end_at: '2026-10-13T16:00:00+08:00' })).body.shift.id;
    const { body } = await h.call('POST', '/api/publications', { shift_ids: [open, started], notify_open_shifts: true });
    expect(body).toEqual({ published: 2, employees_notified: 0, open_shift_notices: 1 });
    const notices = (await new Outbox(h.database.db, ORG).all()).filter((r) => r.kind === 'open_shifts_available');
    expect(notices.map((r) => [r.employee_ref, r.payload])).toEqual([['E3', { shift_ids: [open] }]]);
  });

  it('notifies only people on the roster: not a manager who is no employee, nor a profile without a directory row', async () => {
    const nurse = await h.addRole('Nurse');
    await h.app.profiles().save({ ...(await h.app.profiles().find('E9')), roleIds: [nurse] }, h.clock.now()); // roles, but not in the directory
    h.asManager('mona@example.com'); // a manager with no employee ref
    const id = (await h.call('POST', '/api/shifts', { employee_ref: null, start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' })).body.shift.id;
    expect((await h.call('POST', '/api/publications', { shift_ids: [id], notify_open_shifts: true })).body.open_shift_notices).toBe(2);
    const notices = (await new Outbox(h.database.db, ORG).all()).filter((r) => r.kind === 'open_shifts_available');
    expect(notices.map((r) => r.employee_ref)).toEqual(['E1', 'E2']);
  });

  it('sends nothing about open shifts unless asked, and validates the flag', async () => {
    const id = await shift(null, '2026-10-14');
    expect((await h.call('POST', '/api/publications', { shift_ids: [id], notify_open_shifts: 'yes' })).status).toBe(422);
    expect((await h.call('POST', '/api/publications', { shift_ids: [id] })).body.open_shift_notices).toBe(0);
  });
});
