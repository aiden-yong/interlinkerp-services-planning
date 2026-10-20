import { and, eq, isNotNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notificationOutbox, notifications, rateLimits } from '../db/schema';

/**
 * Backlog item 23: how long finished rows are kept. Unread notices are never removed. Agree these periods with the
 * data owner; changing them needs only this constant.
 */
export const RETENTION = { readNoticeDays: 90, finishedOutboxDays: 30, idleRateLimitHours: 24 } as const;

export interface PruneReport {
  notifications: number;
  outbox: number;
  rate_limits: number;
}

const DAY_MS = 86_400_000;

/** Run by the daily notifications cron, so the inbox, the outbox and the rate-limit buckets stop growing forever. */
export class Retention {
  constructor(private readonly db: Db, private readonly org: string) {}

  async run(now: Date): Promise<PruneReport> {
    const before = (ms: number) => new Date(now.getTime() - ms);
    const read = await this.db.delete(notifications)
      .where(and(eq(notifications.organisationId, this.org), isNotNull(notifications.readAt), lt(notifications.readAt, before(RETENTION.readNoticeDays * DAY_MS))))
      .returning({ id: notifications.id });
    const outboxCutoff = before(RETENTION.finishedOutboxDays * DAY_MS);
    const outbox = await this.db.delete(notificationOutbox)
      .where(and(eq(notificationOutbox.organisationId, this.org), or(lt(notificationOutbox.deliveredAt, outboxCutoff), lt(notificationOutbox.cancelledAt, outboxCutoff))))
      .returning({ id: notificationOutbox.id });
    const buckets = await this.db.delete(rateLimits)
      .where(and(eq(rateLimits.organisationId, this.org), lt(rateLimits.updatedAt, before(RETENTION.idleRateLimitHours * 3600_000))))
      .returning({ bucket: rateLimits.bucket });
    return { notifications: read.length, outbox: outbox.length, rate_limits: buckets.length };
  }
}
