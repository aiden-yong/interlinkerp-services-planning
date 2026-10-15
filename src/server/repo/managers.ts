import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { planningManagers } from '../db/schema';
import { iso } from '../support/time';

export interface ManagerDirectory {
  isManager(email: string): Promise<boolean>;
}

const norm = (email: string) => email.trim().toLowerCase();

/** Planning's own manager list (BR-12, FR-ACC-03), keyed by lower-cased email. */
export class ManagerRepository implements ManagerDirectory {
  constructor(private readonly db: Db, private readonly org: string) {}

  private where(email: string) {
    return and(eq(planningManagers.organisationId, this.org), eq(planningManagers.email, norm(email)));
  }

  async isManager(email: string): Promise<boolean> {
    const rows = await this.db.select({ email: planningManagers.email }).from(planningManagers).where(this.where(email)).limit(1);
    return rows.length > 0;
  }

  async all(): Promise<{ email: string; granted_by: string; granted_at: string }[]> {
    const rows = await this.db.select().from(planningManagers).where(eq(planningManagers.organisationId, this.org)).orderBy(planningManagers.email);
    return rows.map((r) => ({ email: r.email, granted_by: r.grantedBy, granted_at: iso(r.grantedAt) }));
  }

  async grant(email: string, grantedBy: string, at: Date): Promise<boolean> {
    const inserted = await this.db.insert(planningManagers)
      .values({ organisationId: this.org, email: norm(email), grantedBy, grantedAt: at })
      .onConflictDoNothing()
      .returning({ email: planningManagers.email });
    return inserted.length === 1;
  }

  async revoke(email: string): Promise<boolean> {
    const deleted = await this.db.delete(planningManagers).where(this.where(email)).returning({ email: planningManagers.email });
    return deleted.length === 1;
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(planningManagers).where(eq(planningManagers.organisationId, this.org));
    return Number(row.n);
  }
}
