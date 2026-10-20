import { describe, expect, it } from 'vitest';
import { App } from '../app';
import { useApiHarness } from '../test/harness';
import { FakeRoster } from '../test/fakes';

/**
 * Backlog item 22: one organisation never sees another's data. Everything is created in the harness organisation,
 * then read through a second App for another organisation on the same database, by the same people.
 */
const h = useApiHarness();
const WEEK = { from: '2026-10-12', to: '2026-10-18' };

describe('organisation isolation', () => {
  it('shows another organisation none of this one\'s data, through every read endpoint', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    const roleId = await h.addRole('Technician');
    const assigned = (await h.call('POST', '/api/shifts', { employee_ref: 'E1', role_id: roleId, start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' })).body.shift;
    const open = (await h.call('POST', '/api/shifts', { employee_ref: null, start_at: '2026-10-15T09:00:00+08:00', end_at: '2026-10-15T17:00:00+08:00' })).body.shift;
    const pub = await h.call('POST', '/api/publications', { shift_ids: [assigned.id, open.id] }); expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect((await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: '2026-10-16T09:00:00+08:00', end_at: '2026-10-16T17:00:00+08:00', reason: 'Leave' })).status).toBe(201);
    expect((await h.call('POST', '/api/holidays', { date: '2026-10-13', name: 'Company Day' })).status).toBe(201);
    h.roster.add('E1', 'Ana Lim', 'ana@example.com');
    expect((await h.call('POST', '/api/managers', { email: 'ana@example.com' })).status).toBe(201);
    expect((await h.call('PATCH', '/api/settings', { timezone: 'Asia/Singapore' })).status).toBe(200);
    await h.app.delivery().deliverDue();

    const other = new App({ ...h.app.deps, organisationId: 'other-org', roster: new FakeRoster() });
    const call = async (path: string, query: Record<string, string> = {}, method = 'GET', body?: unknown) => {
      const qs = new URLSearchParams(query).toString();
      const response = await other.kernel().handle(new Request(`http://localhost${path}${qs ? `?${qs}` : ''}`, {
        method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json().catch(() => null) };
    };

    h.asManager();
    expect((await call('/api/roles')).body.roles).toEqual([]);
    expect((await call('/api/employees')).body.employees).toEqual([]);
    expect((await call('/api/managers')).body.managers).toEqual([]);
    expect((await call('/api/unavailabilities', WEEK)).body.unavailabilities).toEqual([]);
    expect((await call('/api/holidays', { year: '2026' })).body.holidays).toEqual([]);
    expect((await call('/api/settings')).body.settings.timezone).not.toBe('Asia/Singapore');
    const schedule = (await call('/api/schedule', WEEK)).body;
    expect([schedule.shifts, schedule.employees, schedule.roles]).toEqual([[], [], []]);
    for (const shift of [assigned, open]) {
      expect((await call(`/api/shifts/${shift.id}`)).status).toBe(404);
      expect((await call(`/api/shifts/${shift.id}`, {}, 'PATCH', { version: 1, note: 'x' })).status).toBe(404);
      expect((await call(`/api/shifts/${shift.id}`, {}, 'DELETE')).status).toBe(404);
    }
    expect((await call('/api/publications', {}, 'POST', { shift_ids: [assigned.id, open.id] })).body).toMatchObject({ published: 0 });

    h.asEmployee('E1', 'ana@example.com', true);
    expect((await call('/api/my/shifts', WEEK)).body.shifts).toEqual([]);
    expect((await call('/api/my/open-shifts', WEEK)).body.open ?? []).toEqual([]);
    const inbox = (await call('/api/notifications')).body;
    expect([inbox.notifications, inbox.unread_count]).toEqual([[], 0]);
    expect((await call('/api/shift-claims', {}, 'POST', { shift_id: open.id })).status).not.toBe(201);
  });
});
