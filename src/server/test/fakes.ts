import type { HolidayProvider } from '../holidays/provider';
import type { BadgeCount, BadgePublisher } from '../notifications/badges';
import type { MailMessage, Mailer, SendResult } from '../notifications/mailer';
import type { DepartmentNames, Roster, RosterPerson } from '../roster/roster';
import { RosterUnavailable } from '../roster/roster';
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

export class FakeRoster implements Roster {
  readonly people = new Map<string, RosterPerson>();
  down = false;

  add(ref: string, name: string, email: string | null = null, departmentId: string | null = null, status = 'Active'): RosterPerson {
    const person = { ref, name, email: email?.toLowerCase() ?? null, photoUrl: null, departmentId, status };
    this.people.set(person.email ?? ref, person);
    return person;
  }

  async findByEmail(email: string): Promise<RosterPerson | null> {
    if (this.down) throw new RosterUnavailable('roster is down');
    return this.people.get(email.toLowerCase()) ?? null;
  }

  async listPlannable(): Promise<RosterPerson[]> {
    if (this.down) throw new RosterUnavailable('roster is down');
    return [...this.people.values()];
  }
}

export class FakeDepartments implements DepartmentNames {
  names = new Map<string, string>();
  down = false;

  async all(): Promise<Map<string, string>> {
    if (this.down) throw new Error('department-api is down');
    return this.names;
  }
}

export class FakeHolidayProvider implements HolidayProvider {
  configured = false;
  list: { key: string; date: string; name: string }[] = [];
  readonly calls: [number, string, string | null][] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async holidays(year: number, country: string, region: string | null) {
    this.calls.push([year, country, region]);
    return this.list.map((h) => ({ ...h }));
  }
}

export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  attempts = 0;
  /** How many of the next sends fail, and with what message. */
  failures = 0;
  error = 'smtp down';

  async send(message: MailMessage): Promise<SendResult> {
    this.attempts++;
    if (this.failures > 0) {
      this.failures--;
      return { ok: false, error: this.error };
    }
    this.sent.push(message);
    return { ok: true };
  }
}

export class FakeBadges implements BadgePublisher {
  readonly enabled = true;
  readonly published: BadgeCount[][] = [];

  async publish(badges: BadgeCount[]): Promise<boolean> {
    this.published.push(badges);
    return true;
  }
}
