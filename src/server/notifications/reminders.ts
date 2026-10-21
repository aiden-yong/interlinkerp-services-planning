import { and, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notificationOutbox, shifts } from '../db/schema';
import type { SettingsRepository } from '../repo/settings';

/**
 * FR-NTF-05: one reminder per published shift, queued once its start is within the lead time (D24).
 * Marking `reminded_at` and queueing the notice happen in one transaction, so overlapping sweeps never remind twice.
 * Moving a shift or changing its employee clears the mark in the repository, so the new time or person is reminded again.
 */
export class ReminderService {
  constructor(private readonly db: Db, private readonly org: string, private readonly settings: SettingsRepository) {}

  /** Queues a reminder for each due shift and returns how many. 0 when reminders are off. */
  async queueDue(now: Date): Promise<number> {
    const lead = (await this.settings.get()).reminder_lead_minutes;
    if (lead <= 0) return 0;
    const horizon = new Date(now.getTime() + lead * 60_000);
    return this.db.transaction(async (tx) => {
      const rows = await tx.update(shifts).set({ remindedAt: now }).where(and(
        eq(shifts.organisationId, this.org), eq(shifts.state, 'published'), isNotNull(shifts.employeeRef), isNull(shifts.deletedAt), isNull(shifts.remindedAt),
        gt(shifts.startAt, now), lte(shifts.startAt, horizon),
      )).returning({ id: shifts.id, employeeRef: shifts.employeeRef });
      if (rows.length > 0) {
        await tx.insert(notificationOutbox).values(rows.map((r) => ({
          organisationId: this.org, kind: 'shift_reminder', employeeRef: r.employeeRef, subjectId: r.id, payload: { shift_ids: [r.id] }, deliverAfter: now, createdAt: now,
        })));
      }
      return rows.length;
    });
  }
}
