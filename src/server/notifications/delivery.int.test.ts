import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { employeeDirectory, notificationOutbox, notifications } from '../db/schema';
import { ManagerRepository } from '../repo/managers';
import { Outbox } from '../repo/outbox';
import { App } from '../app';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const inbox = () => h.database.db.select().from(notifications).orderBy(notifications.id);
const queue = () => h.database.db.select().from(notificationOutbox).orderBy(notificationOutbox.id);

async function publishedFor(ref: string, day = 14): Promise<string> {
  const created = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: `2026-10-${day}T09:00:00+08:00`, end_at: `2026-10-${day}T17:00:00+08:00` });
  await h.call('POST', '/api/publications', { shift_ids: [created.body.shift.id] });
  return created.body.shift.id as string;
}

describe('delivery: queue to inbox', () => {
  it('turns a publish notice into one inbox row for the employee', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await publishedFor('E1');
    const report = await h.app.delivery().deliverDue();
    expect(report.notified).toBe(1);
    const [row] = await inbox();
    expect(row).toMatchObject({ recipientRef: 'E1', recipientEmail: null, kind: 'schedule_published', title: 'Your shift was published', readAt: null });
    expect((await queue())[0]!.deliveredAt).not.toBeNull();
  });

  it('waits for deliver_after, and skips cancelled notices (FR-NTF-02 undo)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const id = await publishedFor('E1');
    await h.app.delivery().deliverDue();
    await h.call('DELETE', `/api/shifts/${id}`);
    await h.app.delivery().deliverDue();
    expect((await inbox()).map((r) => r.kind)).toEqual(['schedule_published']); // deletion notice not due yet
    h.clock.advance(30);
    await h.app.delivery().deliverDue();
    expect((await inbox()).map((r) => r.kind)).toEqual(['schedule_published', 'shift_deleted']);
    const other = await publishedFor('E1');
    await h.call('DELETE', `/api/shifts/${other}`);
    await h.call('POST', '/api/shift-restorations', { shift_id: other });
    h.clock.advance(30);
    await h.app.delivery().deliverDue();
    expect((await inbox()).filter((r) => r.kind === 'shift_deleted')).toHaveLength(1);
  });

  it('sends manager notices to everyone on the Planning Manager list (D5)', async () => {
    const managers = new ManagerRepository(h.database.db, ORG);
    await managers.grant('mona@example.com', 'admin@example.com', h.clock.now());
    await managers.grant('max@example.com', 'admin@example.com', h.clock.now());
    await new Outbox(h.database.db, ORG).addForManagers('shift_claimed', null, { shift_id: await publishedFor('E1'), employee_ref: 'E1' }, h.clock.now());
    await h.app.delivery().deliverDue();
    expect((await inbox()).filter((r) => r.kind === 'shift_claimed').map((r) => r.recipientEmail).sort()).toEqual(['max@example.com', 'mona@example.com']);
  });

  it('delivers each notice once when two sweeps overlap', async () => {
    for (const ref of ['E1', 'E2', 'E3', 'E4']) {
      await h.addEmployee(ref, ref);
      await publishedFor(ref);
    }
    const lines: string[] = [];
    const app = new App({ ...h.app.deps, logger: (l) => lines.push(l) });
    await Promise.all([app.delivery().deliverDue(), app.delivery().deliverDue(), app.delivery().deliverDue()]);
    expect((await inbox()).map((r) => r.recipientRef).sort()).toEqual(['E1', 'E2', 'E3', 'E4']);
    // The unique indexes would turn a missing SKIP LOCKED into a failed (but silent) sweep, so the log must be clean.
    expect(lines.filter((l) => l.includes('[delivery] sweep failed'))).toEqual([]);
  });

  it('counts a notice with a malformed shift id as a failed attempt, without blocking the batch', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await new Outbox(h.database.db, ORG).add('shift_deleted', 'E1', null, { shift_id: 'not-a-uuid', start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z' }, h.clock.now(), h.clock.now());
    await publishedFor('E1');
    await h.app.delivery().deliverDue();
    expect((await inbox()).map((r) => r.kind)).toEqual(['schedule_published']);
    const [bad] = await h.database.db.select().from(notificationOutbox).where(eq(notificationOutbox.kind, 'shift_deleted'));
    expect(bad).toMatchObject({ attempts: 1, deliveredAt: null, lastError: expect.stringContaining('not a uuid') });
  });

  it('retries a notice that cannot be rendered, then gives up without blocking others', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await new Outbox(h.database.db, ORG).add('mystery', 'E1', null, {}, h.clock.now(), h.clock.now());
    await publishedFor('E1');
    await h.app.delivery().deliverDue();
    expect((await inbox()).map((r) => r.kind)).toEqual(['schedule_published']);
    for (let i = 0; i < 4; i++) await h.app.delivery().deliverDue();
    const [bad] = await h.database.db.select().from(notificationOutbox).where(eq(notificationOutbox.kind, 'mystery'));
    expect(bad).toMatchObject({ attempts: 5, lastError: expect.stringContaining('Unknown notification kind') });
    expect(bad!.deliveredAt).not.toBeNull();
  });
});

describe('delivery: email and badges', () => {
  it('emails employees at their directory address and managers at their list address', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await new ManagerRepository(h.database.db, ORG).grant('mona@example.com', 'admin@example.com', h.clock.now());
    const id = await publishedFor('E1');
    await new Outbox(h.database.db, ORG).addForManagers('shift_claimed', id, { shift_id: id, employee_ref: 'E1' }, h.clock.now());
    const report = await h.app.delivery().deliverDue();
    expect(report.emailed).toBe(2);
    expect(h.mailer.sent.map((m) => [m.to, m.subject]).sort()).toEqual([['ana@example.com', 'Your shift was published'], ['mona@example.com', 'Open shift claimed']]);
    expect(h.mailer.sent[0]!.text).toContain('https://');
  });

  it('records why an email cannot be sent and does not retry it (Review Focus 2)', async () => {
    await h.addEmployee('E1', 'Ana Lim'); // no email on the roster, while a colleague has one
    await h.addEmployee('E2', 'Bo Tan', null, null, 'bo@example.com');
    await publishedFor('E1');
    await h.app.delivery().deliverDue();
    h.clock.advance(3600);
    await h.app.delivery().deliverDue();
    const [row] = await inbox();
    expect(row).toMatchObject({ emailedAt: null, emailAttempts: 5, emailError: 'No email address on the roster.' });
    expect(h.mailer.sent).toEqual([]);
  });

  it('waits an hour, without counting a try, while the directory has no addresses at all (first deploy)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await publishedFor('E1');
    await h.app.delivery().deliverDue();
    const [first] = await inbox();
    expect(first).toMatchObject({ emailedAt: null, emailAttempts: 0, emailError: null });
    expect(first!.emailNextAt).toEqual(new Date(h.clock.now().getTime() + 3600_000));
    h.clock.advance(1800);
    await h.app.delivery().deliverDue();
    expect(h.mailer.sent).toEqual([]);
    await h.database.db.update(employeeDirectory).set({ email: 'ana@example.com' }).where(eq(employeeDirectory.employeeRef, 'E1'));
    h.clock.advance(1800);
    await h.app.delivery().deliverDue();
    expect(h.mailer.sent.map((m) => m.to)).toEqual(['ana@example.com']);
    expect((await inbox())[0]).toMatchObject({ emailAttempts: 1, emailError: null });
  });

  it('retries a failed email with growing delays and gives up after five tries', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await publishedFor('E1');
    h.mailer.failures = 2;
    await h.app.delivery().deliverDue(); // try 1 fails, next in 2 min
    h.clock.advance(60);
    await h.app.delivery().deliverDue(); // not due yet
    expect(h.mailer.attempts).toBe(1);
    h.clock.advance(60);
    await h.app.delivery().deliverDue(); // try 2 fails, next in 4 min
    h.clock.advance(240);
    await h.app.delivery().deliverDue(); // try 3 succeeds
    expect(h.mailer.sent).toHaveLength(1);
    expect((await inbox())[0]!.emailedAt).not.toBeNull();

    await publishedFor('E1', 15);
    h.mailer.failures = 99;
    for (let i = 0; i < 8; i++) {
      await h.app.delivery().deliverDue();
      h.clock.advance(3600);
    }
    expect((await inbox())[1]).toMatchObject({ emailedAt: null, emailAttempts: 5, emailError: 'smtp down' });
  });

  it('sends each email once when sweeps overlap', async () => {
    for (const ref of ['E1', 'E2', 'E3']) {
      await h.addEmployee(ref, ref, null, null, `${ref.toLowerCase()}@example.com`);
      await publishedFor(ref);
    }
    await h.app.delivery().expandDue();
    await Promise.all([h.app.delivery().sendEmails(), h.app.delivery().sendEmails()]);
    expect(h.mailer.sent.map((m) => m.to).sort()).toEqual(['e1@example.com', 'e2@example.com', 'e3@example.com']);
  });

  it('pushes one combined unread count for an employee who is also a manager (Review Focus 1)', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await new ManagerRepository(h.database.db, ORG).grant('ana@example.com', 'admin@example.com', h.clock.now());
    const id = await publishedFor('E1');
    await new Outbox(h.database.db, ORG).addForManagers('shift_claimed', id, { shift_id: id, employee_ref: 'E1' }, h.clock.now());
    await h.app.delivery().deliverDue();
    expect(h.badges.published.at(-1)).toEqual([{ email: 'ana@example.com', count: 2 }]);
  });

  it('never saves the recipient address from an SMTP error (DR-02)', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await publishedFor('E1');
    h.mailer.failures = 1;
    h.mailer.error = '550 <ana@example.com>: Recipient address rejected';
    await h.app.delivery().deliverDue();
    expect((await inbox())[0]!.emailError).toBe('550 <[address]>: Recipient address rejected');
  });
});

describe('delivery: failures stay contained', () => {
  const capture = (overrides: Partial<ConstructorParameters<typeof App>[0]> = {}) => {
    const lines: string[] = [];
    const app = new App({ ...h.app.deps, logger: (l) => lines.push(l), ...overrides });
    return { lines, app };
  };

  it('scrubs addresses from a badge failure log line (DR-02)', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await publishedFor('E1');
    const badges = { enabled: true, publish: async (): Promise<boolean> => { throw new Error('insert ... params: ana@example.com'); } };
    const { lines, app } = capture({ badges });
    const unread = app.notifications();
    unread.unreadCount = async () => { throw new Error('query failed for ana@example.com'); };
    const report = await app.delivery().deliverDue();
    expect(report.notified).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('@example.com');
  });

  it('swallows a badge publish that returns false or throws', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await publishedFor('E1');
    const { app } = capture({ badges: { enabled: true, publish: async () => false } });
    expect(await app.delivery().deliverDue()).toEqual({ notified: 1, emailed: 1 });
    await publishedFor('E1', 15);
    const { app: throwing } = capture({ badges: { enabled: true, publish: async () => { throw new Error('boom'); } } });
    expect(await throwing.delivery().deliverDue()).toEqual({ notified: 1, emailed: 1 });
  });

  it('makes no badge call when nothing was touched', async () => {
    const report = await h.app.delivery().deliverDue();
    expect(report).toEqual({ notified: 0, emailed: 0 });
    expect(h.badges.published).toEqual([]);
  });

  it('still pushes badges and reports the inbox rows when the email step throws', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await publishedFor('E1');
    const mailer = { send: async (): Promise<never> => { throw new Error('db down for ana@example.com'); } };
    const { lines, app } = capture({ mailer });
    expect(await app.delivery().deliverDue()).toEqual({ notified: 1, emailed: 0 });
    expect(h.badges.published).toHaveLength(1);
    expect(lines.join('\n')).toContain('email step failed');
    expect(lines.join('\n')).not.toContain('@example.com');
  });
});
describe('delivery: badge after mark-read', () => {
  it('refreshes the badge after the response, through the trigger (Review Focus 1)', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    await publishedFor('E1');
    await h.app.delivery().deliverDue();
    expect(h.badges.published.at(-1)).toEqual([{ email: 'ana@example.com', count: 1 }]);
    h.asEmployee('E1', 'ana@example.com');
    await h.call('POST', '/api/notification-reads', { all: true });
    expect(h.badges.published.at(-1)).toEqual([{ email: 'ana@example.com', count: 1 }]); // the request did not wait on the gateway
    await h.app.deliveryTrigger().kick(); // what entry.ts's after() does
    expect(h.badges.published.at(-1)).toEqual([{ email: 'ana@example.com', count: 0 }]);
  });
});

describe('delivery: badge retry', () => {
  it('keeps a badge pending when the gateway refuses it, and pushes it on the next kick', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    let accept = false;
    const published: unknown[][] = [];
    const badges = { enabled: true, publish: async (b: unknown[]) => { published.push(b); return accept; } };
    const app = new App({ ...h.app.deps, logger: () => {}, badges });
    app.deliveryTrigger().noteBadges({ refs: new Set(['E1']), emails: new Set() });
    await app.deliveryTrigger().kick();
    expect(published).toHaveLength(1);
    accept = true;
    await app.deliveryTrigger().kick();
    expect(published).toHaveLength(2);
    await app.deliveryTrigger().kick();
    expect(published).toHaveLength(2);
  });
});
