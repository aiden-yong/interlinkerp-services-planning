import { beforeAll, describe, expect, it } from 'vitest';
import { Gateway } from '../auth/gateway';
import { SessionCodec } from '../auth/session';
import { TokenVerifier } from '../auth/tokens';
import { cookieValue, FakeHttpClient, FakeRoster, FixedClock, reply } from '../test/fakes';
import { AUDIENCE, ISSUER, makeTestTokens, type TestTokens } from '../test/tokens';
import { type GateResult, isApiPath, isPagePath, PageGate, safeReturnPath } from './pageGate';

const PUBLIC = 'https://planning.test';
let tokens: TestTokens;
beforeAll(async () => {
  tokens = await makeTestTokens();
});

function setup() {
  const http = new FakeHttpClient();
  const roster = new FakeRoster();
  const clock = FixedClock.at('2026-10-13T00:00:00Z');
  const codec = new SessionCodec('k'.repeat(32), clock);
  const logged: string[] = [];
  const gate = new PageGate(new Gateway(http, ISSUER, PUBLIC), new TokenVerifier(tokens.keys, ISSUER, AUDIENCE), codec, roster, null, PUBLIC, (l) => logged.push(l), clock);
  return { http, roster, codec, logged, gate };
}

const named = (result: GateResult, name: string) => result.cookies.find((c) => c.startsWith(`${name}=`));

/** Starts sign-in for `path` and returns the nonce sent to the gateway plus the cookie header the browser would send back. */
async function startSignIn(gate: PageGate, path = '/') {
  const result = await gate.handle(new Request(`${PUBLIC}${path}`));
  const nonce = new URL((result as { location: string }).location).searchParams.get('state')!;
  const setCookie = named(result, 'planning_signin')!;
  return { result, nonce, setCookie, cookie: `planning_signin=${cookieValue(setCookie)}` };
}

describe('PageGate', () => {
  it('sends a visitor without a session to the gateway with a random nonce as state, remembering where they were going in a bound cookie', async () => {
    const { gate } = setup();
    const { result, nonce, setCookie } = await startSignIn(gate, '/schedule?view=week');
    expect(result).toMatchObject({ kind: 'redirect', location: `${ISSUER}/oauth/authorize?redirect_uri=${encodeURIComponent(`${PUBLIC}/`)}&state=${nonce}` });
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(setCookie).toBe(`planning_signin=${nonce}.${encodeURIComponent('/schedule?view=week')}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`);
    expect(named(result, 'planning_return_to')).toBeUndefined();
  });

  it('uses a different nonce for every sign-in, and omits Secure over plain http', async () => {
    const { gate: a } = setup();
    const { nonce: n1 } = await startSignIn(a);
    const { nonce: n2 } = await startSignIn(a);
    expect(n1).not.toBe(n2);
    const clock = FixedClock.at('2026-10-13T00:00:00Z');
    const http = new FakeHttpClient();
    const plain = new PageGate(new Gateway(http, ISSUER, 'http://planning.test'), new TokenVerifier(tokens.keys, ISSUER, AUDIENCE), new SessionCodec('k'.repeat(32), clock), new FakeRoster(), null, 'http://planning.test', () => {}, clock);
    const result = await plain.handle(new Request('http://planning.test/my'));
    expect(named(result, 'planning_signin')).not.toContain('Secure');
  });

  it('completes sign-in: exchanges the code, verifies the token, looks up the roster, returns to the stored path', async () => {
    const { gate, http, roster, codec } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign({ email: 'Ana@Example.com' }) }));
    roster.add('u1', 'Ana Lim', 'ana@example.com');
    const { nonce, cookie } = await startSignIn(gate, '/schedule');

    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1&state=${nonce}`, { headers: { cookie } }));

    expect(result).toMatchObject({ kind: 'redirect', location: `${PUBLIC}/schedule` });
    expect(named(result, 'planning_signin')).toContain('Max-Age=0');
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))).toMatchObject({
      employeeRef: 'u1', email: 'ana@example.com', rosterLookup: 'found', rosterCheckedAt: Date.parse('2026-10-13T00:00:00Z'),
    });
  });

  it('ignores the return path in state: only the cookie decides where to go', async () => {
    const { gate, http } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign() }));
    const { nonce, cookie } = await startSignIn(gate, '/settings/roles');
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1&state=${nonce}&next=https://evil.test`, { headers: { cookie } }));
    expect(result).toMatchObject({ location: `${PUBLIC}/settings/roles` });
  });

  it('accepts a callback without state when the cookie is present, and logs the gap once', async () => {
    const { gate, http, logged } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign() }), reply(200, { token: await tokens.sign() }));
    const { cookie } = await startSignIn(gate, '/settings/roles');
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`, { headers: { cookie } }));
    expect(result).toMatchObject({ kind: 'redirect', location: `${PUBLIC}/settings/roles` });
    await gate.handle(new Request(`${PUBLIC}/?code=c-2`, { headers: { cookie } }));
    expect(logged.filter((l) => l === '[planning-web] gateway did not return state')).toHaveLength(1);
  });

  it('refuses a mismatched state: no code exchange, clears the cookie, starts a fresh sign-in', async () => {
    const { gate, http } = setup();
    const { cookie, nonce } = await startSignIn(gate, '/schedule');
    const result = await gate.handle(new Request(`${PUBLIC}/?code=attacker&state=${nonce.split('').reverse().join('')}x`, { headers: { cookie } }));
    expect(http.requests).toHaveLength(0);
    expect(result).toMatchObject({ kind: 'redirect' });
    expect((result as { location: string }).location).toContain(`${ISSUER}/oauth/authorize`);
    expect(named(result, 'planning_session')).toBeUndefined();
    expect(result.cookies.some((c) => c.startsWith('planning_signin=;') && c.includes('Max-Age=0'))).toBe(true);
    // The fresh sign-in cookie comes last so the browser keeps it.
    expect(result.cookies[result.cookies.length - 1]).toMatch(/^planning_signin=[A-Za-z0-9_-]{22}\./);
  });

  it('refuses a callback with no sign-in cookie', async () => {
    const { gate, http } = setup();
    for (const path of ['/?code=attacker&state=whatever', '/?code=attacker']) {
      const result = await gate.handle(new Request(`${PUBLIC}${path}`));
      expect(result).toMatchObject({ kind: 'redirect' });
      expect((result as { location: string }).location).toContain(`${ISSUER}/oauth/authorize`);
    }
    expect(http.requests).toHaveLength(0);
  });

  it.each(['abc', 'short.%2F', 'AAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA.%2F.extra', 'AAAAAAAAAAAAAAAAAAAAA!.%2F', 'AAAAAAAAAAAAAAAAAAAAAA.%E0%A4%A'])(
    'refuses a malformed sign-in cookie %j',
    async (value) => {
      const { gate, http } = setup();
      const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`, { headers: { cookie: `planning_signin=${value}` } }));
      expect(http.requests).toHaveLength(0);
      expect((result as { location: string }).location).toContain('/oauth/authorize');
    },
  );

  it('does not accept the old return-path cookie as a binding', async () => {
    const { gate, http } = setup();
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`, { headers: { cookie: 'planning_return_to=%2Fsettings' } }));
    expect(http.requests).toHaveLength(0);
    expect(result.kind).toBe('redirect');
  });

  it('still signs in, without a roster reference, when the roster is down', async () => {
    const { gate, http, roster, codec, logged } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign() }));
    roster.down = true;
    const { nonce, cookie } = await startSignIn(gate);
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1&state=${nonce}`, { headers: { cookie } }));
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))).toMatchObject({ employeeRef: null, rosterLookup: 'failed' });
    expect(logged.length).toBeGreaterThan(0);
  });

  it('records someone the roster does not know as not_found', async () => {
    const { gate, http, codec } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign({ email: 'stranger@example.com' }) }));
    const { nonce, cookie } = await startSignIn(gate);
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1&state=${nonce}`, { headers: { cookie } }));
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))).toMatchObject({ employeeRef: null, rosterLookup: 'not_found' });
  });

  it('shows an error page instead of looping when the exchange fails', async () => {
    const { gate, http } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(400, {}));
    const { nonce, cookie } = await startSignIn(gate);
    expect(await gate.handle(new Request(`${PUBLIC}/?code=bad&state=${nonce}`, { headers: { cookie } }))).toMatchObject({ kind: 'error', status: 502 });
  });

  it('lets a live session through and extends it; locks an ended one', async () => {
    const { gate, http, codec } = setup();
    const cookie = `planning_session=${cookieValue(codec.issue({ sid: 's', sub: 'u', email: 'a@x', name: 'A', gatewayRole: 'user', employeeRef: null, expiresAt: 0 }, true))}`;

    http.on('POST', `${ISSUER}/oauth/introspect`, reply(200, { active: true }), reply(200, { active: false }));
    const live = await gate.handle(new Request(`${PUBLIC}/my`, { headers: { cookie } }));
    expect(live.kind).toBe('pass');
    expect(named(live, 'planning_session')).toBeDefined();

    const dead = await gate.handle(new Request(`${PUBLIC}/my`, { headers: { cookie } }));
    expect(dead.kind).toBe('redirect');
    expect(named(dead, 'planning_session')).toContain('Max-Age=0');
  });
});

describe('paths', () => {
  it('knows which paths are pages', () => {
    expect(['/', '/schedule', '/my/', '/settings', '/settings/roles', '/not-on-roster'].every(isPagePath)).toBe(true);
    expect(['/nope', '/robots.txt', '/api/me'].some(isPagePath)).toBe(false);
  });

  it('leaves bare /api and /internal to the JSON 404, not the route handlers', () => {
    expect(['/health', '/openapi.json', '/api/me', '/api/shifts/1', '/internal/cron/x', '/feeds/calendar/x.ics'].every(isApiPath)).toBe(true);
    expect(['/api', '/internal', '/apix', '/internalx', '/feeds', '/'].some(isApiPath)).toBe(false);
  });

  it.each([
    ['/schedule?x=1', '/schedule?x=1'], [null, '/'], ['https://evil.test/', '/'], ['//evil.test/x', '/'], ['/\\evil.test', '/'], ['/x\r\nSet-Cookie: a=b', '/'],
  ])('safeReturnPath(%j) is %j', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});
