import { HttpError } from '../http/errors';
import type { AccessGuard, AccessResult } from '../http/kernel';
import { type Route, scopeOf } from '../http/router';
import type { ManagerDirectory } from '../repo/managers';
import type { Roster } from '../roster/roster';
import type { Clock } from '../support/clock';
import type { DevIdentity } from './devIdentity';
import type { SessionLiveness } from './gateway';
import type { Principal } from './principal';
import { readCookies, type RosterLookup, SESSION_COOKIE, type SessionCodec, type SessionData } from './session';
import { TokenInvalid, type TokenVerifier } from './tokens';

/** How long to wait before asking the roster again about someone it did not return. */
export const ROSTER_RECHECK_MS = 60_000;
/** Longest a request waits on a roster re-check before treating it as failed (NFR-06). */
export const ROSTER_RECHECK_BUDGET_MS = 2_000;

const TIMED_OUT = Symbol('timed out');

/**
 * Who is calling, and may they use this route?
 *  - Programs send a gateway access token (contract SS-6, SS-25) and need the route's scope.
 *  - People carry Planning's session cookie, re-checked with the gateway on every request.
 * Identity never comes from any other header (auth guide §3).
 */
export class GatewayAccessGuard implements AccessGuard {
  constructor(
    private readonly sessions: SessionCodec,
    private readonly gateway: SessionLiveness,
    private readonly tokens: TokenVerifier,
    private readonly managers: ManagerDirectory,
    private readonly dev: DevIdentity | null,
    private readonly secureCookies: boolean,
    private readonly roster: Roster,
    private readonly clock: Clock,
    private readonly rosterBudgetMs: number = ROSTER_RECHECK_BUDGET_MS,
  ) {}

  /** Normalised email → epoch ms of the last re-check this process started, so parallel or cookie-less requests do not repeat it. */
  private readonly rosterAsked = new Map<string, number>();

  async check(route: Route, request: Request): Promise<AccessResult> {
    if (route.access === 'public' || route.access === 'internal') return { principal: null, cookies: [] };

    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (bearer) return { principal: await this.client(route, bearer), cookies: [] };

    const { principal, cookies } = await this.person(request);
    if ((route.access === 'manager' || route.access === 'person-manager') && !principal.isManager) throw HttpError.forbidden('Only Planning Managers can do this.');
    return { principal, cookies };
  }

  private async client(route: Route, token: string): Promise<Principal> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.tokens.verify(token, 'access');
    } catch (error) {
      if (error instanceof TokenInvalid) throw HttpError.unauthorized(error.message);
      throw error;
    }
    const scopes = String(claims.scope ?? '').split(' ').filter(Boolean);
    if (route.access === 'person' || route.access === 'person-manager') throw HttpError.forbidden('This endpoint is only for signed-in people.', 'PERSON_REQUIRED');
    const required = scopeOf(route)!;
    if (!scopes.includes(required)) throw HttpError.forbidden(`This endpoint needs ${required}.`, 'FORBIDDEN', { required: [required], granted: scopes });
    return { kind: 'client', subject: String(claims.sub ?? 'unknown'), email: null, name: null, gatewayRole: null, employeeRef: null, isManager: false, scopes };
  }

  private async person(request: Request): Promise<{ principal: Principal; cookies: string[] }> {
    if (this.dev?.allows(request)) return { principal: await this.principalFor(this.dev.sessionFor(request)), cookies: [] };

    const session = this.sessions.decode(readCookies(request)[SESSION_COOKIE]);
    if (!session) throw HttpError.unauthorized('Sign in through the InterlinkERP gateway first.');

    const liveness = await this.gateway.liveness(session.sid, session.sub);
    if (liveness === 'dead') {
      throw new HttpError(401, 'UNAUTHORIZED', 'Your InterlinkERP session has ended.', null, { 'Set-Cookie': this.sessions.clear(this.secureCookies) });
    }
    const current = session.employeeRef === null ? await this.recheckRoster(session) : session;
    // Only extend the session when the gateway confirmed it (auth guide §6 backstop).
    const cookies = liveness === 'live' ? [this.sessions.issue(current, this.secureCookies)] : [];
    return { principal: await this.principalFor(current), cookies };
  }

  /**
   * Someone signed in without an employee reference (roster down, or added later):
   * ask the roster again at most once a minute. Never throws; a failure is recorded.
   */
  private async recheckRoster(session: SessionData): Promise<SessionData> {
    const now = this.clock.now().getTime();
    const email = session.email.trim().toLowerCase();
    if (!email) return session;
    const recent = (at: number | undefined) => at !== undefined && now - at < ROSTER_RECHECK_MS;
    if (recent(session.rosterCheckedAt) || recent(this.rosterAsked.get(email))) return session;
    this.rememberAsked(email, now);
    try {
      const found = await this.withinBudget(this.roster.findByEmail(email));
      if (found === TIMED_OUT) return { ...session, rosterLookup: 'failed', rosterCheckedAt: now };
      const ref = found?.ref ?? null;
      return { ...session, employeeRef: ref, rosterLookup: ref ? 'found' : 'not_found', rosterCheckedAt: now };
    } catch {
      return { ...session, rosterLookup: 'failed', rosterCheckedAt: now };
    }
  }

  private rememberAsked(email: string, now: number): void {
    if (this.rosterAsked.size >= 10_000) {
      for (const [key, at] of this.rosterAsked) if (now - at >= ROSTER_RECHECK_MS) this.rosterAsked.delete(key);
    }
    this.rosterAsked.set(email, now);
  }

  /** Resolves with the work's result, or TIMED_OUT after the budget. The loser is not awaited. */
  private withinBudget<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
    work.catch(() => {}); // a late failure must not become an unhandled rejection
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.rosterBudgetMs);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  /** BR-12: gateway admin, or listed email. Anything else, including no role, is not a manager. */
  private async principalFor(session: SessionData): Promise<Principal> {
    const email = session.email.trim().toLowerCase();
    const isManager = session.gatewayRole === 'admin' || (email !== '' && (await this.managers.isManager(email)));
    const rosterStatus: RosterLookup = session.employeeRef ? 'found' : (session.rosterLookup === 'failed' ? 'failed' : 'not_found');
    return { kind: 'person', subject: session.sub, email, name: session.name, gatewayRole: session.gatewayRole, employeeRef: session.employeeRef, rosterStatus, isManager, scopes: [] };
  }
}
