import { beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors';
import { noContent } from '../http/responses';
import type { Access, Route } from '../http/router';
import { cookieValue, FixedClock } from '../test/fakes';
import { AUDIENCE, ISSUER, makeTestTokens, type TestTokens } from '../test/tokens';
import { DevIdentity } from './devIdentity';
import type { Liveness } from './gateway';
import { GatewayAccessGuard } from './guard';
import { SessionCodec, type SessionData } from './session';
import { TokenVerifier } from './tokens';

let tokens: TestTokens;
beforeAll(async () => {
  tokens = await makeTestTokens();
});

const codec = new SessionCodec('s'.repeat(32), FixedClock.at('2026-10-13T00:00:00Z'));
const route = (access: Access, method = 'GET'): Route => ({ method, path: '/api/x', access, summary: 'X', handler: () => noContent(), doc: null });

function guard(options: { liveness?: Liveness; managers?: string[]; dev?: DevIdentity | null } = {}) {
  return new GatewayAccessGuard(
    codec,
    { liveness: async () => options.liveness ?? 'live' },
    new TokenVerifier(tokens.keys, ISSUER, AUDIENCE),
    { isManager: async (email) => (options.managers ?? []).includes(email) },
    options.dev ?? null,
    true,
  );
}

function withSession(role = 'user', email = 'ana@example.com'): Request {
  const session: SessionData = { sid: 'sid-1', sub: 'sub-1', email, name: 'Ana', gatewayRole: role, employeeRef: 'EMP-1', expiresAt: 0 };
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
