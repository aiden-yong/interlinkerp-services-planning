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

describe('PageGate', () => {
  it('sends a visitor without a session to the gateway, remembering where they were going', async () => {
    const { gate } = setup();
    const result = await gate.handle(new Request(`${PUBLIC}/schedule?view=week`));
    expect(result).toMatchObject({ kind: 'redirect', location: `${ISSUER}/oauth/authorize?redirect_uri=${encodeURIComponent(`${PUBLIC}/`)}&state=${encodeURIComponent('/schedule?view=week')}` });
    expect(named(result, 'planning_return_to')).toContain(encodeURIComponent('/schedule?view=week'));
  });

  it('completes sign-in: exchanges the code, verifies the token, looks up the roster', async () => {
    const { gate, http, roster, codec } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign({ email: 'Ana@Example.com' }) }));
    roster.add('u1', 'Ana Lim', 'ana@example.com');

    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1&state=%2Fschedule`));

    expect(result).toMatchObject({ kind: 'redirect', location: `${PUBLIC}/schedule` });
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))).toMatchObject({
      employeeRef: 'u1', email: 'ana@example.com', rosterLookup: 'found', rosterCheckedAt: Date.parse('2026-10-13T00:00:00Z'),
    });
  });

  it('falls back to the return cookie when the gateway drops state', async () => {
    const { gate, http } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign() }));
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`, { headers: { cookie: 'planning_return_to=%2Fsettings%2Froles' } }));
    expect(result).toMatchObject({ location: `${PUBLIC}/settings/roles` });
  });

  it('still signs in, without a roster reference, when the roster is down', async () => {
    const { gate, http, roster, codec, logged } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign() }));
    roster.down = true;
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`));
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))).toMatchObject({ employeeRef: null, rosterLookup: 'failed' });
    expect(logged.length).toBeGreaterThan(0);
  });

  it('records someone the roster does not know as not_found', async () => {
    const { gate, http, codec } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign({ email: 'stranger@example.com' }) }));
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`));
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))).toMatchObject({ employeeRef: null, rosterLookup: 'not_found' });
  });

  it('shows an error page instead of looping when the exchange fails', async () => {
    const { gate, http } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(400, {}));
    expect(await gate.handle(new Request(`${PUBLIC}/?code=bad`))).toMatchObject({ kind: 'error', status: 502 });
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
