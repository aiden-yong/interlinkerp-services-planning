import type { App } from '../app';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { shiftToMyApi } from '../repo/shifts';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/my/open-shifts', 'person', 'List open shifts and colleagues\' shifts up for switch that I can take.', async ({ query, principal }) =>
    json(200, await app.openShifts().available(query, principal!)),
  op('Available Shifts', 'Find shifts I could pick up', ['An employee wants extra hours', 'Covering for a colleague'], ['A manager filling the schedule'],
    ['from', 'to'], ['open[]', 'up_for_switch[]', 'give_up'], ['Signed-in person on the roster'], ['POST /api/shift-claims', 'POST /api/switch-takeovers'],
    ['open shifts', 'pick up shift', 'extra hours', 'available shifts']));

  r.add('POST', '/api/shift-claims', 'person', 'Claim an open shift.', async ({ body, principal }) =>
    json(201, { shift: shiftToMyApi(await app.openShifts().claim(await body(), principal!)) }),
  op('Claim Open Shift', 'Take an open shift for myself', ['Picking up an unassigned shift'], ['A manager assigning a shift'],
    ['shift_id'], ['shift'], ['Signed-in person on the roster', 'Eligible for the shift (role, no conflict)'], ['GET /api/my/open-shifts'],
    ['claim', 'pick up', 'take shift']));
}
