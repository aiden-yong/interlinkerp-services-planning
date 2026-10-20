import type { App } from '../app';
import { HttpError } from '../http/errors';
import { json } from '../http/responses';
import type { Router } from '../http/router';

/**
 * Backlog item 32: the people the local identity picker offers. Internal (never in /openapi.json) and answers 404
 * unless the development sign-in is active for this request: `next dev`, APP_ENV=development, not Vercel, loopback.
 */
export function register(r: Router, app: App): void {
  r.add('GET', '/internal/dev/identities', 'internal', 'List identities for the local development picker.', async ({ request }) => {
    const dev = app.devIdentity();
    if (!dev?.allows(request)) throw HttpError.notFound('No route for /internal/dev/identities.');
    const base = dev.session;
    const employees = (await app.directory().all()).map((e) => ({ email: e.email ?? `${e.employeeRef.toLowerCase()}@dev.invalid`, name: e.displayName, role: 'user' as const, ref: e.employeeRef }));
    const current = dev.sessionFor(request);
    return json(200, {
      current: { email: current.email, name: current.name, role: current.gatewayRole, ref: current.employeeRef },
      identities: [
        { label: `${base.name} (from .env.local)`, persona: null },
        { label: 'Planning Manager (gateway admin)', persona: { email: 'manager@dev.invalid', name: 'Dev Manager', role: 'admin', ref: null } },
        ...employees.map((p) => ({ label: `${p.name} (employee)`, persona: p })),
      ],
    });
  });
}
