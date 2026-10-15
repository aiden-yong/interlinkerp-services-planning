import { describe, expect, it } from 'vitest';
import { FakeHttpClient, FixedClock, reply } from '../test/fakes';
import { ClientCredentials } from './clientCredentials';
import { InternDatabaseRoster, toRosterPerson } from './internDatabase';
import { RosterUnavailable } from './roster';

const BASE = 'https://interns.test';

function roster(http: FakeHttpClient): InternDatabaseRoster {
  http.on('POST', 'https://gw.test/oauth/token', reply(200, { access_token: 'tok', expires_in: 3600 }));
  return new InternDatabaseRoster(http, new ClientCredentials(http, 'https://gw.test', 'id', 's', FixedClock.at('2026-10-13T00:00:00Z')), BASE);
}

const intern = (id: string, email: string, status = 'Active') => ({
  id, ref_number: `INT-${id}`, first_name: 'Ana', last_name: `Lim ${id}`, email_address: email, department_id: 'DEP-1', photo_url: 'https://img.test/a.png', status,
});

describe('InternDatabaseRoster', () => {
  it('finds a person by email, ignoring case, with a bearer token', async () => {
    const http = new FakeHttpClient().on('GET', `${BASE}/api/interns?email=`, reply(200, { data: [intern('u1', 'Ana@Example.com')] }));
    const person = await roster(http).findByEmail('ana@example.com');
    expect(person).toMatchObject({ ref: 'u1', name: 'Ana Lim u1', departmentId: 'DEP-1', photoUrl: 'https://img.test/a.png' });
    expect(http.requests[1].headers.Authorization).toBe('Bearer tok');
  });

  it('ignores rows whose email does not match', async () => {
    const http = new FakeHttpClient().on('GET', `${BASE}/api/interns?email=`, reply(200, { data: [intern('u1', 'other@example.com')] }));
    expect(await roster(http).findByEmail('ana@example.com')).toBeNull();
  });

  it('pages through the roster and keeps plannable statuses only', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => intern(`a${i}`, `a${i}@x.test`));
    const page2 = [intern('b1', 'b1@x.test', 'Former'), intern('b2', 'b2@x.test', 'Offboarding')];
    const http = new FakeHttpClient()
      .on('GET', `${BASE}/api/interns?limit=200&offset=0`, reply(200, { data: page1, pagination: { total: 202 } }))
      .on('GET', `${BASE}/api/interns?limit=200&offset=200`, reply(200, { data: page2, pagination: { total: 202 } }));
    const people = await roster(http).listPlannable();
    expect(people).toHaveLength(201);
    expect(people[200].ref).toBe('b2');
  });

  it('drops unsafe photo URLs', () => {
    expect(toRosterPerson({ ...intern('u1', 'a@x.test'), photo_url: 'javascript:alert(1)' }).photoUrl).toBeNull();
  });

  it('raises RosterUnavailable on service errors', async () => {
    const http = new FakeHttpClient().on('GET', `${BASE}/api/interns`, reply(500, {}));
    await expect(roster(http).listPlannable()).rejects.toBeInstanceOf(RosterUnavailable);
  });
});
