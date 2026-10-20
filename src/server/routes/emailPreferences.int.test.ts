import { describe, expect, it } from 'vitest';
import { notifications } from '../db/schema';
import { ManagerRepository } from '../repo/managers';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

/** Backlog item 29: email can be turned off per notice type; in-app notices always arrive. */
const h = useApiHarness();
const PATH = '/api/my/notification-preferences';

async function publishedFor(ref: string): Promise<string> {
  h.asManager();
  const created = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' });
  await h.call('POST', '/api/publications', { shift_ids: [created.body.shift.id] });
  return created.body.shift.id as string;
}

describe('email preferences', () => {
  it('lists only the notice types a person receives, all emailed by default', async () => {
    h.asEmployee('E1', 'ana@example.com', false);
    const employee = (await h.call('GET', PATH)).body.preferences;
    expect(employee.map((p: { kind: string }) => p.kind)).toContain('schedule_published');
    expect(employee.map((p: { audience: string }) => p.audience)).not.toContain('managers');
    expect(employee.every((p: { email: boolean }) => p.email)).toBe(true);

    h.asEmployee(null, 'mona@example.com', true);
    expect((await h.call('GET', PATH)).body.preferences.map((p: { kind: string }) => p.kind)).toEqual(['shift_claimed', 'shift_switched', 'shift_given_up']);
  });

  it('turns email off and on again, and refuses types the person does not receive', async () => {
    h.asEmployee('E1', 'ana@example.com', false);
    const off = await h.call('PATCH', PATH, { email: { schedule_published: false } });
    expect(off.status).toBe(200);
    expect(off.body.preferences.find((p: { kind: string }) => p.kind === 'schedule_published').email).toBe(false);
    const on = await h.call('PATCH', PATH, { email: { schedule_published: true } });
    expect(on.body.preferences.find((p: { kind: string }) => p.kind === 'schedule_published').email).toBe(true);

    const bad = await h.call('PATCH', PATH, { email: { shift_claimed: false, nonsense: false, shift_changed: 'no' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toEqual({
      'email.shift_claimed': 'You do not receive this notice type.',
      'email.nonsense': 'Unknown notice type.',
      'email.shift_changed': 'Must be true or false.',
    });
    expect((await h.call('PATCH', PATH, {})).status).toBe(422);
  });

  it('keeps the in-app notice but skips the email for a muted type', async () => {
    await h.addEmployee('E1', 'Ana Lim', null, null, 'ana@example.com');
    h.asEmployee('E1', 'ana@example.com', false);
    await h.call('PATCH', PATH, { email: { schedule_published: false } });
    await publishedFor('E1');
    await h.app.delivery().deliverDue();
    expect(h.mailer.sent).toEqual([]);
    const [row] = await h.database.db.select().from(notifications);
    expect(row).toMatchObject({ recipientRef: 'E1', kind: 'schedule_published', emailedAt: null, emailError: 'Skipped: email turned off for this notice type.' });
  });

  it('mutes manager notices by email address, for that manager only', async () => {
    const managers = new ManagerRepository(h.database.db, ORG);
    await managers.grant('mona@example.com', 'admin@example.com', h.clock.now());
    await managers.grant('max@example.com', 'admin@example.com', h.clock.now());
    h.asEmployee(null, 'mona@example.com', true);
    await h.call('PATCH', PATH, { email: { shift_claimed: false } });
    await new Outbox(h.database.db, ORG).addForManagers('shift_claimed', null, { shift_id: await publishedFor('E1'), employee_ref: 'E1' }, h.clock.now());
    await h.app.delivery().deliverDue();
    expect(h.mailer.sent.filter((m) => m.subject === 'Open shift claimed').map((m) => m.to)).toEqual(['max@example.com']);
  });
});
