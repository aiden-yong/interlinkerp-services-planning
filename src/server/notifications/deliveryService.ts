import { and, eq, inArray, isNull, lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { MAX_EMAIL_ATTEMPTS, notificationOutbox, notifications } from '../db/schema';
import type { Logger } from '../http/kernel';
import type { DirectoryRepository } from '../repo/directory';
import type { ManagerRepository } from '../repo/managers';
import type { NotificationRepository } from '../repo/notifications';
import type { ProfileRepository } from '../repo/profiles';
import type { SettingsRepository } from '../repo/settings';
import type { ShiftRepository } from '../repo/shifts';
import type { Clock } from '../support/clock';
import type { BadgePublisher } from './badges';
import type { Mailer } from './mailer';
import { render, scrubAddresses, shiftIdsOf } from './messages';

export const MAX_OUTBOX_ATTEMPTS = 5;
const BATCH = 100;
/** At most 10 sends of at most 10 s each, so one sweep stays well inside a serverless function's time limit. */
const EMAIL_BATCH = 10;
const LEASE_MS = 5 * 60_000;

/** Who a sweep wrote to, so their badge counts can be refreshed. */
export interface Touched {
  refs: Set<string>;
  emails: Set<string>;
}

export interface DeliveryReport {
  notified: number;
  emailed: number;
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
  mailer: Mailer;
  badges: BadgePublisher;
  inbox: NotificationRepository;
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

  /**
   * Step 2. Rows are leased first (email_next_at pushed 5 minutes ahead in a short transaction), then sent outside
   * it, so overlapping sweeps never send the same email twice and a slow SMTP server holds no locks.
   */
  async sendEmails(): Promise<number> {
    const { db, org, clock } = this.d;
    const now = clock.now();
    const leased = await db.transaction(async (tx) => {
      const due = await tx.select().from(notifications)
        .where(and(eq(notifications.organisationId, org), isNull(notifications.emailedAt), lt(notifications.emailAttempts, MAX_EMAIL_ATTEMPTS), lte(notifications.emailNextAt, now)))
        .orderBy(notifications.id).limit(EMAIL_BATCH).for('update', { skipLocked: true });
      if (due.length > 0) {
        await tx.update(notifications).set({ emailNextAt: new Date(now.getTime() + LEASE_MS) })
          .where(and(eq(notifications.organisationId, org), inArray(notifications.id, due.map((n) => n.id))));
      }
      return due;
    });
    if (leased.length === 0) return 0;
    const byId = (id: number) => and(eq(notifications.organisationId, org), eq(notifications.id, id));
    const addresses = await this.d.directory.emailsFor(leased.flatMap((n) => (n.recipientRef ? [n.recipientRef] : [])));
    let sent = 0;
    for (const n of leased) {
      const to = n.recipientEmail ?? (n.recipientRef ? addresses.get(n.recipientRef) : undefined);
      if (!to) {
        await db.update(notifications).set({ emailAttempts: MAX_EMAIL_ATTEMPTS, emailError: 'No email address on the roster.' }).where(byId(n.id));
        continue;
      }
      const result = await this.d.mailer.send({ to, subject: n.title, text: `${n.body}\n\nOpen Planning: ${n.link}` });
      if (result.ok) {
        sent++;
        await db.update(notifications).set({ emailedAt: clock.now(), emailError: null }).where(byId(n.id));
      } else {
        const attempts = n.emailAttempts + 1;
        await db.update(notifications)
          .set({ emailAttempts: attempts, emailError: scrubAddresses(result.error), emailNextAt: new Date(clock.now().getTime() + 2 ** attempts * 60_000) })
          .where(byId(n.id));
      }
    }
    return sent;
  }

  /** Step 3, also called after mark-read. A person's count covers their employee and manager notices. Never throws. */
  async pushBadges(touched: Touched): Promise<void> {
    if (!this.d.badges.enabled || (touched.refs.size === 0 && touched.emails.size === 0)) return;
    try {
      const refEmails = await this.d.directory.emailsFor([...touched.refs]);
      const emails = [...new Set([...touched.emails, ...refEmails.values()])];
      const refOf = await this.d.directory.refsFor(emails);
      const badges = [];
      for (const email of emails) badges.push({ email, count: await this.d.inbox.unreadCount({ ref: refOf.get(email) ?? null, email }) });
      await this.d.badges.publish(badges);
    } catch (error) {
      this.d.log(`[badges] could not compute counts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The whole sweep. Never throws: delivery must not break the request that triggered it. */
  async deliverDue(): Promise<DeliveryReport> {
    try {
      const touched = await this.expandDue();
      const emailed = await this.sendEmails();
      await this.pushBadges(touched);
      return { notified: touched.refs.size + touched.emails.size, emailed };
    } catch (error) {
      this.d.log(`[delivery] sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      return { notified: 0, emailed: 0 };
    }
  }
}