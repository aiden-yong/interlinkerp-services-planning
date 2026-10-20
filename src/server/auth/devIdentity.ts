import { env } from '../config/env';
import { readCookies, type SessionData } from './session';

/** Backlog item 32: who to act as in local development, chosen with the identity picker. Ignored everywhere else. */
export const DEV_AS_COOKIE = 'planning_dev_as';

export interface DevPersona {
  email: string;
  name: string;
  role: 'admin' | 'user';
  ref: string | null;
}

/** Strictly parses the picker cookie; anything malformed means "no override". */
export function parsePersona(raw: string | undefined): DevPersona | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const ref = p.ref === null || p.ref === undefined ? null : typeof p.ref === 'string' && p.ref.length > 0 && p.ref.length <= 64 ? p.ref : undefined;
    if (!email || email.length > 254 || !email.includes('@') || !name || name.length > 200 || (p.role !== 'admin' && p.role !== 'user') || ref === undefined) return null;
    return { email, name, role: p.role, ref };
  } catch {
    return null;
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '[::1]']);

/**
 * Local development sign-in. 127.0.0.1 is not a redirect_uri the gateway
 * knows, so real sign-in is impossible locally. Only `next dev`
 * (NODE_ENV=development, bound to 127.0.0.1 by the dev script) with
 * APP_ENV=development, never on Vercel, and only for loopback requests.
 */
export class DevIdentity {
  constructor(readonly session: SessionData) {}

  static fromEnv(): DevIdentity | null {
    if (process.env.NODE_ENV !== 'development' || env('APP_ENV') !== 'development' || env('VERCEL') !== undefined) return null;
    const email = (env('DEV_USER_EMAIL', 'dev@example.com') ?? 'dev@example.com').toLowerCase();
    return new DevIdentity({
      sid: 'dev-session',
      sub: `dev:${email}`,
      email,
      name: env('DEV_USER_NAME', 'Local Developer')!,
      gatewayRole: env('DEV_USER_ROLE', 'user')!,
      employeeRef: env('DEV_EMPLOYEE_REF') ?? null,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
  }

  /** The session to use: the picker's choice when set, otherwise the one from .env.local. Call only after allows(). */
  sessionFor(request: Request): SessionData {
    const persona = parsePersona(readCookies(request)[DEV_AS_COOKIE]);
    if (!persona) return this.session;
    return { ...this.session, sub: `dev:${persona.email}`, email: persona.email, name: persona.name, gatewayRole: persona.role, employeeRef: persona.ref };
  }

  allows(request: Request): boolean {
    if (!LOOPBACK.has(new URL(request.url).hostname)) return false;
    const forwarded = request.headers.get('x-forwarded-for');
    return !forwarded || forwarded.split(',').every((ip) => LOOPBACK.has(ip.trim()));
  }
}
