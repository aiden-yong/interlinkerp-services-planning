import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { rateLimits } from '../db/schema';
import type { Clock } from '../support/clock';

export interface RateLimitPolicy {
  /** Requests allowed in a burst. */
  capacity: number;
  /** Tokens added back each second. */
  perSecond: number;
}

/** Backlog item 10: a burst of 60 changes, then one a second, per person or program. Far above what a person clicking can do. */
export const WRITE_LIMIT: RateLimitPolicy = { capacity: 60, perSecond: 1 };

/** Token buckets in Postgres, so the limit holds across every serverless instance. */
export class RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly org: string,
    private readonly clock: Clock,
    private readonly policy: RateLimitPolicy = WRITE_LIMIT,
  ) {}

  /** Takes one token. Returns null when allowed, otherwise the whole seconds to wait. One statement when allowed. */
  async take(bucket: string): Promise<number | null> {
    const { capacity, perSecond } = this.policy;
    const now = this.clock.now();
    const refilled = sql`least(${capacity}::float8, ${rateLimits.tokens} + extract(epoch from (${now.toISOString()}::timestamptz - ${rateLimits.updatedAt})) * ${perSecond}::float8)`;
    const taken = await this.db.insert(rateLimits).values({ organisationId: this.org, bucket, tokens: capacity - 1, updatedAt: now })
      .onConflictDoUpdate({ target: [rateLimits.organisationId, rateLimits.bucket], set: { tokens: sql`${refilled} - 1`, updatedAt: now }, setWhere: sql`${refilled} >= 1` })
      .returning({ tokens: rateLimits.tokens });
    if (taken.length > 0) return null;
    const [row] = await this.db.select().from(rateLimits).where(and(eq(rateLimits.organisationId, this.org), eq(rateLimits.bucket, bucket))).limit(1);
    const available = row ? Math.min(capacity, row.tokens + ((now.getTime() - row.updatedAt.getTime()) / 1000) * perSecond) : 0;
    return Math.max(1, Math.ceil((1 - available) / perSecond));
  }
}
