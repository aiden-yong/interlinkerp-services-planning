import type { Clock } from '../support/clock';
import type { HttpClient } from '../support/http';
import { RosterUnavailable } from './roster';

/**
 * Service-to-service access tokens (contract SS-26), one per audience, reused
 * until a minute before expiry (performance guide §5b). Held in memory: each
 * serverless instance fetches at most one token per audience per hour.
 */
export class ClientCredentials {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly http: HttpClient,
    private readonly gatewayUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly clock: Clock,
  ) {}

  async token(audience: string): Promise<string> {
    const now = this.clock.now().getTime();
    const cached = this.cache.get(audience);
    if (cached && cached.expiresAt > now + 60_000) return cached.token;

    const result = await this.http.request('POST', `${this.gatewayUrl}/oauth/token`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}` },
      body: JSON.stringify({ grant_type: 'client_credentials', audience }),
      timeoutMs: 6_000,
    });
    const body = result.json as { access_token?: unknown; expires_in?: unknown } | null;
    if (result.status !== 200 || typeof body?.access_token !== 'string' || body.access_token === '') {
      throw new RosterUnavailable(`The gateway refused a ${audience} token (HTTP ${result.status}).`);
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.cache.set(audience, { token: body.access_token, expiresAt: now + Math.max(60, expiresIn) * 1000 });
    return body.access_token;
  }
}
