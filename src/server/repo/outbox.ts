import { and, eq, isNull } from 'drizzle-orm';
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
