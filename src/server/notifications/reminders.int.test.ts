import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { notifications, shifts } from '../db/schema';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const inbox = () => h.database.db.select().from(notifications).orderBy(notifications.id);
const remindedAt = async (id: string) => (await h.database.db.select().from(shifts).where(eq(shifts.id, id)))[0]!.remindedAt;
const iso = (offsetMinutes: number) => new Date(h.clock.now().getTime() + offsetMinutes * 60_000).toISOString();
const reminders = async () => (await inbox()).filter((n) => n.kind === 'shift_reminder');

async function shiftFor(ref: string | null, startInMinutes: number, publish = true): Promise<string> {
  const created = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: iso(startInMinutes), end_at: iso(startInMinutes + 480) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  if (publish) expect((await h.call('POST', '/api/publications', { shift_ids: [created.body.shift.id] })).status).toBe(201);
  return created.body.shift.id as string;
}

describe('shift reminders (FR-NTF-05)', () => {
  it('reminds once within the lead time', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shiftFor('E1', 50);
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(1);
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(0);
    await h.app.delivery().deliverDue();
    const sent = await reminders();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ recipientRef: 'E1', title: 'Your shift starts soon' });
  });

  it('reminds again after the shift moves, but not after an edit that keeps start and person', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await shiftFor('E1', 50);
    await h.app.reminders().queueDue(h.clock.now());
    expect(await remindedAt(id)).not.toBeNull();

    const noted = await h.call('PATCH', `/api/shifts/${id}`, { version: 1, note: 'Bring keys' });
    expect(noted.status, JSON.stringify(noted.body)).toBe(200);
    expect(await remindedAt(id)).not.toBeNull();

    const moved = await h.call('PATCH', `/api/shifts/${id}`, { version: 2, start_at: iso(24 * 60), end_at: iso(24 * 60 + 480) });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(await remindedAt(id)).toBeNull();
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(0);

    h.clock.advance((24 * 60 - 50) * 60);
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(1);
  });

  it('reminds the new person after a take-over', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    const id = await shiftFor('E1', 50);
    await h.app.reminders().queueDue(h.clock.now());
    expect((await h.callAs('E1', 'ana@example.com', 'POST', '/api/switch-requests', { shift_id: id })).status).toBe(201);
    expect((await h.callAs('E2', 'bo@example.com', 'POST', '/api/switch-takeovers', { shift_id: id })).status).toBe(201);
    expect(await remindedAt(id)).toBeNull();
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(1);
    await h.app.delivery().deliverDue();
    expect((await reminders()).map((n) => n.recipientRef).sort()).toEqual(['E1', 'E2']);
  });

  it('skips drafts, open shifts, started shifts, shifts beyond the lead time and lead time Off', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    for (const ref of ['E2', 'E3', 'E4']) await h.addEmployee(ref, ref);
    await shiftFor('E1', 50, false);
    await shiftFor(null, 50);
    await shiftFor('E2', 3 * 24 * 60);
    const started = await shiftFor('E3', 50);
    h.clock.advance(51 * 60);
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(0);
    expect(await remindedAt(started)).toBeNull();

    h.clock.advance(-51 * 60);
    expect((await h.call('PATCH', '/api/settings', { reminder_lead_minutes: 0 })).status).toBe(200);
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(0);
    expect((await h.call('PATCH', '/api/settings', { reminder_lead_minutes: 60 })).status).toBe(200);
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(1);
  });

  it('reminds the person who claims a shift after the first owner gave it up', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    expect((await h.call('PATCH', '/api/settings', { reminder_lead_minutes: 1440 })).status).toBe(200);
    const id = await shiftFor('E1', 50);
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(1);
    expect((await h.call('PATCH', '/api/settings', { give_up_mode: 'unassign', unassign_window_days: 0 })).status).toBe(200);
    const gaveUp = await h.callAs('E1', 'ana@example.com', 'POST', '/api/unassignments', { shift_id: id });
    expect(gaveUp.status, JSON.stringify(gaveUp.body)).toBe(201);
    const claimed = await h.callAs('E2', 'bo@example.com', 'POST', '/api/shift-claims', { shift_id: id });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(201);
    expect(await remindedAt(id)).toBeNull();
    expect(await h.app.reminders().queueDue(h.clock.now())).toBe(1);
  });

  it('still delivers when queueing reminders fails', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shiftFor('E1', 3 * 24 * 60);
    const lines: string[] = [];
    const app = new App({ ...h.app.deps, cronSecret: 'right', logger: (l) => lines.push(l) });
    vi.spyOn(app.reminders(), 'queueDue').mockRejectedValue(new Error('db down'));
    const ok = await app.kernel().handle(new Request('http://localhost/internal/cron/sweep', { headers: { authorization: 'Bearer right' } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ reminded: 0, notified: 1 });
    expect(lines.some((l) => l.includes('[reminders] queueing failed: db down'))).toBe(true);
    const daily = await app.kernel().handle(new Request('http://localhost/internal/cron/notifications', { headers: { authorization: 'Bearer right' } }));
    expect(daily.status).toBe(200);
    expect(await daily.json()).toMatchObject({ reminded: 0 });
  });

  it('queues reminders ahead of delivery in the after-response sweep', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shiftFor('E1', 50);
    await h.app.deliveryTrigger().kick();
    expect(await reminders()).toHaveLength(1);
  });
});

describe('GET /internal/cron/sweep', () => {
  it('needs the secret and delivers', async () => {
    const app = new App({ ...h.app.deps, cronSecret: 'right' });
    const call = (auth?: string) => app.kernel().handle(new Request('http://localhost/internal/cron/sweep', { headers: auth ? { authorization: auth } : {} }));
    await h.addEmployee('E1', 'Ana Lim');
    await shiftFor('E1', 50);
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    const ok = await call('Bearer right');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ reminded: 1, notified: expect.any(Number) });
    expect(await reminders()).toHaveLength(1);
    expect(await app.jobRuns().lastStarted('sweep')).toEqual(h.clock.now());
  });
});
