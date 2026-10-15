import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

describe('managers API (FR-ACC-03)', () => {
  it('grants once and lists', async () => {
    h.roster.add('u1', 'Bo Tan', 'bo@example.com');
    expect((await h.call('POST', '/api/managers', { email: 'Bo@Example.com' })).status).toBe(201);
    const again = await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    expect(again.status).toBe(200);
    expect(again.body.manager).toEqual({ email: 'bo@example.com', granted_by: 'mona@example.com', granted_at: '2026-10-13T02:00:00Z' });
    expect((await h.call('GET', '/api/managers')).body.managers.map((m: { email: string }) => m.email)).toEqual(['bo@example.com']);
  });

  it('only grants people on the roster', async () => {
    expect((await h.call('POST', '/api/managers', { email: 'ghost@example.com' })).body.error.details.email).toBe('This email is not on the employee roster.');
    expect((await h.call('POST', '/api/managers', { email: 'not-an-email' })).status).toBe(422);
    h.roster.down = true;
    const down = await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    expect([down.status, down.body.error.code]).toEqual([503, 'ROSTER_UNAVAILABLE']);
  });

  it('revokes', async () => {
    h.roster.add('u1', 'Bo Tan', 'bo@example.com');
    await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    expect((await h.call('DELETE', '/api/managers/bo%40example.com')).status).toBe(204);
    expect((await h.call('DELETE', '/api/managers/bo%40example.com')).status).toBe(404);
  });

  it('warns the last listed manager before they remove themselves (AC3)', async () => {
    h.roster.add('u1', 'Bo Tan', 'bo@example.com');
    await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    h.asManager('bo@example.com');
    expect((await h.call('DELETE', '/api/managers/bo%40example.com')).body.error.code).toBe('LAST_MANAGER');
    expect((await h.call('DELETE', '/api/managers/bo%40example.com', undefined, { confirm: 'true' })).status).toBe(204);
  });

  it('is for managers only', async () => {
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/managers')).status).toBe(403);
  });
});
