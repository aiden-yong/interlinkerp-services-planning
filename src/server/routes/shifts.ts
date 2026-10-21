import type { App } from '../app';
import type { Principal } from '../auth/principal';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import type { ActorKind } from '../repo/audit';
import { seriesToApi } from '../repo/recurrences';
import { shiftToApi } from '../repo/shifts';
import { iso } from '../support/time';

export const actor = (p: Principal | null): Principal => p ?? (() => { throw HttpError.unauthorized('Sign in through the InterlinkERP gateway first.'); })();

/** D17: employees by their current directory name, managers by email; null is a back-filled entry nobody is known for. */
function actorName(actorValue: string | null, kind: ActorKind, names: ReadonlyMap<string, string>): string {
  if (actorValue === null) return 'Unknown';
  if (kind === 'employee') return names.get(actorValue) ?? 'Unknown employee';
  if (kind === 'system') return 'System';
  return actorValue;
}

export function register(r: Router, app: App): void {
  r.add('POST', '/api/shifts', 'manager', 'Create a draft shift, or duplicate an existing one.', async ({ body, principal }) => {
    const { shift, conflicts, recurrence } = await app.shiftService().create(await body(), actor(principal));
    return json(201, { shift: shiftToApi(shift, conflicts), ...(recurrence ? { recurrence } : {}) });
  }, op('Create Shift', 'Plan a block of work for an employee or as an open shift', ['Adding a shift to the schedule', 'Copying a shift with duplicate_of'], ['Moving an existing shift'],
    ['employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts', 'duplicate_of', 'repeat'],
    ['shift', 'shift.conflicts', 'recurrence'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'POST /api/publications'],
    ['shift', 'schedule', 'plan', 'roster', 'rota', 'create']));

  r.add('GET', '/api/shifts/{id}', 'manager', 'Read one shift with its current conflicts.', async ({ params }) => {
    const shift = (await app.shifts().find(params.id)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    const series = shift.recurrenceId ? await app.recurrences().find(shift.recurrenceId) : null;
    const recurrence = series ? seriesToApi(series, shift.recurrenceIndex, shift.recurrenceDetached) : null;
    return json(200, { shift: shiftToApi(shift, await app.conflictContext().conflictsFor(shift), recurrence) });
  }, op('Read Shift', 'See one shift in detail', ['Opening a shift to edit it'], ['Listing a week of shifts'],
    ['id'], ['shift'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'GET /api/schedule'], ['shift', 'details']));

  r.add('GET', '/api/shifts/{id}/history', 'manager', 'Read who created, changed, published or deleted a shift, newest first.', async ({ params }) => {
    const shift = (await app.shifts().find(params.id, true)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    const entries = await app.audit().forShift(shift.id);
    const refs = [...new Set(entries.flatMap((e) => (e.actorKind === 'employee' && e.actor ? [e.actor] : [])))];
    const names = new Map((await Promise.all(refs.map((ref) => app.directory().find(ref)))).flatMap((p) => (p ? [[p.employeeRef, p.displayName] as const] : [])));
    return json(200, {
      entries: entries.map((e) => ({
        action: e.action, actor: e.actor, actor_kind: e.actorKind, actor_name: actorName(e.actor, e.actorKind, names), changes: e.changes ?? null, at: iso(e.at),
      })),
    });
  }, op('Shift History', 'See who did what to a shift and when', ['Finding out who moved or reassigned a shift', 'Checking when a shift was published'], ['Listing the schedule'],
    ['id'], ['entries[].action', 'entries[].actor', 'entries[].actor_kind', 'entries[].actor_name', 'entries[].changes', 'entries[].at'], ['Planning Manager'],
    ['GET /api/shifts/{id}'], ['history', 'audit', 'who changed', 'log']));

  r.add('PATCH', '/api/shifts/{id}', 'manager', 'Move, resize, reassign or edit a shift.', async ({ params, body, principal }) => {
    const { shift, conflicts, updated } = await app.shiftService().update(params.id, await body(), actor(principal));
    const series = shift.recurrenceId ? await app.recurrences().find(shift.recurrenceId) : null;
    const recurrence = series ? seriesToApi(series, shift.recurrenceIndex, shift.recurrenceDetached) : null;
    return json(200, { shift: shiftToApi(shift, conflicts, recurrence), updated });
  }, op('Update Shift', "Change a shift's time, employee, role or details", ['Dragging a shift to another day or person', 'Changing the note'], ['Creating a shift'],
    ['version', 'scope', 'repeat', 'employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts'],
    ['shift', 'updated'], ['Planning Manager', 'Latest version of the shift'], ['GET /api/shifts/{id}'], ['move', 'reassign', 'edit shift', 'resize']));

  r.add('DELETE', '/api/shifts/{id}', 'manager', 'Delete a shift (can be undone for 30 seconds), or delete this and following / all shifts of a repeating series.', async ({ params, query, principal }) => {
    const scope = query.scope === 'following' || query.scope === 'all' ? query.scope : undefined;
    if (query.scope !== undefined && scope === undefined) throw HttpError.validation({ scope: 'Use following or all.' });
    const result = await app.shiftService().delete(params.id, actor(principal), scope);
    return result ? json(200, result) : noContent();
  }, op('Delete Shift', 'Remove a shift from the schedule, or a repeating series from a point on', ['A shift is no longer needed', 'A repeating series should stop'], ['Giving a shift to someone else (reassign it instead)'],
    ['id', 'scope'], ['deleted'], ['Planning Manager'], ['POST /api/shift-restorations'], ['delete', 'remove shift', 'cancel shift']));

  r.add('POST', '/api/shift-splits', 'manager', 'Split a shift in two at a chosen time.', async ({ body, principal }) => {
    const [first, second] = await app.shiftService().split(await body(), actor(principal));
    return json(201, { shifts: [shiftToApi(first), shiftToApi(second)] });
  }, op('Split Shift', 'Divide one shift into two shorter ones', ['A long shift should become two shorter ones'], ["Changing a shift's own times (use PATCH)"],
    ['shift_id', 'version', 'at'], ['shifts'], ['Planning Manager', 'Latest version of the shift', 'At least 15 minutes on each side'], ['GET /api/shifts/{id}', 'PATCH /api/shifts/{id}'],
    ['split', 'divide shift', 'break up shift']));

  r.add('POST', '/api/shift-restorations', 'manager', 'Undo a shift deletion made in the last 30 seconds.', async ({ body, principal }) => {
    const input = new Input(await body());
    const id = input.string('shift_id', 36, true);
    input.check();
    const shift = await app.shiftService().restore(id!, actor(principal));
    return json(201, { shift: shiftToApi(shift, await app.conflictContext().conflictsFor(shift)) });
  }, op('Undo Shift Deletion', 'Bring back a shift that was just deleted', ['A shift was deleted by mistake'], ['Restoring a shift deleted long ago'],
    ['shift_id'], ['shift'], ['Planning Manager', 'Deleted less than 30 seconds ago'], ['DELETE /api/shifts/{id}'], ['undo', 'restore', 'undelete']));
}
