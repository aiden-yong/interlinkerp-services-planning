import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { notificationOutbox, notifications } from '../db/schema';
import { ManagerRepository } from '../repo/managers';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const inbox = () => h.database.db.select().from(notifications).orderBy(notifications.id);
const queue = () => h.database.db.select().from(notificationOutbox).orderBy(notificationOutbox.id);

async function publishedFor(ref: string): Promise<string> {
  const created = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' });
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
    await Promise.all([h.app.delivery().deliverDue(), h.app.delivery().deliverDue(), h.app.delivery().deliverDue()]);
    expect((await inbox()).map((r) => r.recipientRef).sort()).toEqual(['E1', 'E2', 'E3', 'E4']);
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
