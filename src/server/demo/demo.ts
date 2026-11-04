import { env } from '../config/env';
import type { SessionData } from '../auth/session';

/**
 * Demo mode: a public, hosted copy of the app anyone can explore without a gateway account (a portfolio demo). A landing
 * page replaces the gateway sign-in, every visitor is the same demo manager, and no email or badge leaves the app.
 *
 * On only when DEMO_MODE=true AND the database's name contains "demo". That rule is the whole safety net: with no
 * password, a DEMO_MODE copied into the production project would otherwise open real schedules to everyone. With
 * DEMO_MODE=true and any other database the app refuses to serve at all, rather than fall back to the gateway.
 */

/** The sid every demo session carries; the demo guard and gate accept only this one. */
export const DEMO_SID = 'demo-session';
export const DEMO_EMAIL = 'demo@interlinkerp.example';
/** The demo visitor is on the roster as well as a manager, so one person can see every screen. */
export const DEMO_EMPLOYEE_REF = 'SVC-001';

export function demoRequested(): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env('DEMO_MODE') ?? '').trim().toLowerCase());
}

export function isDemoDatabase(url: string | undefined): boolean {
  try {
    return decodeURIComponent(new URL(url ?? '').pathname.slice(1)).toLowerCase().includes('demo');
  } catch {
    return false;
  }
}

/** Why DEMO_MODE=true can't be honoured, or null when it can (or demo mode is off). */
export function demoConfigurationError(): string | null {
  if (!demoRequested() || isDemoDatabase(env('DATABASE_URL'))) return null;
  return 'DEMO_MODE=true needs a database whose name (in DATABASE_URL) contains "demo", so it can never run against real data.';
}

export function demoEnabled(): boolean {
  return demoRequested() && demoConfigurationError() === null;
}

/** What every demo visitor's session holds. */
export function demoSession(): SessionData {
  return {
    sid: DEMO_SID, sub: 'demo-user', email: DEMO_EMAIL, name: 'Demo Manager', gatewayRole: 'admin',
    employeeRef: DEMO_EMPLOYEE_REF, rosterLookup: 'found', expiresAt: 0,
  };
}

export function isDemoSession(session: SessionData | null): boolean {
  return session?.sid === DEMO_SID;
}

/** Who built it, for the landing page: DEMO_CREDIT_NAME, linked to DEMO_CREDIT_URL when that is an https:// address. */
export function demoCredit(): { name: string; url: string | null } | null {
  const name = env('DEMO_CREDIT_NAME')?.trim();
  if (!name) return null;
  const url = env('DEMO_CREDIT_URL')?.trim() ?? '';
  return { name, url: url.startsWith('https://') ? url : null };
}
