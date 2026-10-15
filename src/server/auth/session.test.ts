import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config/env';
import { cookieValue, FixedClock } from '../test/fakes';
import { readCookies, SessionCodec, type SessionData } from './session';

const session: SessionData = { sid: 'sid-1', sub: 'sub-1', email: 'ana@example.com', name: 'Ana Lim', gatewayRole: 'user', employeeRef: 'EMP-1', expiresAt: 0 };

function setup() {
  const clock = FixedClock.at('2026-10-13T00:00:00Z');
  return { clock, codec: new SessionCodec('0123456789abcdef0123456789abcdef', clock) };
}

describe('SessionCodec', () => {
  it('round-trips through a signed HttpOnly cookie', () => {
    const { codec } = setup();
    const cookie = codec.issue(session, true);
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=900', 'Path=/']) expect(cookie).toContain(part);
    expect(codec.decode(cookieValue(cookie))).toMatchObject({ employeeRef: 'EMP-1', gatewayRole: 'user' });
  });

  it('rejects a tampered cookie', () => {
    const { codec } = setup();
    const [, mac] = cookieValue(codec.issue(session, false)).split('.');
    const forged = Buffer.from(JSON.stringify({ ...session, gatewayRole: 'admin', expiresAt: 9e9 })).toString('base64url');
    expect(codec.decode(`${forged}.${mac}`)).toBeNull();
  });

  it('rejects an expired or missing cookie', () => {
    const { codec, clock } = setup();
    const value = cookieValue(codec.issue(session, false));
    clock.advance(901);
    expect(codec.decode(value)).toBeNull();
    expect(codec.decode(undefined)).toBeNull();
    expect(codec.decode('no-dot')).toBeNull();
  });

  it('refuses a short secret', () => {
    expect(() => new SessionCodec('too-short', FixedClock.at('2026-10-13T00:00:00Z'))).toThrow(ConfigError);
  });

  it('clears and reads cookies', () => {
    const { codec } = setup();
    expect(codec.clear(false)).toBe('planning_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(readCookies(new Request('http://x', { headers: { cookie: 'a=1; planning_return_to=%2Fsettings' } }))).toEqual({ a: '1', planning_return_to: '/settings' });
  });
});
