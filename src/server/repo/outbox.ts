import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notificationOutbox } from '../db/schema';
import { iso } from '../support/time';

/**
 * Notifications waiting to be delivered. M1 only records them; M2 adds
 * delivery (roadmap). Writing them in the same request as the change means
 * nothing is lost when delivery is added.
 */
export class Outbox {
  constructor(private readonly db: Db, private readonly org: string) {}

  async add(kind: string, employeeRef: string | null, subjectId: string | null, payload: Record<string, unknown>, deliverAfter: Date, now: Date): Promise<void> {
    await this.db.insert(notificationOutbox).values({ organisationId: this.org, kind, employeeRef, subjectId, payload, deliverAfter, createdAt: now });
  }

  /** FR-NTF-03: a notice for everyone on the Planning Manager list (expanded at delivery). */
  async addForManagers(kind: string, subjectId: string | null, payload: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.insert(notificationOutbox).values({ organisationId: this.org, kind, audience: 'managers', employeeRef: null, subjectId, payload, deliverAfter: now, createdAt: now });
  }

  /** True when a `kind` notice about `subjectId`, queued at or after `since`, has already been delivered. */
  async deliveredSince(kind: string, subjectId: string, since: Date): Promise<boolean> {
    const rows = await this.db.select({ id: notificationOutbox.id }).from(notificationOutbox)
      .where(and(eq(notificationOutbox.organisationId, this.org), eq(notificationOutbox.kind, kind), eq(notificationOutbox.subjectId, subjectId),
        gte(notificationOutbox.createdAt, since), isNotNull(notificationOutbox.deliveredAt)))
      .limit(1);
    return rows.length > 0;
  }

  async cancelPending(kind: string, subjectId: string, now: Date): Promise<number> {
    const cancelled = await this.db.update(notificationOutbox).set({ cancelledAt: now })
      .where(and(eq(notificationOutbox.organisationId, this.org), eq(notificationOutbox.kind, kind), eq(notificationOutbox.subjectId, subjectId),
        isNull(notificationOutbox.deliveredAt), isNull(notificationOutbox.cancelledAt)))
      .returning({ id: notificationOutbox.id });
    return cancelled.length;
  }

  async all() {
    const rows = await this.db.select().from(notificationOutbox).where(eq(notificationOutbox.organisationId, this.org)).orderBy(notificationOutbox.id);
    return rows.map((r) => ({ kind: r.kind, employee_ref: r.employeeRef, subject_id: r.subjectId, payload: r.payload, deliver_after: iso(r.deliverAfter), cancelled: r.cancelledAt !== null }));
  }
}
