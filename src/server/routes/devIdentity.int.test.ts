import { describe, expect, it } from 'vitest';
import { App } from '../app';
import { DevIdentity } from '../auth/devIdentity';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const session = { sid: 'dev-session', sub: 'dev:dev@example.com', email: 'dev@example.com', name: 'Local Developer', gatewayRole: 'user', employeeRef: null, expiresAt: Number.MAX_SAFE_INTEGER };
const get = (app: App, host = '127.0.0.1:3000') => app.kernel().handle(new Request(`http://${host}/internal/dev/identities`));

describe('GET /internal/dev/identities (backlog item 32)', () => {
  it('offers the .env.local identity, a manager and every employee, in local development only', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    const dev = new App({ ...h.app.deps, devIdentity: new DevIdentity(session) });
    const response = await get(dev);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.current).toEqual({ email: 'dev@example.com', name: 'Local Developer', role: 'user', ref: null });
    expect(body.identities.map((i: { label: string }) => i.label)).toEqual(['Local Developer (from .env.local)', 'Planning Manager (gateway admin)', 'Ana Lim (employee)']);
    expect(body.identities[2].persona).toEqual({ email: 'ana@example.com', name: 'Ana Lim', role: 'user', ref: 'E1' });
  });

  it('does not exist without the development sign-in, or from another host', async () => {
    expect((await get(h.app)).status).toBe(404);
    expect((await get(new App({ ...h.app.deps, devIdentity: new DevIdentity(session) }), 'planning.example.com')).status).toBe(404);
  });
});
