import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DevIdentity } from '../auth/devIdentity';
import type { Gateway } from '../auth/gateway';
import { readCookies, type RosterLookup, SESSION_COOKIE, type SessionCodec, type SessionData } from '../auth/session';
import type { TokenVerifier } from '../auth/tokens';
import type { Logger } from '../http/kernel';
import type { Roster } from '../roster/roster';
import type { Clock } from '../support/clock';

/** Holds `<nonce>.<encoded return path>` from the moment sign-in starts; the callback must present it (login CSRF). */
export const SIGNIN_COOKIE = 'planning_signin';
export const PAGE_PATHS = ['/', '/schedule', '/reports', '/my', '/settings', '/not-on-roster'];

export type GateResult =
  | { kind: 'pass'; cookies: string[] }
  | { kind: 'redirect'; location: string; cookies: string[] }
  | { kind: 'error'; status: number; html: string; cookies: string[] };

/** Paths served by route handlers. /feeds/ is the public calendar feed (D23). Bare /api and /internal have none, so the proxy answers them with the JSON 404. */
export function isApiPath(path: string): boolean {
  return path === '/health' || path === '/openapi.json' || path.startsWith('/api/') || path.startsWith('/internal/') || path.startsWith('/feeds/');
}

export function isPagePath(path: string): boolean {
  const clean = path.replace(/\/+$/, '') || '/';
  return PAGE_PATHS.includes(clean) || clean.startsWith('/settings/');
}

export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) return '/';
  return path;
}

function parseSignInCookie(value: string | undefined): { nonce: string; returnPath: string } | null {
  const match = /^([A-Za-z0-9_-]{22})\.([^.]*)$/.exec(value ?? '');
  if (!match) return null;
  try {
    return { nonce: match[1], returnPath: safeReturnPath(decodeURIComponent(match[2])) };
  } catch {
    return null;
  }
}

function sameNonce(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Sign-in flow for page loads (auth guide §4, §5). A failed code exchange shows an
 * error page rather than redirecting again, so a broken gateway cannot cause a loop.
 * proxy.ts adds Cache-Control: no-store to every result (§7).
 */
export class PageGate {
  constructor(
    private readonly gateway: Gateway,
    private readonly tokens: TokenVerifier,
    private readonly sessions: SessionCodec,
    private readonly roster: Roster,
    private readonly dev: DevIdentity | null,
    private readonly publicUrl: string,
    private readonly log: Logger,
    private readonly clock: Clock,
  ) {}

  private warnedNoState = false;

  private get secure(): boolean {
    return this.publicUrl.startsWith('https://');
  }

  async handle(request: Request): Promise<GateResult> {
    const url = new URL(request.url);
    const cookies = readCookies(request);
    const code = url.searchParams.get('code');
    if (code) return this.completeSignIn(url, cookies, code);

    if (this.dev?.allows(request)) return { kind: 'pass', cookies: [] };

    const session = this.sessions.decode(cookies[SESSION_COOKIE]);
    if (!session) return this.toGateway(url);

    const liveness = await this.gateway.liveness(session.sid, session.sub);
    if (liveness === 'dead') {
      const result = this.toGateway(url);
      result.cookies.push(this.sessions.clear(this.secure));
      return result;
    }
    return { kind: 'pass', cookies: liveness === 'live' ? [this.sessions.issue(session, this.secure)] : [] };
  }

  private async completeSignIn(url: URL, cookies: Record<string, string>, code: string): Promise<GateResult> {
    // Login CSRF: only a callback from the browser that started sign-in may use the code.
    const binding = parseSignInCookie(cookies[SIGNIN_COOKIE]);
    const state = url.searchParams.get('state');
    if (!binding || (state !== null && !sameNonce(state, binding.nonce))) {
      const result = this.toGateway(new URL('/', url));
      result.cookies.push(this.clearSignInCookie());
      // toGateway set a fresh cookie first; the browser keeps the last one for a name, so put the fresh one last.
      result.cookies.reverse();
      return result;
    }
    if (state === null && !this.warnedNoState) {
      this.warnedNoState = true;
      this.log('[planning-web] gateway did not return state');
    }

    let claims: Record<string, unknown>;
    try {
      claims = await this.tokens.verify(await this.gateway.exchangeCode(code), 'identity');
      if (typeof claims.sid !== 'string' || typeof claims.sub !== 'string') throw new Error('The identity token has no sid or sub.');
    } catch (error) {
      this.log(`[planning-web] sign-in failed: ${(error as Error).message}`);
      return {
        kind: 'error',
        status: 502,
        html: '<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><p>Signing in through InterlinkERP did not work. <a href="/">Try again</a>.</p>',
        cookies: [],
      };
    }

    const email = String(claims.email ?? '').trim().toLowerCase();
    let employeeRef: string | null = null;
    let rosterLookup: RosterLookup = 'not_found';
    if (email) {
      try {
        employeeRef = (await this.roster.findByEmail(email))?.ref ?? null;
        if (employeeRef) rosterLookup = 'found';
      } catch (error) {
        // Fail soft (auth guide §11): no roster match only means no My Planning yet. The API guard asks again later.
        rosterLookup = 'failed';
        this.log(`[planning-web] roster lookup failed at sign-in: ${(error as Error).message}`);
      }
    }

    const session: SessionData = {
      sid: claims.sid as string, sub: claims.sub as string, email, name: String(claims.name ?? email),
      gatewayRole: typeof claims.role === 'string' ? claims.role : '', employeeRef, rosterLookup, rosterCheckedAt: this.clock.now().getTime(), expiresAt: 0,
    };
    return {
      kind: 'redirect',
      location: `${this.publicUrl}${binding.returnPath}`,
      cookies: [this.sessions.issue(session, this.secure), this.clearSignInCookie()],
    };
  }

  private clearSignInCookie(): string {
    return `${SIGNIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`;
  }

  private toGateway(url: URL): GateResult & { kind: 'redirect' } {
    const query = new URLSearchParams(url.searchParams);
    query.delete('code');
    query.delete('state');
    const returnPath = safeReturnPath(`${url.pathname}${query.size ? `?${query}` : ''}`);
    const nonce = randomBytes(16).toString('base64url');
    const cookie = `${SIGNIN_COOKIE}=${nonce}.${encodeURIComponent(returnPath)}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`;
    return { kind: 'redirect', location: this.gateway.authorizeUrl(nonce), cookies: [cookie] };
  }
}
