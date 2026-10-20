import { describe, expect, it } from 'vitest';
import { personaCookie } from '../../client/DevIdentityPicker';
import { DEV_AS_COOKIE, DevIdentity, parsePersona } from './devIdentity';

const base = { sid: 'dev-session', sub: 'dev:dev@example.com', email: 'dev@example.com', name: 'Local Developer', gatewayRole: 'user', employeeRef: null, expiresAt: Number.MAX_SAFE_INTEGER };
const withCookie = (cookie: string) => new Request('http://127.0.0.1:3000/schedule', { headers: { cookie } });
const value = (header: string) => header.split(';')[0]!.slice(DEV_AS_COOKIE.length + 1);

describe('development identity picker (backlog item 32)', () => {
  it('acts as the persona the picker chose, using the cookie the client writes', () => {
    const dev = new DevIdentity(base);
    const cookie = personaCookie({ email: 'Ana@Example.com', name: 'Ana Lim', role: 'user', ref: 'E1' });
    const session = dev.sessionFor(withCookie(cookie.split(';')[0]!));
    expect(session).toMatchObject({ sub: 'dev:ana@example.com', email: 'ana@example.com', name: 'Ana Lim', gatewayRole: 'user', employeeRef: 'E1' });
    expect(dev.sessionFor(new Request('http://127.0.0.1:3000/'))).toBe(base);
  });

  it('ignores a malformed or over-reaching cookie', () => {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(parsePersona('not base64 json')).toBeNull();
    expect(parsePersona(encode({ email: 'a@b.c', name: 'A', role: 'owner', ref: null }))).toBeNull();
    expect(parsePersona(encode({ email: 'nobody', name: 'A', role: 'user', ref: null }))).toBeNull();
    expect(parsePersona(encode({ email: 'a@b.c', name: 'A', role: 'admin', ref: 'x'.repeat(65) }))).toBeNull();
    expect(parsePersona(encode({ email: 'a@b.c', name: 'A', role: 'admin', ref: null }))).toEqual({ email: 'a@b.c', name: 'A', role: 'admin', ref: null });
  });

  it('clears the choice with an expired cookie', () => {
    expect(personaCookie(null)).toBe(`${DEV_AS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
    expect(value(personaCookie({ email: 'a@b.c', name: 'Zoë', role: 'user', ref: null }))).not.toMatch(/[+/=]/);
  });
});
