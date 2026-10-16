import type { Logger } from '../http/kernel';
import type { HttpClient } from '../support/http';

export interface BadgeCount {
  email: string;
  count: number;
}

/** D3 / OI-07: unread counts for the gateway's app icon. Never throws. */
export interface BadgePublisher {
  readonly enabled: boolean;
  publish(badges: BadgeCount[]): Promise<boolean>;
}

export const noBadges: BadgePublisher = { enabled: false, publish: async () => true };

/** POST {GATEWAY_URL}/api/badges, as the recruitment app does: Basic client credentials, at most 500 entries per request. */
export class GatewayBadgePublisher implements BadgePublisher {
  readonly enabled = true;

  constructor(
    private readonly http: HttpClient,
    private readonly gatewayUrl: string,
    private readonly serviceId: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly log: Logger,
  ) {}

  async publish(badges: BadgeCount[]): Promise<boolean> {
    const auth = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
    let ok = true;
    for (let i = 0; i < badges.length; i += 500) {
      const chunk = badges.slice(i, i + 500).map((b) => ({ email: b.email.trim().toLowerCase(), count: Math.max(0, Math.min(99_999, Math.trunc(b.count))) }));
      const result = await this.http.request('POST', `${this.gatewayUrl}/api/badges`, {
        headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ service: this.serviceId, badges: chunk }),
        timeoutMs: 5_000,
      });
      if (result.networkError || result.status < 200 || result.status >= 300) {
        ok = false;
        this.log(`[badges] the gateway did not accept badge counts (${result.networkError ? 'unreachable' : `HTTP ${result.status}`})`);
      }
    }
    return ok;
  }
}
