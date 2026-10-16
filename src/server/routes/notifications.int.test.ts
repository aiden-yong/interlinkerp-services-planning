import { describe, expect, it } from 'vitest';
import { notifications } from '../db/schema';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

let nextOutbox = 0;
async function seed(recipientRef: string | null, recipientEmail: string | null, title: string) {
  const [row] = await h.database.db.insert(notifications).values({
    organisationId: ORG, recipientRef, recipientEmail, kind: 'shift_assigned', title, body: 'b', link: 'https://x/my', outboxId: ++nextOutbox,
    createdAt: h.clock.now(), emailNextAt: h.clock.now(),
  }).returning();
  return row!.id;
}

describe('inbox API', () => {
  it('shows an employee-and-manager both kinds of notice, newest first (Review Focus 1)', async () => {
    await seed('E1', null, 'as employee');
    await seed(null, 'ana@example.com', 'as manager');
    await seed('E2', null, 'someone else');
    h.asEmployee('E1', 'Ana@Example.com');
    const { status, body } = await h.call('GET', '/api/notifications');
    expect(status).toBe(200);
    expect(body.notifications.map((n: { title: string }) => n.title)).toEqual(['as manager', 'as employee']);
    expect(body.unread_count).toBe(2);
  });

  it('marks chosen or all notices read, and never other people\'s', async () => {
    const mine = await seed('E1', null, 'one');
    await seed('E1', null, 'two');
    const theirs = await seed('E2', null, 'not mine');
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/notification-reads', { ids: [mine, theirs] })).body).toEqual({ marked: 1 });
    expect((await h.call('GET', '/api/notifications', undefined, { unread: 'true' })).body.notifications.map((n: { title: string }) => n.title)).toEqual(['two']);
    expect((await h.call('POST', '/api/notification-reads', { all: true })).body).toEqual({ marked: 1 });
    expect((await h.call('GET', '/api/notifications')).body.unread_count).toBe(0);
  });

  it('validates the request', async () => {
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/notification-reads', {})).status).toBe(422);
    expect((await h.call('POST', '/api/notification-reads', { ids: ['x'] })).status).toBe(422);
    expect((await h.call('GET', '/api/notifications', undefined, { before: 'soon' })).status).toBe(422);
    expect((await h.call('GET', '/api/notifications', undefined, { before: '1e300' })).status).toBe(422);
    expect((await h.call('POST', '/api/notification-reads', { ids: [1e300] })).status).toBe(422);
    expect((await h.call('GET', '/api/notifications', undefined, { unread: 'maybe' })).status).toBe(422);
    expect((await h.call('GET', '/api/notifications', undefined, { unread: 'false' })).status).toBe(200);
  });
});
