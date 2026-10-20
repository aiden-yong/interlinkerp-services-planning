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

  /** ids = null marks everything. Only the person's own unread rows change. */
  async markRead(who: Recipient, ids: number[] | null, now: Date): Promise<number> {
    if (ids !== null && ids.length === 0) return 0;
    const rows = await this.db.update(notifications).set({ readAt: now })
      .where(and(this.mine(who), isNull(notifications.readAt), ids ? inArray(notifications.id, ids) : undefined))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
