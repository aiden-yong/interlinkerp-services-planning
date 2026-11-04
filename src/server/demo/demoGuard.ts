import type { Principal } from '../auth/principal';
import { readCookies, SESSION_COOKIE, type SessionCodec } from '../auth/session';
import { HttpError } from '../http/errors';
import type { AccessGuard, AccessResult } from '../http/kernel';
import type { Route } from '../http/router';
import { demoSession, isDemoSession } from './demo';

/**
 * Who is calling, in demo mode (demo.ts): only a visitor who came through the landing page. There is no gateway to ask
 * about sessions or to verify access tokens with, so a session from anywhere else and every bearer token are refused.
 */
export class DemoAccessGuard implements AccessGuard {
  constructor(
    private readonly sessions: SessionCodec,
    private readonly secureCookies: boolean,
  ) {}

  async check(route: Route, request: Request): Promise<AccessResult> {
    if (route.access === 'public' || route.access === 'internal') return { principal: null, cookies: [] };
    if (!isDemoSession(this.sessions.decode(readCookies(request)[SESSION_COOKIE]))) throw HttpError.unauthorized('Open the demo from its landing page first.');
    const session = demoSession();
    const principal: Principal = {
      kind: 'person', subject: session.sub, email: session.email, name: session.name, gatewayRole: session.gatewayRole,
      employeeRef: session.employeeRef, rosterStatus: 'found', isManager: true, scopes: [],
    };
    return { principal, cookies: [this.sessions.issue(session, this.secureCookies)] };
  }
}
