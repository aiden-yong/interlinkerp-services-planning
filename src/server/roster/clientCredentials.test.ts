import { describe, expect, it } from 'vitest';
import { FakeHttpClient, FixedClock, reply } from '../test/fakes';
import { ClientCredentials } from './clientCredentials';
import { RosterUnavailable } from './roster';

describe('ClientCredentials', () => {
  it('reuses a token until a minute before it expires', async () => {
    const http = new FakeHttpClient().on('POST', 'https://gw.test/oauth/token', reply(200, { access_token: 't1', expires_in: 3600 }));
    const clock = FixedClock.at('2026-10-13T00:00:00Z');
    const cc = new ClientCredentials(http, 'https://gw.test', 'id', 'secret', clock);

    expect(await cc.token('intern-database')).toBe('t1');
    expect(await cc.token('intern-database')).toBe('t1');
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(JSON.parse(http.requests[0].body!)).toEqual({ grant_type: 'client_credentials', audience: 'intern-database' });

    clock.advance(3550);
    await cc.token('intern-database');
    expect(http.requests).toHaveLength(2);
  });

  it('throws RosterUnavailable when the gateway refuses', async () => {
    const http = new FakeHttpClient().on('POST', 'https://gw.test/oauth/token', reply(403, { error: 'nope' }));
    await expect(new ClientCredentials(http, 'https://gw.test', 'id', 's', FixedClock.at('2026-10-13T00:00:00Z')).token('x')).rejects.toBeInstanceOf(RosterUnavailable);
  });
});
