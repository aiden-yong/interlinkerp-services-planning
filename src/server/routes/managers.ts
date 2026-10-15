import type { App } from '../app';
import { actorId } from '../auth/principal';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { RosterUnavailable } from '../roster/roster';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function register(r: Router, app: App): void {
  r.add('GET', '/api/managers', 'manager', 'List people granted Planning Manager access.', async () =>
    json(200, { managers: await app.managers().all(), note: 'InterlinkERP gateway admins are always Planning Managers and are not listed here.' }),
  op('List Planning Managers', 'See who can manage planning', ['Reviewing who has manager access'], ['Listing employees'],
    [], ['managers[].email', 'managers[].granted_by', 'managers[].granted_at'], ['Planning Manager'], ['POST /api/managers', 'DELETE /api/managers/{email}'],
    ['managers', 'permissions', 'access', 'admins']));

  r.add('POST', '/api/managers', 'person-manager', 'Grant Planning Manager access to someone on the roster.', async ({ body, principal }) => {
    const input = new Input(await body());
    const raw = input.string('email', 254, true);
    if (raw && !EMAIL.test(raw)) input.error('email', 'Not a valid email address.');
    input.check();
    const email = raw!.toLowerCase();

    let person;
    try {
      person = await app.roster().findByEmail(email);
    } catch (error) {
      if (error instanceof RosterUnavailable) throw new HttpError(503, 'ROSTER_UNAVAILABLE', 'The employee roster cannot be reached right now. Try again shortly.');
      throw error;
    }
    if (!person) throw HttpError.validation({ email: 'This email is not on the employee roster.' });

    const created = await app.managers().grant(email, principal ? actorId(principal) : 'unknown', app.clock().now());
    const grant = (await app.managers().all()).find((m) => m.email === email);
    return json(created ? 201 : 200, { manager: grant });
  }, op('Grant Manager Access', 'Let someone plan and publish shifts', ['A new supervisor needs to plan shifts'], ['Giving someone a planning role'],
    ['email'], ['manager'], ['Planning Manager', 'Person is on the employee roster'], ['GET /api/managers'], ['grant', 'permission', 'manager', 'access']));

  r.add('DELETE', '/api/managers/{email}', 'person-manager', 'Revoke Planning Manager access.', async ({ params, query, principal }) => {
    const email = params.email.trim().toLowerCase();
    if (!(await app.managers().isManager(email))) throw HttpError.notFound('That person is not on the Planning Manager list.');
    const removingSelf = principal?.email === email && principal.gatewayRole !== 'admin';
    if (removingSelf && (await app.managers().count()) === 1 && query.confirm !== 'true') {
      throw HttpError.conflict('LAST_MANAGER', 'You are the last listed Planning Manager. After this, only gateway admins can manage planning. Repeat with ?confirm=true to continue.');
    }
    await app.managers().revoke(email);
    return noContent();
  }, op('Revoke Manager Access', 'Stop someone managing planning', ['A supervisor changes team or leaves'], ['Removing an employee from the roster'],
    ['email', 'confirm'], [], ['Planning Manager', 'Person is listed'], ['GET /api/managers'], ['revoke', 'remove manager', 'permission']));
}
