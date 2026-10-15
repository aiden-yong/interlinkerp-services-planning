import { env } from '../config/env';
import type { SessionData } from './session';

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

  allows(request: Request): boolean {
    if (!LOOPBACK.has(new URL(request.url).hostname)) return false;
    const forwarded = request.headers.get('x-forwarded-for');
    return !forwarded || forwarded.split(',').every((ip) => LOOPBACK.has(ip.trim()));
  }
}
