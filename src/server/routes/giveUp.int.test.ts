import { describe, expect, it } from 'vitest';
import type { Principal } from '../auth/principal';
import { Outbox } from '../repo/outbox';
import { OpenShiftService } from '../scheduling/openShiftService';
import { UnitOfWork } from '../scheduling/unitOfWork';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const WEEK = { from: '2026-10-12', to: '2026-10-25' };
const outbox = () => new Outbox(h.database.db, ORG).all();
const ANA = ['E1', 'ana@example.com'] as const;
const BO = ['E2', 'bo@example.com'] as const;

async function published(employeeRef: string | null, start: string, end: string): Promise<string> {
  h.asManager();
  const created = await h.call('POST', '/api/shifts', { employee_ref: employeeRef, start_at: start, end_at: end, acknowledge_conflicts: true });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await h.call('POST', '/api/publications', { shift_ids: [created.body.shift.id] })).status).toBe(201);
  return created.body.shift.id as string;
}

describe('giving up shifts', () => {
  it('puts a shift up for switch, lets a colleague take it, and tells everyone (FR-OPN-03 AC1)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    const asked = await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    expect(asked.status).toBe(201);
    expect(asked.body.shift.switch_requested).toBe(true);
    h.asEmployee('E2', 'bo@example.com');
    const offered = (await h.call('GET', '/api/my/open-shifts', undefined, WEEK)).body.up_for_switch;
    expect(offered.map((s: { id: string; owner_name: string }) => [s.id, s.owner_name])).toEqual([[id, 'Ana Lim']]);
    const took = await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id });
    expect(took.status).toBe(201);
    expect(took.body.shift.switch_requested).toBe(false);
    h.asManager();
    expect((await h.call('GET', `/api/shifts/${id}`)).body.shift.employee_ref).toBe('E2');
    const notices = (await outbox()).filter((r) => r.subject_id === id && r.kind !== 'schedule_published').map((r) => [r.kind, r.employee_ref]);
    expect(notices).toEqual([['switch_taken', 'E1'], ['shift_assigned', 'E2'], ['shift_switched', null]]);
  });

  it('returns a shift to normal when the request is cancelled (AC2)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    expect((await h.callAs(...ANA, 'DELETE', `/api/switch-requests/${id}`)).status).toBe(204);
    expect((await h.callAs(...ANA, 'DELETE', `/api/switch-requests/${id}`)).body.error.code).toBe('NOT_UP_FOR_SWITCH');
    expect((await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id })).body.error.code).toBe('NOT_UP_FOR_SWITCH');
  });

  it('lets a request lapse when the shift starts; the owner keeps it (AC3, Review Focus 4)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published('E1', '2026-10-13T11:00:00+08:00', '2026-10-13T15:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    h.clock.advance(2 * 3600);
    h.asEmployee('E2', 'bo@example.com');
    expect((await h.call('GET', '/api/my/open-shifts', undefined, WEEK)).body.up_for_switch).toEqual([]);
    expect((await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id })).body.error.code).toBe('SHIFT_STARTED');
    h.asManager();
    expect((await h.call('GET', `/api/shifts/${id}`)).body.shift.employee_ref).toBe('E1');
  });

  it('lets exactly one of two colleagues take a shift (NFR-04)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    await h.addEmployee('E3', 'Cy Ong');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    const results = await Promise.all([
      h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id }),
      h.callAs('E3', 'cy@example.com', 'POST', '/api/switch-takeovers', { shift_id: id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results[0]!.status === 201 ? 'E2' : 'E3';
    h.asManager();
    expect((await h.call('GET', `/api/shifts/${id}`)).body.shift.employee_ref).toBe(winner);
    expect((await outbox()).filter((r) => r.kind === 'shift_switched')).toHaveLength(1);
  });

  it('refuses a take-over by someone with an overlapping shift (NOT_ELIGIBLE)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await published('E2', '2026-10-15T12:00:00+08:00', '2026-10-15T20:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    const refused = await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('NOT_ELIGIBLE');
    h.asManager();
    expect((await h.call('GET', `/api/shifts/${id}`)).body.shift.employee_ref).toBe('E1');
  });

  it('queues switch_taken and shift_switched with who and what (FR-NTF-03)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id });
    const rows = (await outbox()).filter((r) => r.subject_id === id);
    expect(rows.find((r) => r.kind === 'switch_taken')).toMatchObject({ employee_ref: 'E1', payload: { shift_id: id, taker_ref: 'E2' } });
    expect(rows.find((r) => r.kind === 'shift_switched')).toMatchObject({ employee_ref: null, payload: { shift_id: id, from_ref: 'E1', to_ref: 'E2' } });
  });

  it('answers 404 when cancelling a request that is not yours or does not exist', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    expect((await h.callAs(...BO, 'DELETE', `/api/switch-requests/${id}`)).status).toBe(404);
    expect((await h.callAs(...ANA, 'DELETE', '/api/switch-requests/6f1c1d1e-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await h.app.shifts().find(id))!.switchRequestedAt).not.toBeNull();
  });

  it('is only for people on the roster (NOT_ON_ROSTER)', async () => {
    h.asEmployee(null, 'nobody@example.com');
    const id = '6f1c1d1e-0000-4000-8000-000000000000';
    const calls = [
      await h.call('POST', '/api/switch-requests', { shift_id: id }),
      await h.call('DELETE', `/api/switch-requests/${id}`),
      await h.call('POST', '/api/switch-takeovers', { shift_id: id }),
      await h.call('POST', '/api/unassignments', { shift_id: id }),
    ];
    expect(calls.map((c) => [c.status, c.body.error.code])).toEqual(Array(4).fill([403, 'NOT_ON_ROSTER']));
  });

  it('refuses a start exactly N days away and allows any future start when N is 0 (BR-06)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    h.asManager();
    await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign', unassign_window_days: 2 });
    const exactly = await published('E1', '2026-10-15T10:00:00+08:00', '2026-10-15T18:00:00+08:00'); // now + 2 days
    const justAfter = await published('E1', '2026-10-16T10:01:00+08:00', '2026-10-16T18:00:00+08:00');
    expect((await h.callAs(...ANA, 'POST', '/api/unassignments', { shift_id: exactly })).body.error.code).toBe('OUTSIDE_UNASSIGN_WINDOW');
    expect((await h.callAs(...ANA, 'POST', '/api/unassignments', { shift_id: justAfter })).status).toBe(201);
    h.asManager();
    expect((await h.call('PATCH', '/api/settings', { unassign_window_days: 0 })).status).toBe(200);
    expect((await h.callAs(...ANA, 'POST', '/api/unassignments', { shift_id: exactly })).status).toBe(201);
  });

  it('refuses the wrong mode, own shifts and repeated requests', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    expect((await h.callAs(...ANA, 'POST', '/api/unassignments', { shift_id: id })).body.error.code).toBe('MODE_NOT_ACTIVE');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    expect((await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id })).body.error.code).toBe('ALREADY_UP_FOR_SWITCH');
    expect((await h.callAs(...ANA, 'POST', '/api/switch-takeovers', { shift_id: id })).body.error.code).toBe('OWN_SHIFT');
    expect((await h.callAs(...BO, 'POST', '/api/switch-requests', { shift_id: id })).status).toBe(404); // not Bo's shift
  });

  it('never acts on a switch request once the mode is Unassign (BR-07)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    h.asManager();
    await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign' });
    h.asEmployee('E2', 'bo@example.com');
    expect((await h.call('GET', '/api/my/open-shifts', undefined, WEEK)).body.up_for_switch).toEqual([]);
    expect((await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id })).body.error.code).toBe('MODE_NOT_ACTIVE');
  });

  it('unassigns only outside the window, turning the shift into an open shift (FR-OPN-04, BR-06)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    h.asManager();
    await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign', unassign_window_days: 2 });
    const tomorrow = await published('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    const later = await published('E1', '2026-10-17T09:00:00+08:00', '2026-10-17T17:00:00+08:00');
    expect((await h.callAs(...ANA, 'POST', '/api/unassignments', { shift_id: tomorrow })).body.error.code).toBe('OUTSIDE_UNASSIGN_WINDOW');
    expect((await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: later })).body.error.code).toBe('MODE_NOT_ACTIVE');
    const done = await h.callAs(...ANA, 'POST', '/api/unassignments', { shift_id: later });
    expect(done.status).toBe(201);
    h.asManager();
    expect((await h.call('GET', `/api/shifts/${later}`)).body.shift).toMatchObject({ employee_ref: null, state: 'published' });
    expect((await outbox()).filter((r) => r.kind === 'shift_given_up').map((r) => r.payload)).toEqual([{ shift_id: later, employee_ref: 'E1' }]);
  });

  describe('a manager changing the shift while it is being taken over', () => {
    const bo = { kind: 'person', subject: 's', email: 'bo@example.com', name: 'Bo', gatewayRole: 'user', employeeRef: 'E2', isManager: false, scopes: [] } as Principal;

    it('does not reassign a shift that changed after eligibility was checked (SHIFT_CHANGED)', async () => {
      await h.addEmployee('E1', 'Ana Lim');
      await h.addEmployee('E2', 'Bo Tan');
      const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
      await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
      const real = new UnitOfWork(h.database.db, ORG, 'Asia/Kuala_Lumpur');
      const unit = {
        run: (work: Parameters<UnitOfWork['run']>[0]) => real.run(async (scope) => work({
          ...scope,
          shifts: Object.assign(Object.create(scope.shifts), {
            takeOver: async (...args: Parameters<typeof scope.shifts.takeOver>) => {
              const record = (await h.app.shifts().find(id))!;
              await h.app.shifts().update({ ...record, note: 'edited' }, record.version, h.clock.now());
              return scope.shifts.takeOver(...args);
            },
          }),
        })),
      } as unknown as UnitOfWork;
      const a = h.app;
      const service = new OpenShiftService(a.shifts(), a.profiles(), a.roles(), a.directory(), a.settings(), a.eligibility(), unit, a.clock());
      await expect(service.takeOver({ shift_id: id }, bo)).rejects.toMatchObject({ code: 'SHIFT_CHANGED' });
      const after = (await h.app.shifts().find(id))!;
      expect(after.employeeRef).toBe('E1');
      expect(after.switchRequestedAt).not.toBeNull();
    });

    it('loses a take-over that races the mode change to Unassign (BR-07)', async () => {
      await h.addEmployee('E1', 'Ana Lim');
      await h.addEmployee('E2', 'Bo Tan');
      const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
      await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
      const real = new UnitOfWork(h.database.db, ORG, 'Asia/Kuala_Lumpur');
      const unit = {
        run: (work: Parameters<UnitOfWork['run']>[0]) => real.run(async (scope) => work({
          ...scope,
          shifts: Object.assign(Object.create(scope.shifts), {
            takeOver: async (...args: Parameters<typeof scope.shifts.takeOver>) => {
              const current = await h.app.settings().get();
              await h.app.openShifts().applySettings({ ...current, give_up_mode: 'unassign' }, 'admin@example.com');
              return scope.shifts.takeOver(...args);
            },
          }),
        })),
      } as unknown as UnitOfWork;
      const a = h.app;
      const service = new OpenShiftService(a.shifts(), a.profiles(), a.roles(), a.directory(), a.settings(), a.eligibility(), unit, a.clock());
      await expect(service.takeOver({ shift_id: id }, bo)).rejects.toMatchObject({ code: 'NOT_UP_FOR_SWITCH' });
      const after = (await h.app.shifts().find(id))!;
      expect([after.employeeRef, after.switchRequestedAt]).toEqual(['E1', null]);
    });
  });
});

describe('give-up mode changes', () => {
  it('cancels pending switch requests and tells their owners when the mode becomes Unassign (BR-07)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    h.asManager();
    expect((await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign' })).status).toBe(200);
    h.asEmployee('E1');
    const mine = (await h.call('GET', '/api/my/shifts', undefined, WEEK)).body.shifts;
    expect(mine[0].switch_requested).toBe(false);
    expect((await outbox()).filter((r) => r.kind === 'switch_cancelled').map((r) => [r.employee_ref, r.payload])).toEqual([['E1', { shift_id: id }]]);
  });

  it('clears a switch request when a manager reassigns the shift', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    h.asManager();
    const current = (await h.call('GET', `/api/shifts/${id}`)).body.shift;
    expect(current.switch_requested).toBe(true);
    const moved = await h.call('PATCH', `/api/shifts/${id}`, { employee_ref: 'E2', version: current.version });
    expect(moved.body.shift.switch_requested).toBe(false);
  });

  it('keeps the request of a shift that already started and tells only owners of cleared shifts', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const started = await published('E1', '2026-10-13T11:00:00+08:00', '2026-10-13T15:00:00+08:00');
    const future = await published('E2', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: started });
    await h.callAs(...BO, 'POST', '/api/switch-requests', { shift_id: future });
    h.clock.advance(2 * 3600);
    h.asManager();
    await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign' });
    expect((await outbox()).filter((r) => r.kind === 'switch_cancelled').map((r) => [r.employee_ref, r.payload])).toEqual([['E2', { shift_id: future }]]);
    expect((await h.app.shifts().find(started))!.switchRequestedAt).not.toBeNull();
  });

  it('does not let a take-over succeed once the mode has changed to Unassign (BR-07)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    h.asManager();
    await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign' });
    expect((await h.callAs(...BO, 'POST', '/api/switch-takeovers', { shift_id: id })).body.error.code).toBe('MODE_NOT_ACTIVE');
    const after = (await h.app.shifts().find(id))!;
    expect([after.employeeRef, after.switchRequestedAt]).toEqual(['E1', null]);
  });

  it('clears the request when a manager un-assigns the shift, and keeps it on a note-only edit', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const kept = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    const dropped = await published('E1', '2026-10-16T09:00:00+08:00', '2026-10-16T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: kept });
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: dropped });
    h.asManager();
    const note = (await h.call('GET', `/api/shifts/${kept}`)).body.shift;
    expect((await h.call('PATCH', `/api/shifts/${kept}`, { note: 'bring ID', version: note.version })).body.shift.switch_requested).toBe(true);
    const open = (await h.call('GET', `/api/shifts/${dropped}`)).body.shift;
    const result = await h.call('PATCH', `/api/shifts/${dropped}`, { employee_ref: null, version: open.version });
    expect(result.body.shift).toMatchObject({ employee_ref: null, switch_requested: false });
  });

  it('cancels nothing and queues no notices for saves that do not move from Switch to Unassign', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    await h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id });
    h.asManager();
    await h.call('PATCH', '/api/settings', { give_up_mode: 'switch', unassign_window_days: 3 }); // same mode
    expect((await h.app.shifts().find(id))!.switchRequestedAt).not.toBeNull();
    expect((await outbox()).filter((r) => r.kind === 'switch_cancelled')).toHaveLength(0);
    await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign' }); // switch -> unassign: cancels
    await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign', unassign_window_days: 4 }); // unassign -> unassign
    await h.call('PATCH', '/api/settings', { give_up_mode: 'switch' }); // unassign -> switch
    expect((await outbox()).filter((r) => r.kind === 'switch_cancelled')).toHaveLength(1);
  });

  it('serialises a switch request against the mode change (BR-07)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await published('E1', '2026-10-15T09:00:00+08:00', '2026-10-15T17:00:00+08:00');
    const current = await h.app.settings().get();
    await Promise.all([
      h.callAs(...ANA, 'POST', '/api/switch-requests', { shift_id: id }),
      h.app.openShifts().applySettings({ ...current, give_up_mode: 'unassign' }, 'admin@example.com'),
    ]);
    // Whichever ran first, no active request survives Unassign.
    expect((await h.app.shifts().find(id))!.switchRequestedAt).toBeNull();
  });
});
