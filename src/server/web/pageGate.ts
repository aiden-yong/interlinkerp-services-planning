import type { DevIdentity } from '../auth/devIdentity';
import type { Gateway } from '../auth/gateway';
import { readCookies, SESSION_COOKIE, type SessionCodec, type SessionData } from '../auth/session';
import type { TokenVerifier } from '../auth/tokens';
import type { Logger } from '../http/kernel';
import type { Roster } from '../roster/roster';

export const RETURN_COOKIE = 'planning_return_to';
export const PAGE_PATHS = ['/', '/schedule', '/my', '/settings', '/not-on-roster'];

export type GateResult =
  | { kind: 'pass'; cookies: string[] }
  | { kind: 'redirect'; location: string; cookies: string[] }
  | { kind: 'error'; status: number; html: string; cookies: string[] };

export function isPagePath(path: string): boolean {
  const clean = path.replace(/\/+$/, '') || '/';
  return PAGE_PATHS.includes(clean) || clean.startsWith('/settings/');
}

export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) return '/';
  return path;
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
  ) {}

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
    if (email) {
      try {
        employeeRef = (await this.roster.findByEmail(email))?.ref ?? null;
      } catch (error) {
        // Fail soft (auth guide §11): no roster match only means no My Planning yet.
        this.log(`[planning-web] roster lookup failed at sign-in: ${(error as Error).message}`);
      }
    }

    const session: SessionData = {
      sid: claims.sid as string, sub: claims.sub as string, email, name: String(claims.name ?? email),
      gatewayRole: typeof claims.role === 'string' ? claims.role : '', employeeRef, expiresAt: 0,
    };
    const returnPath = safeReturnPath(url.searchParams.get('state') ?? cookies[RETURN_COOKIE]);
    return {
      kind: 'redirect',
      location: `${this.publicUrl}${returnPath}`,
      cookies: [this.sessions.issue(session, this.secure), `${RETURN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`],
    };
  }

  private toGateway(url: URL): GateResult & { kind: 'redirect' } {
    const query = new URLSearchParams(url.searchParams);
    query.delete('code');
    query.delete('state');
    const returnPath = safeReturnPath(`${url.pathname}${query.size ? `?${query}` : ''}`);
    const cookies = returnPath === '/'
      ? []
      : [`${RETURN_COOKIE}=${encodeURIComponent(returnPath)}; Path=/; Max-Age=300; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`];
    return { kind: 'redirect', location: this.gateway.authorizeUrl(returnPath), cookies };
  }
}
