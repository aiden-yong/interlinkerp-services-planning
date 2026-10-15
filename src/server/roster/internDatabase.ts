import type { HttpClient } from '../support/http';
import type { ClientCredentials } from './clientCredentials';
import { type Roster, type RosterPerson, RosterUnavailable } from './roster';

export const PLANNABLE_STATUSES = ['Onboarding', 'Active', 'Offboarding'];
const AUDIENCE = 'intern-database';
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

type Row = Record<string, unknown>;

/** Only plain https image URLs: they end up in an <img src>. */
function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\/[^\s"'<>`]+$/i.test(value)) return null;
  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

export function toRosterPerson(row: Row): RosterPerson {
  const name = `${String(row.first_name ?? '')} ${String(row.last_name ?? '')}`.trim();
  const email = String(row.email_address ?? '').trim().toLowerCase();
  const department = row.department_id;
  return {
    ref: String(row.id),
    name: name || String(row.ref_number ?? row.id),
    email: email || null,
    photoUrl: safeImageUrl(row.photo_url),
    departmentId: typeof department === 'string' && department !== '' ? department : null,
    status: String(row.status ?? ''),
  };
}

function rows(json: unknown): Row[] {
  const data = (json as { data?: unknown; items?: unknown } | null)?.data ?? (json as { items?: unknown } | null)?.items;
  return Array.isArray(data) ? data.filter((r): r is Row => typeof r === 'object' && r !== null) : [];
}

export class InternDatabaseRoster implements Roster {
  constructor(
    private readonly http: HttpClient,
    private readonly credentials: ClientCredentials,
    private readonly baseUrl: string,
    private readonly log: (line: string) => void = (line) => console.error(line),
  ) {}

  private async get(path: string): Promise<unknown> {
    const token = await this.credentials.token(AUDIENCE);
    const result = await this.http.request('GET', `${this.baseUrl.replace(/\/+$/, '')}${path}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 6_000 });
    if (result.status !== 200 || result.json === null) throw new RosterUnavailable(`intern-database returned HTTP ${result.status}.`);
    return result.json;
  }

  async findByEmail(email: string): Promise<RosterPerson | null> {
    const wanted = email.trim().toLowerCase();
    for (const row of rows(await this.get(`/api/interns?email=${encodeURIComponent(wanted)}&limit=5`))) {
      if (String(row.email_address ?? '').trim().toLowerCase() === wanted && row.id !== undefined) return toRosterPerson(row);
    }
    return null;
  }

  async listPlannable(): Promise<RosterPerson[]> {
    const people: RosterPerson[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const json = await this.get(`/api/interns?limit=${PAGE_SIZE}&offset=${offset}`);
      const batch = rows(json);
      for (const row of batch) {
        if (row.id !== undefined && PLANNABLE_STATUSES.includes(String(row.status))) people.push(toRosterPerson(row));
      }
      const total = Number((json as { pagination?: { total?: unknown } }).pagination?.total ?? 0);
      if (batch.length < PAGE_SIZE || offset + PAGE_SIZE >= total) break;
      if (page === MAX_PAGES - 1) this.log(`[planning-api] intern-database listing stopped at the page cap (${MAX_PAGES} pages of ${PAGE_SIZE}); the roster may be incomplete.`);
    }
    return people;
  }
}
