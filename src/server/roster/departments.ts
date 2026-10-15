import type { HttpClient } from '../support/http';
import type { ClientCredentials } from './clientCredentials';
import { type DepartmentNames, RosterUnavailable } from './roster';

export class DepartmentApi implements DepartmentNames {
  constructor(
    private readonly http: HttpClient,
    private readonly credentials: ClientCredentials,
    private readonly baseUrl: string,
  ) {}

  async all(): Promise<Map<string, string>> {
    const token = await this.credentials.token('department-api');
    const result = await this.http.request('GET', `${this.baseUrl.replace(/\/+$/, '')}/api/departments?limit=200`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 6_000 });
    if (result.status !== 200 || result.json === null) throw new RosterUnavailable(`department-api returned HTTP ${result.status}.`);
    const data = Array.isArray(result.json) ? result.json : (result.json as { data?: unknown }).data;
    const names = new Map<string, string>();
    for (const row of Array.isArray(data) ? data : []) {
      if (row && typeof row === 'object' && 'id' in row && typeof (row as { name?: unknown }).name === 'string') {
        names.set(String((row as { id: unknown }).id), (row as { name: string }).name);
      }
    }
    return names;
  }
}
