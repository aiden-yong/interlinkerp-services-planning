import { describe, expect, it } from 'vitest';
import { notificationOutbox, notifications, rateLimits } from '../db/schema';
import { ORG, useTestDatabase } from '../test/db';
import { Retention } from './retention';

const database = useTestDatabase();
const now = new Date('2026-10-20T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('Retention (backlog item 23)', () => {
  it('removes read notices after 90 days, finished outbox rows after 30 days and idle rate buckets after a day', async () => {
    const notice = (title: string, readAt: Date | null, org = ORG) => ({
      organisationId: org, recipientRef: 'E1', kind: 'shift_assigned', title, body: 'b', link: 'https://x/my', outboxId: Math.floor(Math.random() * 1e9),
      createdAt: daysAgo(200), readAt, emailNextAt: daysAgo(200),
    });
    await database.db.insert(notifications).values([
      notice('old read', daysAgo(91)), notice('recent read', daysAgo(89)), notice('old unread', null), notice('other org', daysAgo(91), 'other-org'),
    ]);
    const queued = (deliveredAt: Date | null, cancelledAt: Date | null) => ({ organisationId: ORG, kind: 'shift_assigned', payload: {}, deliverAfter: daysAgo(60), createdAt: daysAgo(60), deliveredAt, cancelledAt });
    await database.db.insert(notificationOutbox).values([queued(daysAgo(31), null), queued(null, daysAgo(31)), queued(daysAgo(29), null), queued(null, null)]);
    await database.db.insert(rateLimits).values([
      { organisationId: ORG, bucket: 'person:idle', tokens: 60, updatedAt: daysAgo(2) },
      { organisationId: ORG, bucket: 'person:busy', tokens: 10, updatedAt: daysAgo(0.5) },
    ]);

    expect(await new Retention(database.db, ORG).run(now)).toEqual({ notifications: 1, outbox: 2, rate_limits: 1 });
    expect((await database.db.select().from(notifications)).map((n) => n.title).sort()).toEqual(['old unread', 'other org', 'recent read']);
    expect(await database.db.select().from(notificationOutbox)).toHaveLength(2);
    expect((await database.db.select().from(rateLimits)).map((r) => r.bucket)).toEqual(['person:busy']);
  });
});
