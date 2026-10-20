import { and, count, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type { Principal } from '../auth/principal';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';
import { iso } from '../support/time';

/**
 * A signed-in person's inbox address: their employee_ref and their email (DR-02). Manager notices are addressed by
 * email, so they are readable only while the person is still a Planning Manager (backlog item 13).
 */
export interface Recipient {
  ref: string | null;
  email: string | null;
  isManager: boolean;
}

export const recipientOf = (p: Principal): Recipient => ({ ref: p.employeeRef, email: p.email ? p.email.trim().toLowerCase() : null, isManager: p.isManager });

export function notificationToApi(n: typeof notifications.$inferSelect) {
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, shift_id: n.shiftId, created_at: iso(n.createdAt), read_at: n.readAt ? iso(n.readAt) : null };
}

export class NotificationRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  private mine(who: Recipient): SQL {
    const parts: SQL[] = [];
    if (who.ref) parts.push(eq(notifications.recipientRef, who.ref));
    if (who.email && who.isManager) parts.push(eq(notifications.recipientEmail, who.email));
    return and(eq(notifications.organisationId, this.org), parts.length > 0 ? or(...parts) : sql`false`)!;
  }

  async list(who: Recipient, unreadOnly: boolean, before: number | null, page = { limit: 50, offset: 0 }) {
    const rows = await this.db.select().from(notifications)
      .where(and(this.mine(who), unreadOnly ? isNull(notifications.readAt) : undefined, before !== null ? lt(notifications.id, before) : undefined))
      .orderBy(desc(notifications.id)).limit(page.limit).offset(page.offset);
    return rows.map(notificationToApi);
  }

  async unreadCount(who: Recipient): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(notifications).where(and(this.mine(who), isNull(notifications.readAt)));
    return Number(row?.n ?? 0);
  }

  /** Unread counts for many people in two grouped queries, in the order given (backlog item 24: badges). */
  async unreadCounts(people: Recipient[]): Promise<number[]> {
    const refs = [...new Set(people.flatMap((p) => (p.ref ? [p.ref] : [])))];
    const emails = [...new Set(people.flatMap((p) => (p.email && p.isManager ? [p.email] : [])))];
    const unread = and(eq(notifications.organisationId, this.org), isNull(notifications.readAt));
    const [byRef, byEmail] = await Promise.all([
      refs.length === 0 ? [] : this.db.select({ key: notifications.recipientRef, n: count() }).from(notifications)
        .where(and(unread, inArray(notifications.recipientRef, refs))).groupBy(notifications.recipientRef),
      emails.length === 0 ? [] : this.db.select({ key: notifications.recipientEmail, n: count() }).from(notifications)
        .where(and(unread, inArray(notifications.recipientEmail, emails))).groupBy(notifications.recipientEmail),
    ]);
    const refCount = new Map(byRef.map((r) => [r.key, Number(r.n)]));
    const emailCount = new Map(byEmail.map((r) => [r.key, Number(r.n)]));
    return people.map((p) => (p.ref ? refCount.get(p.ref) ?? 0 : 0) + (p.email && p.isManager ? emailCount.get(p.email) ?? 0 : 0));
  }

  /** ids = null marks everything. Only the person's own unread rows change. */
  async markRead(who: Recipient, ids: number[] | null, now: Date): Promise<number> {
    if (ids !== null && ids.length === 0) return 0;
    const rows = await this.db.update(notifications).set({ readAt: now })
      .where(and(this.mine(who), isNull(notifications.readAt), ids ? inArray(notifications.id, ids) : undefined))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
