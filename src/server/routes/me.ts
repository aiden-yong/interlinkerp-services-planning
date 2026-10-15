import type { App } from '../app';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';

export function register(r: Router, _app: App): void {
  r.add('GET', '/api/me', 'person', 'Show who is signed in and what they may do in Planning.', ({ principal: me }) =>
    json(200, { name: me?.name ?? null, email: me?.email ?? null, gateway_role: me?.gatewayRole ?? null, employee_ref: me?.employeeRef ?? null, is_manager: me?.isManager ?? false }),
  op('Show Current User', 'Find out who is signed in and whether they manage planning', ['Deciding which screens to show after sign-in'], ['Listing employees', 'Reading shifts'],
    [], ['name', 'email', 'employee_ref', 'is_manager', 'timezone'], ['Signed-in person'], ['GET /api/my/shifts', 'GET /api/schedule'],
    ['me', 'profile', 'current user', 'whoami', 'permissions']));
}
