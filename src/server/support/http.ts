import { currentCorrelationId } from './requestContext';

export interface HttpResult {
  status: number;
  /** Parsed JSON body, or null when there was none or it was not JSON. */
  json: unknown;
  networkError: boolean;
}

export interface HttpClient {
  request(method: string, url: string, options?: { headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<HttpResult>;
}

/** Outbound calls to the gateway and other services. Forwards the correlation id (contract SS-4). */
export class FetchHttpClient implements HttpClient {
  async request(method: string, url: string, options: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<HttpResult> {
    const cid = currentCorrelationId();
    try {
      const response = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(cid ? { 'X-Correlation-ID': cid } : {}), ...options.headers },
        body: options.body,
        // Never follow redirects: a POST body must not be re-sent to a redirect target.
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
        cache: 'no-store',
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, json, networkError: false };
    } catch {
      return { status: 0, json: null, networkError: true };
    }
  }
}
