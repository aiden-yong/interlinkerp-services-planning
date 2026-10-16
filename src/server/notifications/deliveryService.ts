import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notificationOutbox, notifications } from '../db/schema';
import type { Logger } from '../http/kernel';
import type { DirectoryRepository } from '../repo/directory';
import type { ManagerRepository } from '../repo/managers';
import type { ProfileRepository } from '../repo/profiles';
import type { SettingsRepository } from '../repo/settings';
import type { ShiftRepository } from '../repo/shifts';
import type { Clock } from '../support/clock';
import { render, scrubAddresses, shiftIdsOf } from './messages';

export const MAX_OUTBOX_ATTEMPTS = 5;
const BATCH = 100;

/** Who a sweep wrote to, so their badge counts can be refreshed. */
export interface Touched {
  refs: Set<string>;
  emails: Set<string>;
}

export interface DeliveryReport {
  notified: number;
}

export interface DeliveryDeps {
  db: Db;
  org: string;
  shifts: ShiftRepository;
  directory: DirectoryRepository;
  profiles: ProfileRepository;
  managers: ManagerRepository;
  settings: SettingsRepository;
  clock: Clock;
  log: Logger;
  /** Read only when there is something to render, so building the service never needs PUBLIC_URL. */
  publicUrl: () => string;
}

/** FR-NTF-01..04: turns queued notices into inbox rows (and, from Task 6, emails and badges). */
export class DeliveryService {
  constructor(private readonly d: DeliveryDeps) {}

  /** Step 1. Overlapping sweeps skip each other's rows (SKIP LOCKED), so nothing is delivered twice. */
  async expandDue(): Promise<Touched> {
    const { db, org, clock } = this.d;
    const now = clock.now();
    const touched: Touched = { refs: new Set(), emails: new Set() };
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(notificationOutbox)
        .where(and(eq(notificationOutbox.organisationId, org), isNull(notificationOutbox.deliveredAt), isNull(notificationOutbox.cancelledAt), lte(notificationOutbox.deliverAfter, now)))
        .orderBy(notificationOutbox.id).limit(BATCH).for('update', { skipLocked: true });
      if (rows.length === 0) return;
      const [shifts, directory, profiles, managers, orgZone] = await Promise.all([
        this.d.shifts.byIds([...new Set(rows.flatMap((r) => shiftIdsOf(r.payload)))]),
        this.d.directory.all(), this.d.profiles.all(), this.d.managers.all(), this.d.settings.timezone(),
      ]);
      const base = { shifts: new Map(shifts.map((s) => [s.id, s])), names: new Map(directory.map((e) => [e.employeeRef, e.displayName])), publicUrl: this.d.publicUrl() };
      for (const row of rows) {
        let inbox: (typeof notifications.$inferInsert)[];
        try {
          const recipients = row.audience === 'managers'
            ? managers.map((m) => ({ ref: null, email: m.email, zone: orgZone }))
            : row.employeeRef ? [{ ref: row.employeeRef, email: null, zone: profiles.get(row.employeeRef)?.timezone ?? orgZone }] : [];
          const ids = shiftIdsOf(row.payload);
          inbox = recipients.map((r) => ({
            organisationId: org, recipientRef: r.ref, recipientEmail: r.email, kind: row.kind, ...render(row.kind, row.payload, { ...base, zone: r.zone }),
            shiftId: ids.length === 1 ? ids[0]! : null, outboxId: row.id, createdAt: now, emailNextAt: now,
          }));
        } catch (error) {
          const attempts = row.attempts + 1;
          await tx.update(notificationOutbox).set({ attempts, lastError: scrubAddresses(String(error)), deliveredAt: attempts >= MAX_OUTBOX_ATTEMPTS ? now : null })
            .where(and(eq(notificationOutbox.organisationId, org), eq(notificationOutbox.id, row.id)));
          this.d.log(`[delivery] notice ${row.id} (${row.kind}) failed: ${String(error)}`);
          continue;
        }
        if (inbox.length > 0) await tx.insert(notifications).values(inbox);
        await tx.update(notificationOutbox).set({ deliveredAt: now }).where(and(eq(notificationOutbox.organisationId, org), eq(notificationOutbox.id, row.id)));
        for (const r of inbox) {
          if (r.recipientRef) touched.refs.add(r.recipientRef);
          if (r.recipientEmail) touched.emails.add(r.recipientEmail);
        }
      }
    });
    return touched;
  }

  /** The whole sweep. Never throws: delivery must not break the request that triggered it. */
  async deliverDue(): Promise<DeliveryReport> {
    try {
      const touched = await this.expandDue();
      return { notified: touched.refs.size + touched.emails.size };
    } catch (error) {
      this.d.log(`[delivery] sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      return { notified: 0 };
    }
  }
}
