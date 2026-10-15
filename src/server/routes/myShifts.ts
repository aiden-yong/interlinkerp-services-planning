import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { shiftToMyApi } from '../repo/shifts';
import { MAX_RANGE_DAYS } from '../scheduling/scheduleService';
import { localMidnight, nextDay } from '../support/time';

export function register(r: Router, app: App): void {
  // FR-MYP-01, FR-PUB-02: published shifts only, and only the signed-in employee's.
  r.add('GET', '/api/my/shifts', 'person', "List the signed-in employee's published shifts.", async ({ query, principal }) => {
    if (!principal?.employeeRef) throw HttpError.forbidden('You are not on the planning roster.', 'NOT_ON_ROSTER');
    const input = new Input(query);
    const range = input.dateRange('from', 'to', MAX_RANGE_DAYS);
    input.check();
    const zone = (await app.profiles().find(principal.employeeRef)).timezone ?? (await app.settings().timezone());
    const [shifts, roles] = await Promise.all([
      app.shifts().publishedForEmployee(principal.employeeRef, new Date(localMidnight(range![0], zone)), new Date(localMidnight(nextDay(range![1]), zone))),
      app.roles().all(),
    ]);
    return json(200, { timezone: zone, from: range![0], to: range![1], roles, shifts: shifts.map(shiftToMyApi) });
  }, op('My Shifts', 'See my own published schedule', ['An employee checks when they work'], ['A manager reviewing the whole team'],
    ['from', 'to'], ['timezone', 'shifts[]', 'roles[]'], ['Signed-in person on the roster'], ['GET /api/me'],
    ['my schedule', 'my shifts', 'when do I work', 'my roster']));
}
