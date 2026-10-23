import type { HttpClient } from '../support/http';

export type Liveness = 'live' | 'dead' | 'unknown';

export interface SessionLiveness {
  liveness(sid: string, sub: string): Promise<Liveness>;
}

/** Calls Planning makes to the InterlinkERP gateway (auth guide §1, §4, §5). URLs come from config only (§8). */
export class Gateway implements SessionLiveness {
  constructor(
    private readonly http: HttpClient,
    private readonly gatewayUrl: string,
    private readonly publicUrl: string,
  ) {}

  /** `state` is a random nonce tied to the browser by a cookie (login CSRF protection), never the return path. */
  authorizeUrl(state: string): string {
    return `${this.gatewayUrl}/oauth/authorize?redirect_uri=${encodeURIComponent(`${this.publicUrl}/`)}&state=${encodeURIComponent(state)}`;
  }

  /** Server-to-server code exchange (auth guide §4 step 4). Returns the identity token. */
  async exchangeCode(code: string): Promise<string> {
    const result = await this.http.request('POST', `${this.gatewayUrl}/oauth/token`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: `${this.publicUrl}/` }),
    });
    const token = (result.json as { token?: unknown } | null)?.token;
    if (result.status !== 200 || typeof token !== 'string' || token === '') {
      throw new Error(`The gateway did not accept the sign-in code (HTTP ${result.status}).`);
    }
    return token;
  }

  /** Auth guide §5: every request, no cache. Network or server trouble is 'unknown' (fail open). */
  async liveness(sid: string, sub: string): Promise<Liveness> {
    const result = await this.http.request('POST', `${this.gatewayUrl}/oauth/introspect`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, sub }),
      timeoutMs: 4_000,
    });
    // Only network failures and server errors are 'unknown' (fail open). Any other refusal means the session is not live.
    if (result.networkError || result.status >= 500) return 'unknown';
    if (result.status !== 200) return 'dead';
    if (result.json === null || typeof result.json !== 'object') return 'unknown';
    return (result.json as { active?: unknown }).active === true ? 'live' : 'dead';
  }
}
