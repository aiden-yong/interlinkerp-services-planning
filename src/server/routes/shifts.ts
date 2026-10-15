import type { App } from '../app';
import type { Principal } from '../auth/principal';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { shiftToApi } from '../repo/shifts';

export const actor = (p: Principal | null): Principal => p ?? (() => { throw HttpError.unauthorized('Sign in through the InterlinkERP gateway first.'); })();

export function register(r: Router, app: App): void {
  r.add('POST', '/api/shifts', 'manager', 'Create a draft shift, or duplicate an existing one.', async ({ body, principal }) => {
    const { shift, conflicts } = await app.shiftService().create(await body(), actor(principal));
    return json(201, { shift: shiftToApi(shift, conflicts) });
  }, op('Create Shift', 'Plan a block of work for an employee or as an open shift', ['Adding a shift to the schedule', 'Copying a shift with duplicate_of'], ['Moving an existing shift'],
    ['employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts', 'duplicate_of'],
    ['shift', 'shift.conflicts'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'POST /api/publications'],
    ['shift', 'schedule', 'plan', 'roster', 'rota', 'create']));

  r.add('GET', '/api/shifts/{id}', 'manager', 'Read one shift with its current conflicts.', async ({ params }) => {
    const shift = (await app.shifts().find(params.id)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    return json(200, { shift: shiftToApi(shift, await app.conflictContext().conflictsFor(shift)) });
  }, op('Read Shift', 'See one shift in detail', ['Opening a shift to edit it'], ['Listing a week of shifts'],
    ['id'], ['shift'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'GET /api/schedule'], ['shift', 'details']));

  r.add('PATCH', '/api/shifts/{id}', 'manager', 'Move, resize, reassign or edit a shift.', async ({ params, body, principal }) => {
    const { shift, conflicts } = await app.shiftService().update(params.id, await body(), actor(principal));
    return json(200, { shift: shiftToApi(shift, conflicts) });
  }, op('Update Shift', "Change a shift's time, employee, role or details", ['Dragging a shift to another day or person', 'Changing the note'], ['Creating a shift'],
    ['version', 'employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts'],
    ['shift'], ['Planning Manager', 'Latest version of the shift'], ['GET /api/shifts/{id}'], ['move', 'reassign', 'edit shift', 'resize']));
}
