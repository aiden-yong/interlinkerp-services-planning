import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigError } from '../config/env';
import type { Clock } from '../support/clock';

export const SESSION_COOKIE = 'planning_session';
export const SESSION_TTL_SECONDS = 900;

/** What Planning keeps about a signed-in person. Never the identity token itself. */
export interface SessionData {
  sid: string;
  sub: string;
  email: string;
  name: string;
  gatewayRole: string;
  employeeRef: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export function readCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    try {
      out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      // Ignore a malformed cookie rather than failing the request.
    }
  }
  return out;
}

function isSession(value: unknown): value is SessionData {
  const v = value as Record<string, unknown>;
  return typeof v === 'object' && v !== null
    && ['sid', 'sub', 'email', 'name', 'gatewayRole'].every((k) => typeof v[k] === 'string')
    && (v.employeeRef === null || typeof v.employeeRef === 'string')
    && typeof v.expiresAt === 'number';
}

/** HMAC-signed, HttpOnly, 15-minute session cookie (auth guide §6). */
export class SessionCodec {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {
    if (secret.length < 32) throw new ConfigError('SESSION_SECRET must be at least 32 characters.');
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  decode(value: string | undefined): SessionData | null {
    if (!value || !value.includes('.')) return null;
    const [body, mac] = value.split('.', 2);
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let data: unknown;
    try {
      data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!isSession(data) || data.expiresAt <= Math.floor(this.clock.now().getTime() / 1000)) return null;
    return data;
  }

  /** A fresh Set-Cookie value that expires SESSION_TTL_SECONDS from now. */
  issue(session: SessionData, secure: boolean): string {
    const fresh: SessionData = { ...session, expiresAt: Math.floor(this.clock.now().getTime() / 1000) + SESSION_TTL_SECONDS };
    const body = Buffer.from(JSON.stringify(fresh)).toString('base64url');
    return cookie(`${body}.${this.sign(body)}`, SESSION_TTL_SECONDS, secure);
  }

  clear(secure: boolean): string {
    return cookie('', 0, secure);
  }
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
