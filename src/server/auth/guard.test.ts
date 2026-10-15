import { beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors';
import { noContent } from '../http/responses';
import type { Access, Route } from '../http/router';
import type { Roster, RosterPerson } from '../roster/roster';
import { cookieValue, FakeRoster, FixedClock } from '../test/fakes';
import { AUDIENCE, ISSUER, makeTestTokens, type TestTokens } from '../test/tokens';
import { DevIdentity } from './devIdentity';
import type { Liveness } from './gateway';
import { GatewayAccessGuard } from './guard';
import { SessionCodec, type SessionData } from './session';
import { TokenVerifier } from './tokens';

/** A roster that never answers, counting how often it is asked. */
function hangingRoster(): Roster & { calls: number } {
  const roster = {
    calls: 0,
    findByEmail: () => {
      roster.calls++;
      return new Promise<RosterPerson | null>(() => {});
    },
    listPlannable: async () => [],
  };
  return roster;
}

let tokens: TestTokens;
beforeAll(async () => {
  tokens = await makeTestTokens();
});

const clock = FixedClock.at('2026-10-13T00:00:00Z');
const NOW_MS = clock.now().getTime();
const codec = new SessionCodec('s'.repeat(32), clock);
const route = (access: Access, method = 'GET'): Route => ({ method, path: '/api/x', access, summary: 'X', handler: () => noContent(), doc: null });

function guard(options: { liveness?: Liveness; managers?: string[]; dev?: DevIdentity | null; roster?: Roster; rosterBudgetMs?: number } = {}) {
  return new GatewayAccessGuard(
    codec,
    { liveness: async () => options.liveness ?? 'live' },
    new TokenVerifier(tokens.keys, ISSUER, AUDIENCE),
    { isManager: async (email) => (options.managers ?? []).includes(email) },
    options.dev ?? null,
    true,
    options.roster ?? new FakeRoster(),
    clock,
    options.rosterBudgetMs,
  );
}

function withSession(role = 'user', email = 'ana@example.com'): Request {
  const session: SessionData = { sid: 'sid-1', sub: 'sub-1', email, name: 'Ana', gatewayRole: role, employeeRef: 'EMP-1', expiresAt: 0 };
  return new Request('http://localhost/api/x', { headers: { cookie: `planning_session=${cookieValue(codec.issue(session, true))}` } });
}

function unrostered(extra: Partial<SessionData> = {}): Request {
  const session: SessionData = { sid: 'sid-1', sub: 'sub-1', email: 'ana@example.com', name: 'Ana', gatewayRole: 'user', employeeRef: null, expiresAt: 0, ...extra };
  return new Request('http://localhost/api/x', { headers: { cookie: `planning_session=${cookieValue(codec.issue(session, true))}` } });
}

async function rejection(work: Promise<unknown>): Promise<HttpError> {
  try {
    await work;
  } catch (e) {
    return e as HttpError;
  }
  throw new Error('expected a rejection');
}

describe('GatewayAccessGuard', () => {
  it('lets public routes through with no principal', async () => {
    expect((await guard().check(route('public'), new Request('http://localhost/health'))).principal).toBeNull();
  });

  it('is 401 without a session, and ignores forged identity headers', async () => {
    const forged = new Request('http://localhost/api/x', { headers: { 'x-authenticated-user': 'admin@example.com', 'x-user-role': 'admin' } });
    expect((await rejection(guard().check(route('manager'), forged))).status).toBe(401);
  });

  it('gives a live session a principal and a fresh cookie', async () => {
    const result = await guard().check(route('person'), withSession());
    expect(result.principal).toMatchObject({ kind: 'person', email: 'ana@example.com', employeeRef: 'EMP-1', isManager: false });
    expect(result.cookies).toHaveLength(1);
  });

  it('fails open on an unknown gateway answer but does not extend the session', async () => {
    const result = await guard({ liveness: 'unknown' }).check(route('person'), withSession());
    expect(result.principal).not.toBeNull();
    expect(result.cookies).toEqual([]);
  });

  it('locks immediately when the gateway session has ended, and clears the cookie', async () => {
    const e = await rejection(guard({ liveness: 'dead' }).check(route('person'), withSession()));
    expect(e.status).toBe(401);
    expect(e.headers['Set-Cookie']).toContain('Max-Age=0');
  });

  it('applies BR-12', async () => {
    expect((await rejection(guard().check(route('manager'), withSession()))).status).toBe(403);
    expect((await guard().check(route('manager'), withSession('admin'))).principal?.isManager).toBe(true);
    expect((await guard({ managers: ['ana@example.com'] }).check(route('manager'), withSession('user', 'Ana@Example.com'))).principal?.isManager).toBe(true);
    expect((await rejection(guard().check(route('manager'), withSession('')))).status).toBe(403);
  });

  it('accepts a program with the right scope and refuses the rest', async () => {
    const bearer = async (claims: Record<string, unknown>) =>
      new Request('http://localhost/api/x', { method: 'POST', headers: { authorization: `Bearer ${await tokens.sign({ token_use: 'access', sub: 'client-9', ...claims })}` } });

    const ok = await guard().check(route('manager', 'POST'), await bearer({ scope: 'planning:read planning:write' }));
    expect(ok.principal).toMatchObject({ kind: 'client', subject: 'client-9' });

    const missing = await rejection(guard().check(route('manager', 'POST'), await bearer({ scope: 'planning:read' })));
    expect([missing.status, missing.details]).toEqual([403, { required: ['planning:write'], granted: ['planning:read'] }]);

    const personOnly = await rejection(guard().check(route('person'), await bearer({ scope: 'planning:read' })));
    expect([personOnly.status, personOnly.code]).toEqual([403, 'PERSON_REQUIRED']);

    const identityAsBearer = new Request('http://localhost/api/x', { headers: { authorization: `Bearer ${await tokens.sign()}` } });
    expect((await rejection(guard().check(route('manager'), identityAsBearer))).status).toBe(401);
  });

  it('keeps programs out of person-manager routes (the Planning Manager list), even with planning:write', async () => {
    const request = new Request('http://localhost/api/managers', {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokens.sign({ token_use: 'access', sub: 'client-9', scope: 'planning:read planning:write' })}` },
    });
    const e = await rejection(guard().check(route('person-manager', 'POST'), request));
    expect([e.status, e.code]).toEqual([403, 'PERSON_REQUIRED']);

    expect((await rejection(guard().check(route('person-manager', 'POST'), withSession()))).status).toBe(403);
    expect((await guard({ managers: ['ana@example.com'] }).check(route('person-manager', 'POST'), withSession())).principal?.isManager).toBe(true);
  });

  describe('roster re-check for people signed in without an employee reference', () => {
    it('retries after 60 seconds and picks up a newly found reference', async () => {
      const roster = new FakeRoster();
      roster.add('EMP-7', 'Ana Lim', 'ana@example.com');
      const result = await guard({ roster }).check(route('person'), unrostered({ rosterLookup: 'not_found', rosterCheckedAt: NOW_MS - 60_000 }));
      expect(result.principal).toMatchObject({ employeeRef: 'EMP-7', rosterStatus: 'found' });
      expect(codec.decode(cookieValue(result.cookies[0]))).toMatchObject({ employeeRef: 'EMP-7', rosterLookup: 'found', rosterCheckedAt: NOW_MS });
    });

    it('does not retry within 60 seconds', async () => {
      const roster = new FakeRoster();
      roster.add('EMP-7', 'Ana Lim', 'ana@example.com');
      const result = await guard({ roster }).check(route('person'), unrostered({ rosterLookup: 'not_found', rosterCheckedAt: NOW_MS - 59_999 }));
      expect(result.principal).toMatchObject({ employeeRef: null, rosterStatus: 'not_found' });
      expect(codec.decode(cookieValue(result.cookies[0]))).toMatchObject({ employeeRef: null, rosterLookup: 'not_found', rosterCheckedAt: NOW_MS - 59_999 });
    });

    it('records a still-missing person as not_found', async () => {
      const result = await guard().check(route('person'), unrostered({ rosterLookup: 'failed', rosterCheckedAt: NOW_MS - 120_000 }));
      expect(result.principal).toMatchObject({ employeeRef: null, rosterStatus: 'not_found' });
      expect(codec.decode(cookieValue(result.cookies[0]))).toMatchObject({ rosterLookup: 'not_found', rosterCheckedAt: NOW_MS });
    });

    it('records an unreachable roster as failed, without throwing', async () => {
      const roster = new FakeRoster();
      roster.down = true;
      const result = await guard({ roster }).check(route('person'), unrostered({ rosterLookup: 'not_found', rosterCheckedAt: NOW_MS - 60_000 }));
      expect(result.principal).toMatchObject({ employeeRef: null, rosterStatus: 'failed' });
      expect(codec.decode(cookieValue(result.cookies[0]))).toMatchObject({ employeeRef: null, rosterLookup: 'failed', rosterCheckedAt: NOW_MS });
    });

    it('re-checks a cookie from before the roster status was recorded', async () => {
      const roster = new FakeRoster();
      roster.add('EMP-7', 'Ana Lim', 'ana@example.com');
      const result = await guard({ roster }).check(route('person'), unrostered());
      expect(result.principal).toMatchObject({ employeeRef: 'EMP-7', rosterStatus: 'found' });
    });

    it('uses a found reference without extending the session when the gateway answer is unknown', async () => {
      const roster = new FakeRoster();
      roster.add('EMP-7', 'Ana Lim', 'ana@example.com');
      const result = await guard({ roster, liveness: 'unknown' }).check(route('person'), unrostered({ rosterLookup: 'failed', rosterCheckedAt: NOW_MS - 60_000 }));
      expect(result.principal).toMatchObject({ employeeRef: 'EMP-7', rosterStatus: 'found' });
      expect(result.cookies).toEqual([]);
    });

    it('asks a hanging roster once per minute per person, and never waits past the budget', async () => {
      const roster = hangingRoster();
      const g = guard({ roster, liveness: 'unknown', rosterBudgetMs: 20 });
      const request = () => unrostered({ rosterLookup: 'not_found', rosterCheckedAt: NOW_MS - 60_000 });
      for (let i = 0; i < 2; i++) {
        const started = Date.now();
        const result = await g.check(route('person'), request());
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(result.principal).toMatchObject({ employeeRef: null });
      }
      expect(roster.calls).toBe(1);
    });

    it('records a roster that misses the budget as failed', async () => {
      const result = await guard({ roster: hangingRoster(), rosterBudgetMs: 20 }).check(route('person'), unrostered());
      expect(result.principal).toMatchObject({ rosterStatus: 'failed' });
      expect(codec.decode(cookieValue(result.cookies[0]))).toMatchObject({ rosterLookup: 'failed', rosterCheckedAt: NOW_MS });
    });

    it('lets only one of several parallel requests ask the roster', async () => {
      const roster = hangingRoster();
      const g = guard({ roster, rosterBudgetMs: 20 });
      await Promise.all([1, 2, 3].map(() => g.check(route('person'), unrostered())));
      expect(roster.calls).toBe(1);
    });

    it('does not look a rostered person up again', async () => {
      const roster = new FakeRoster();
      roster.down = true;
      const result = await guard({ roster }).check(route('person'), withSession());
      expect(result.principal).toMatchObject({ employeeRef: 'EMP-1', rosterStatus: 'found' });
    });
  });

  it('uses the dev identity only for direct loopback requests', async () => {
    const dev = new DevIdentity({ sid: 'dev', sub: 'dev:dev@example.com', email: 'dev@example.com', name: 'Dev', gatewayRole: 'admin', employeeRef: null, expiresAt: Number.MAX_SAFE_INTEGER });
    const local = new Request('http://127.0.0.1:3000/api/x', { headers: { 'x-forwarded-for': '127.0.0.1' } });
    const proxied = new Request('http://127.0.0.1:3000/api/x', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    const remoteHost = new Request('http://planning.example.com/api/x');

    expect((await guard({ dev }).check(route('manager'), local)).principal?.isManager).toBe(true);
    expect((await rejection(guard({ dev }).check(route('person'), proxied))).status).toBe(401);
    expect((await rejection(guard({ dev }).check(route('person'), remoteHost))).status).toBe(401);
  });
});
