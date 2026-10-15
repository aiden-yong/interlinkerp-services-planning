import type { Clock } from '../support/clock';
import type { HttpClient, HttpResult } from '../support/http';

export class FixedClock implements Clock {
  private current: Date;

  private constructor(at: Date) {
    this.current = at;
  }

  static at(iso: string): FixedClock {
    return new FixedClock(new Date(iso));
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

export const reply = (status: number, json: unknown): HttpResult => ({ status, json, networkError: false });

/** Answers by method + URL prefix, in registration order. Unmatched requests are network failures. */
export class FakeHttpClient implements HttpClient {
  private readonly routes: { method: string; prefix: string; results: HttpResult[] }[] = [];
  readonly requests: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];

  on(method: string, prefix: string, ...results: HttpResult[]): this {
    this.routes.push({ method, prefix, results });
    return this;
  }

  async request(method: string, url: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<HttpResult> {
    this.requests.push({ method, url, headers: options.headers ?? {}, body: options.body });
    for (const route of this.routes) {
      if (route.method === method && url.startsWith(route.prefix)) return route.results.length > 1 ? route.results.shift()! : route.results[0];
    }
    return { status: 0, json: null, networkError: true };
  }
}

/** "planning_session=abc.def; Path=/; ..." -> "abc.def" */
export function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
}
