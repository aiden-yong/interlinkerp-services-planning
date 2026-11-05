import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { App } from '../app';
import { employeeDirectory, jobRuns, roles, shifts } from '../db/schema';
import { ORG, useTestDatabase } from '../test/db';
import { DEMO_EMPLOYEE_REF, demoSession } from './demo';
import { DemoAccessGuard } from './demoGuard';
import { DemoSeeder } from './seeder';
import { SessionCodec } from '../auth/session';
import { systemClock } from '../support/clock';

const ZONE = 'Asia/Kuala_Lumpur';
const DAY_MS = 86_400_000;
const CLAIMED_DEMO_URL = 'postgres://x/planning_demo';

describe('DemoSeeder', () => {
  const database = useTestDatabase();
  const seeder = (at = new Date(), url = CLAIMED_DEMO_URL) => new DemoSeeder(database.db, ORG, ZONE, { now: () => at }, 'https://demo.test', url);
  const count = async (table: typeof roles | typeof shifts) => (await database.db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

  it('refuses a database whose name does not contain demo, before touching anything', async () => {
    const real = seeder(new Date(), 'postgres://x/planning');
    await expect(real.ensureReady()).rejects.toThrow(/Refusing/);
    await expect(real.reset()).rejects.toThrow(/Refusing/);
    expect(await count(roles)).toBe(0);
  });

  it('loads once, and a second sign-in leaves visitors changes alone', async () => {
    await seeder().ensureReady();
    expect(await count(roles)).toBe(5);
    await database.db.delete(shifts).where(eq(shifts.note, 'Weekend desk cover'));
    const before = await count(shifts);
    await seeder().ensureReady();
    expect(await count(shifts)).toBe(before);
  });

  it('replaces sample data six months old, so a late visitor still opens on a full week', async () => {
    const start = new Date('2026-01-05T04:00:00Z');
    await seeder(start).ensureReady();
    const later = new Date(start.getTime() + 182 * DAY_MS);
    await seeder(later).ensureReady();
    const [marker] = await database.db.select().from(jobRuns).where(and(eq(jobRuns.organisationId, ORG), eq(jobRuns.job, 'demo_seed')));
    expect(marker!.startedAt.getTime()).toBe(later.getTime());
    const ahead = await database.db.select().from(shifts).where(and(isNull(shifts.employeeRef), gt(shifts.startAt, later), lt(shifts.startAt, new Date(later.getTime() + 7 * DAY_MS))));
    expect(ahead.length).toBeGreaterThan(0);
  });

  it('keeps visitors changes until the week ends, then starts the new week on fresh data', async () => {
    await seeder(new Date('2026-01-05T04:00:00Z')).ensureReady(); // Monday, midday in the demo's zone
    const original = await count(shifts);
    await database.db.delete(shifts).where(eq(shifts.note, 'Weekend desk cover'));
    const changed = await count(shifts);
    expect(changed).toBeLessThan(original);
    await seeder(new Date('2026-01-11T15:30:00Z')).ensureReady(); // Sunday, 23:30 there
    expect(await count(shifts)).toBe(changed);
    await seeder(new Date('2026-01-11T16:30:00Z')).ensureReady(); // Monday, 00:30 there
    expect(await count(shifts)).toBe(original);
  });

  it('keeps the directory from looking stale between reloads', async () => {
    const start = new Date('2026-01-05T04:00:00Z');
    await seeder(start).ensureReady();
    const nextDay = new Date(start.getTime() + DAY_MS);
    await seeder(nextDay).ensureReady();
    const [person] = await database.db.select().from(employeeDirectory).where(eq(employeeDirectory.employeeRef, DEMO_EMPLOYEE_REF));
    expect(person!.fetchedAt.getTime()).toBe(nextDay.getTime());
  });

  it('reset restores the original data', async () => {
    await seeder().reset();
    const original = await count(shifts);
    await database.db.delete(shifts);
    await database.db.insert(roles).values({ id: crypto.randomUUID(), organisationId: ORG, name: 'Visitor role', color: '#000000', createdAt: new Date(), updatedAt: new Date() });
    await seeder().reset();
    expect(await count(shifts)).toBe(original);
    expect(await count(roles)).toBe(5);
  });

  it('gives the real services what they need: a full board, and shifts the demo visitor can claim and take', async () => {
    const now = new Date();
    await seeder(now).reset();
    const app = new App({ database, organisationId: ORG, defaultTimezone: ZONE, clock: { now: () => now }, demo: true, publicUrl: 'https://demo.test', rateLimit: null, guard: new DemoAccessGuard(new SessionCodec('s'.repeat(32), systemClock), true) });
    const cookie = new SessionCodec('s'.repeat(32), systemClock).issue(demoSession(), true).split(';')[0]!;
    const get = async (path: string) => {
      const response = await app.kernel().handle(new Request(`https://demo.test${path}`, { headers: { cookie } }));
      expect(response.status).toBe(200);
      return response.json();
    };
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    // Starts a week back so the current week is covered in full, whatever day of it the test runs on.
    const range = `from=${day(now.getTime() - 7 * DAY_MS)}&to=${day(now.getTime() + 21 * DAY_MS)}`;

    const me = await get('/api/me');
    expect(me).toMatchObject({ is_manager: true, employee_ref: DEMO_EMPLOYEE_REF, demo: true, dev_identity: false });

    const board = await get(`/api/schedule?${range}&timezone=${encodeURIComponent(ZONE)}`);
    expect(board.directory_stale).toBe(false);
    expect(board.employees).toHaveLength(12);
    const rules = new Set(board.shifts.flatMap((s: { conflicts: { rule: string }[] }) => s.conflicts.map((c) => c.rule)));
    expect(rules).toEqual(new Set(['overlap', 'unavailable', 'role']));

    const open = await get(`/api/my/open-shifts?${range}`);
    expect(open.open.length).toBeGreaterThan(0);
    expect(open.up_for_switch.length).toBeGreaterThan(0);

    const inbox = await get('/api/notifications');
    expect(inbox.unread_count).toBeGreaterThan(0);
  });

  it('gives the employee view a real employee experience: own shifts, things to claim, and no manager data', async () => {
    const now = new Date();
    await seeder(now).reset();
    const codec = new SessionCodec('s'.repeat(32), systemClock);
    const app = new App({ database, organisationId: ORG, defaultTimezone: ZONE, clock: { now: () => now }, demo: true, publicUrl: 'https://demo.test', rateLimit: null, guard: new DemoAccessGuard(codec, true) });
    const cookie = codec.issue(demoSession('employee'), true).split(';')[0]!;
    const call = (path: string) => app.kernel().handle(new Request(`https://demo.test${path}`, { headers: { cookie } }));
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const range = `from=${day(now.getTime())}&to=${day(now.getTime() + 21 * DAY_MS)}`;

    expect(await (await call('/api/me')).json()).toMatchObject({ is_manager: false, employee_ref: 'SVC-002', demo: true });
    expect((await call(`/api/schedule?${range}&timezone=${encodeURIComponent(ZONE)}`)).status).toBe(403);
    expect((await call('/api/employees')).status).toBe(403);
    const mine = await (await call(`/api/my/shifts?${range}`)).json();
    expect(mine.shifts.length).toBeGreaterThan(0);
    const open = await (await call(`/api/my/open-shifts?${range}`)).json();
    expect(open.open.length).toBeGreaterThan(0);
    expect(open.up_for_switch.length).toBeGreaterThan(0);
    expect((await (await call('/api/notifications')).json()).unread_count).toBeGreaterThan(0);
  });

  it("gives Auto Plan something to fill and something to explain in the week the board opens on, on any day of it", async () => {
    // From a Monday morning to the Sunday: the whole opening week. Later in the week, shifts already started drop out, but the weekend ones remain.
    for (const at of ['2026-11-02T01:00:00Z', '2026-11-07T01:00:00Z']) {
      const now = new Date(at);
      await seeder(now).reset();
      const app = new App({ database, organisationId: ORG, defaultTimezone: ZONE, clock: { now: () => now }, demo: true, publicUrl: 'https://demo.test', rateLimit: null, guard: new DemoAccessGuard(new SessionCodec('s'.repeat(32), { now: () => now }), true) });
      const cookie = new SessionCodec('s'.repeat(32), { now: () => now }).issue(demoSession(), true).split(';')[0]!;
      const response = await app.kernel().handle(new Request('https://demo.test/api/auto-plans', {
        method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '2026-11-02', to: '2026-11-08', timezone: ZONE }),
      }));
      expect(response.status).toBe(201);
      const report = await response.json();
      expect(report.filled.length).toBeGreaterThan(0);
      expect(report.unfilled.length).toBeGreaterThan(0);
    }
  });
});
