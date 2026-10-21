import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { calendarFeeds, employeeDirectory } from '../db/schema';
import { useApiHarness } from '../test/harness';

/** FR-MYP-03, D22, D23: a secret, resettable, read-only feed that needs no gateway session. */
const h = useApiHarness();
const PATH = '/api/my/calendar-feed';

async function shift(ref: string, start: string, publish: boolean, extra: Record<string, unknown> = {}): Promise<string> {
  h.asManager();
  const created = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: start, end_at: start.replace('T09', 'T17'), ...extra });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  if (publish) expect((await h.call('POST', '/api/publications', { shift_ids: [created.body.shift.id] })).status).toBe(201);
  return created.body.shift.id as string;
}

const fetchFeed = (url: string) => h.app.kernel().handle(new Request(url));

async function enable(ref: string, email: string): Promise<string> {
  const response = await h.callAs(ref, email, 'POST', PATH);
  expect(response.status).toBe(201);
  return response.body.url as string;
}

describe('calendar feed', () => {
  it('gives an employee a private feed of published shifts', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await h.addEmployee('E2', 'Ben Tan', null, null, 'ben@example.com');
    const role = await h.addRole('Cashier');
    const published = await shift('E1', '2026-10-14T09:00:00+08:00', true, { role_id: role, break_minutes: 30, note: 'Bring keys; ids' });
    const draft = await shift('E1', '2026-10-15T09:00:00+08:00', false);
    const other = await shift('E2', '2026-10-16T09:00:00+08:00', true);

    expect((await h.callAs('E1', 'ana@example.com', 'GET', PATH)).body).toEqual({ enabled: false });
    const url = await enable('E1', 'ana@example.com');
    expect(url).toMatch(/^https:\/\/planning\.test\/feeds\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    expect((await h.callAs('E1', 'ana@example.com', 'GET', PATH)).body).toEqual({ enabled: true });

    h.asNobody();
    const response = await fetchFeed(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=900');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const text = (await response.text()).replace(/\r\n /g, '');
    expect(text).toContain(`UID:${published}@planning.test`);
    expect(text).toContain('SUMMARY:Cashier');
    expect(text).toContain('DESCRIPTION:Break: 30 min\\nBring keys\\; ids');
    expect(text).toContain('DTSTART:20261014T010000Z');
    expect(text).not.toContain(draft);
    expect(text).not.toContain(other);

    const token = new URL(url).pathname.split('/').pop()!.replace('.ics', '');
    const [row] = await h.database.db.select().from(calendarFeeds);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.tokenHash).not.toContain(token);
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it('follows reassignment and reset', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await h.addEmployee('E2', 'Ben Tan', null, null, 'ben@example.com');
    const id = await shift('E1', '2026-10-14T09:00:00+08:00', true);
    const first = await enable('E1', 'ana@example.com');
    const second = await enable('E2', 'ben@example.com');
    expect(await (await fetchFeed(first)).text()).toContain(id);

    h.asManager();
    const moved = await h.call('PATCH', `/api/shifts/${id}`, { employee_ref: 'E2', version: 1 });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(await (await fetchFeed(first)).text()).not.toContain(id);
    expect(await (await fetchFeed(second)).text()).toContain(id);

    const renewed = await enable('E1', 'ana@example.com');
    expect(renewed).not.toBe(first);
    const old = await fetchFeed(first);
    expect(old.status).toBe(404);
    expect((await old.json()).error.code).toBe('RESOURCE_NOT_FOUND');
    expect((await fetchFeed(renewed)).status).toBe(200);
  });

  it('stops when turned off or when the employee leaves the roster', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await h.addEmployee('E2', 'Ben Tan', null, null, 'ben@example.com');
    const url = await enable('E1', 'ana@example.com');
    expect((await fetchFeed(url)).status).toBe(200);
    expect((await h.callAs('E1', 'ana@example.com', 'DELETE', PATH)).status).toBe(204);
    expect((await fetchFeed(url)).status).toBe(404);
    expect((await h.callAs('E1', 'ana@example.com', 'GET', PATH)).body).toEqual({ enabled: false });

    const again = await enable('E1', 'ana@example.com');
    expect((await fetchFeed(again)).status).toBe(200);
    await h.database.db.delete(employeeDirectory).where(eq(employeeDirectory.employeeRef, 'E1'));
    expect((await fetchFeed(again)).status).toBe(404);
  });

  it('answers 404 for names that are not a token', async () => {
    for (const file of ['nope.ics', 'nope.txt', 'nope', '.ics']) expect((await fetchFeed(`https://planning.test/feeds/calendar/${file}`)).status, file).toBe(404);
  });

  it('rate-limits a token', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    const url = await enable('E1', 'ana@example.com');
    for (let i = 0; i < 20; i++) expect((await fetchFeed(url)).status, `call ${i}`).toBe(200);
    const limited = await fetchFeed(url);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('RATE_LIMITED');
    expect(limited.headers.get('Retry-After')).not.toBeNull();
  });

  it('refuses a feed for someone not on the roster', async () => {
    h.asEmployee(null, 'nobody@example.com', false);
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await h.call(method, PATH);
      expect(response.status, method).toBe(403);
      expect(response.body.error.code).toBe('NOT_ON_ROSTER');
    }
  });
});
