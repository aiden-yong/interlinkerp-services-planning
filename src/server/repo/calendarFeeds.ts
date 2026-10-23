import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { calendarFeeds } from '../db/schema';
import type { RateLimitPolicy } from './rateLimits';

/** A burst of 20 fetches per token, then one every 30 seconds: far above any calendar app's refresh rate. */
export const FEED_LIMIT: RateLimitPolicy = { capacity: 20, perSecond: 1 / 30 };

/** FR-MYP-03: one private feed per employee. Only the SHA-256 hex of the token is stored. */
export class CalendarFeedRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async find(ref: string): Promise<{ createdAt: Date } | null> {
    const [row] = await this.db.select({ createdAt: calendarFeeds.createdAt }).from(calendarFeeds)
      .where(and(eq(calendarFeeds.organisationId, this.org), eq(calendarFeeds.employeeRef, ref))).limit(1);
    return row ?? null;
  }

  /** Looks the hash up through its unique index; tokens are never compared one by one. */
  async byTokenHash(hash: string): Promise<{ employeeRef: string } | null> {
    const [row] = await this.db.select({ employeeRef: calendarFeeds.employeeRef }).from(calendarFeeds)
      .where(and(eq(calendarFeeds.organisationId, this.org), eq(calendarFeeds.tokenHash, hash))).limit(1);
    return row ?? null;
  }

  /** Turns the feed on or replaces its token, so the old link stops working. */
  async upsert(ref: string, tokenHash: string, now: Date): Promise<void> {
    await this.db.insert(calendarFeeds).values({ organisationId: this.org, employeeRef: ref, tokenHash, createdAt: now, lastUsedAt: null })
      .onConflictDoUpdate({ target: [calendarFeeds.organisationId, calendarFeeds.employeeRef], set: { tokenHash, createdAt: now, lastUsedAt: null } });
  }

  async remove(ref: string): Promise<boolean> {
    const rows = await this.db.delete(calendarFeeds)
      .where(and(eq(calendarFeeds.organisationId, this.org), eq(calendarFeeds.employeeRef, ref))).returning({ ref: calendarFeeds.employeeRef });
    return rows.length > 0;
  }

  async touch(ref: string, now: Date): Promise<void> {
    await this.db.update(calendarFeeds).set({ lastUsedAt: now })
      .where(and(eq(calendarFeeds.organisationId, this.org), eq(calendarFeeds.employeeRef, ref)));
  }
}
