import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { jobRuns } from '../db/schema';

/** Backlog item 30: a throttle every server instance shares, claimed with one conditional upsert. */
export class JobRuns {
  constructor(private readonly db: Db, private readonly org: string) {}

  /** True when this caller may start `job` now: it last started at least `minGapMs` ago, or never. */
  async claim(job: string, now: Date, minGapMs: number): Promise<boolean> {
    const rows = await this.db.insert(jobRuns).values({ organisationId: this.org, job, startedAt: now })
      .onConflictDoUpdate({
        target: [jobRuns.organisationId, jobRuns.job],
        set: { startedAt: now },
        setWhere: sql`${jobRuns.startedAt} <= ${new Date(now.getTime() - minGapMs).toISOString()}::timestamptz`,
      })
      .returning({ job: jobRuns.job });
    return rows.length > 0;
  }
}
