import { describe, expect, it } from 'vitest';
import { App } from '../app';
import { ORG, useTestDatabase } from '../test/db';
import { FakeDepartments, FakeRoster, FixedClock } from '../test/fakes';

const database = useTestDatabase();

function app(cronSecret: string | null): App {
  const roster = new FakeRoster();
  roster.add('u1', 'Ana Lim', 'ana@x.test');
  return new App({ database, organisationId: ORG, clock: FixedClock.at('2026-10-13T00:00:00Z'), roster, departments: new FakeDepartments(), cronSecret, guard: { check: async () => ({ principal: null, cookies: [] }) } });
}

const call = (a: App, auth?: string) => a.kernel().handle(new Request('http://localhost/internal/cron/directory', { headers: auth ? { authorization: auth } : {} }));

describe('GET /internal/cron/directory', () => {
  it('refuses a missing or wrong secret', async () => {
    expect((await call(app(null), 'Bearer x')).status).toBe(401);
    expect((await call(app('right'), 'Bearer wrong')).status).toBe(401);
    expect((await call(app('right'))).status).toBe(401);
  });

  it('refreshes the directory with the right secret', async () => {
    const response = await call(app('right'), 'Bearer right');
    expect(await response.json()).toEqual({ refreshed: true });
  });
});
