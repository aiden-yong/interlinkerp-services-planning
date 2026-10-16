import type { App } from '../app';
import { op } from '../http/doc';
import { json, noContent } from '../http/responses';
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

  r.add('POST', '/api/switch-requests', 'person', 'Put one of my shifts up for switch.', async ({ body, principal }) =>
    json(201, { shift: shiftToMyApi(await app.openShifts().requestSwitch(await body(), principal!)) }),
  op('Request Switch', 'Offer my shift to eligible colleagues', ['An employee cannot work a shift'], ['Swapping without the shift staying mine until taken'],
    ['shift_id'], ['shift'], ['Signed-in person on the roster', 'Give-up mode is Switch', 'Shift has not started'], ['POST /api/switch-takeovers'],
    ['switch', 'swap', 'cover', 'give up shift']));

  r.add('DELETE', '/api/switch-requests/{shift_id}', 'person', 'Withdraw my switch request.', async ({ params, principal }) => {
    await app.openShifts().cancelSwitch(params.shift_id, principal!);
    return noContent();
  }, op('Cancel Switch', 'Keep my shift after all', ['The employee can work the shift again'], [],
    ['shift_id'], [], ['Signed-in person on the roster', 'Shift is up for switch'], ['POST /api/switch-requests'], ['cancel switch', 'withdraw']));

  r.add('POST', '/api/switch-takeovers', 'person', 'Take over a colleague\'s shift that is up for switch.', async ({ body, principal }) =>
    json(201, { shift: shiftToMyApi(await app.openShifts().takeOver(await body(), principal!)) }),
  op('Take Over Shift', 'Take a colleague\'s shift', ['Covering a colleague'], ['Claiming an unassigned open shift'],
    ['shift_id'], ['shift'], ['Signed-in person on the roster', 'Eligible for the shift'], ['GET /api/my/open-shifts'], ['take over', 'cover', 'swap']));

  r.add('POST', '/api/unassignments', 'person', 'Give up one of my shifts so it becomes an open shift.', async ({ body, principal }) =>
    json(201, { shift: shiftToMyApi(await app.openShifts().unassign(await body(), principal!)) }),
  op('Give Up Shift', 'Hand my shift back as an open shift', ['An employee cannot work a shift days ahead'], ['Swapping with a specific colleague'],
    ['shift_id'], ['shift'], ['Signed-in person on the roster', 'Give-up mode is Unassign', 'Outside the unassign window'], ['GET /api/my/open-shifts'],
    ['unassign', 'give up', 'drop shift']));
}
