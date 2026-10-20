import type { App } from '../app';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/me', 'person', 'Show who is signed in and what they may do in Planning.', async ({ principal: me }) => {
    const organisationTimezone = await app.settings().timezone();
    const timezone = me?.employeeRef ? ((await app.profiles().find(me.employeeRef)).timezone ?? organisationTimezone) : organisationTimezone;
    return json(200, {
      name: me?.name ?? null, email: me?.email ?? null, gateway_role: me?.gatewayRole ?? null, employee_ref: me?.employeeRef ?? null,
      roster_status: me?.employeeRef ? 'found' : (me?.rosterStatus ?? 'not_found'),
      is_manager: me?.isManager ?? false, timezone, organisation_timezone: organisationTimezone,
      // Backlog item 32: true only for local development sign-in, so the identity picker can show itself.
      dev_identity: (me?.subject.startsWith('dev:') ?? false) && app.devIdentity() !== null,
    });
  }, op('Show Current User', 'Find out who is signed in and whether they manage planning', ['Deciding which screens to show after sign-in'], ['Listing employees', 'Reading shifts'],
    [], ['name', 'email', 'employee_ref', 'roster_status', 'is_manager', 'timezone', 'dev_identity'], ['Signed-in person'], ['GET /api/my/shifts', 'GET /api/schedule'],
    ['me', 'profile', 'current user', 'whoami', 'permissions']));
}
