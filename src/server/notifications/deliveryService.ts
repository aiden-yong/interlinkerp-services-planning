import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { MAX_EMAIL_ATTEMPTS, notificationOutbox, notifications } from '../db/schema';
import type { Logger } from '../http/kernel';
import type { DirectoryRepository } from '../repo/directory';
import type { ManagerRepository } from '../repo/managers';
import type { EmailPreferences } from '../repo/emailPreferences';
import type { NotificationRepository } from '../repo/notifications';
import type { ProfileRepository } from '../repo/profiles';
import type { SettingsRepository } from '../repo/settings';
import { ShiftRepository, type ShiftRecord } from '../repo/shifts';
import type { Clock } from '../support/clock';
import { isUuid } from '../support/ids';
import type { BadgePublisher } from './badges';
import type { Mailer } from './mailer';
import { render, scrubAddresses, shiftIdsOf } from './messages';

export const MAX_OUTBOX_ATTEMPTS = 5;
const BATCH = 100;
/** At most 5 sends of at most 10 s each (50 s worst case), so a sweep run by after() fits the 60 s function limit. */
const EMAIL_BATCH = 5;
const LEASE_MS = 5 * 60_000;

/**
 * True when every shift a notice mentions is over (already started, for open-shift notices). A shift that cannot be found
 * is never "expired": rendering fails and the row is retried. Notices without a shift reference never expire.
 */
function isExpired(kind: string, payload: Record<string, unknown>, shifts: Map<string, ShiftRecord>, now: Date): boolean {
  if (kind === 'shift_deleted') {
    const end = new Date(String(payload.end_at));
    return !Number.isNaN(end.getTime()) && end <= now;
  }
  const ids = shiftIdsOf(payload);
  if (ids.length === 0) return false;
  const found = ids.map((id) => shifts.get(id));
  if (found.some((s) => !s)) return false;
  return found.every((s) => ((kind === 'open_shifts_available' ? s!.start : s!.end) <= now));
}

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
  directory: DirectoryRepository;
  profiles: ProfileRepository;
  managers: ManagerRepository;
  settings: SettingsRepository;
  clock: Clock;
  log: Logger;
  mailer: Mailer;
  badges: BadgePublisher;
  inbox: NotificationRepository;
  /** Backlog item 29: notice types people chose not to get by email. */
  preferences: EmailPreferences;
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
    // Cheap check first (an optimisation only: the select inside the transaction stays authoritative).
    const due = and(eq(notificationOutbox.organisationId, org), isNull(notificationOutbox.deliveredAt), isNull(notificationOutbox.cancelledAt), lte(notificationOutbox.deliverAfter, now));
    if ((await db.select({ id: notificationOutbox.id }).from(notificationOutbox).where(due).limit(1)).length === 0) return touched;
    // Reference data comes through the pool BEFORE the transaction, so the transaction (which holds a connection and row locks) never waits on the pool.
    const [directory, profiles, managers, orgZone] = await Promise.all([this.d.directory.all(), this.d.profiles.all(), this.d.managers.all(), this.d.settings.timezone()]);
    const names = new Map(directory.map((e) => [e.employeeRef, e.displayName]));
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(notificationOutbox)
        .where(and(eq(notificationOutbox.organisationId, org), isNull(notificationOutbox.deliveredAt), isNull(notificationOutbox.cancelledAt), lte(notificationOutbox.deliverAfter, now)))
        .orderBy(notificationOutbox.id).limit(BATCH).for('update', { skipLocked: true });
      if (rows.length === 0) return;
      const shifts = await new ShiftRepository(tx as unknown as Db, org).byIds([...new Set(rows.flatMap((r) => shiftIdsOf(r.payload)))]);
      const base = { shifts: new Map(shifts.map((s) => [s.id, s])), names, publicUrl: this.d.publicUrl() };
      for (const row of rows) {
        // Notices queued long ago (for example before this feature existed) about shifts that are over are dropped, not delivered late.
        if (isExpired(row.kind, row.payload, base.shifts, now)) {
          await tx.update(notificationOutbox).set({ deliveredAt: now, lastError: 'expired' })
            .where(and(eq(notificationOutbox.organisationId, org), eq(notificationOutbox.id, row.id)));
          continue;
        }
        let inbox: (typeof notifications.$inferInsert)[];
        try {
          const recipients = row.audience === 'managers'
            ? managers.map((m) => ({ ref: null, email: m.email, zone: orgZone }))
            : row.employeeRef ? [{ ref: row.employeeRef, email: null, zone: profiles.get(row.employeeRef)?.timezone ?? orgZone }] : [];
          const ids = shiftIdsOf(row.payload);
          // A shift id that is not a uuid would abort the whole batch at INSERT, so it counts as a render failure of this row only.
          if (ids.length === 1 && !isUuid(ids[0]!)) throw new Error(`Shift id ${ids[0]} is not a uuid`);
          inbox = recipients.map((r) => ({
            organisationId: org, recipientRef: r.ref, recipientEmail: r.email, kind: row.kind, ...render(row.kind, row.payload, { ...base, zone: r.zone }),
            shiftId: ids.length === 1 ? ids[0]! : null, outboxId: row.id, createdAt: now, emailNextAt: now,
          }));
        } catch (error) {
          const attempts = row.attempts + 1;
          // After MAX_OUTBOX_ATTEMPTS the row is given up: marked delivered, with last_error saying why, so it stops being picked up.
          await tx.update(notificationOutbox).set({ attempts, lastError: scrubAddresses(String(error)), deliveredAt: attempts >= MAX_OUTBOX_ATTEMPTS ? now : null })
            .where(and(eq(notificationOutbox.organisationId, org), eq(notificationOutbox.id, row.id)));
          this.d.log(`[delivery] notice ${row.id} (${row.kind}) failed: ${scrubAddresses(String(error))}`);
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
        .where(and(eq(notifications.organisationId, org), isNull(notifications.emailedAt), sql`${notifications.emailAttempts} < ${sql.raw(String(MAX_EMAIL_ATTEMPTS))}`, lte(notifications.emailNextAt, now)))
        .orderBy(notifications.id).limit(EMAIL_BATCH).for('update', { skipLocked: true });
      if (due.length > 0) {
        await tx.update(notifications).set({ emailNextAt: new Date(now.getTime() + LEASE_MS), emailAttempts: sql`${notifications.emailAttempts} + 1` })
          .where(and(eq(notifications.organisationId, org), inArray(notifications.id, due.map((n) => n.id))));
      }
      return due;
    });
    if (leased.length === 0) return 0;
    const byId = (id: number) => and(eq(notifications.organisationId, org), eq(notifications.id, id));
    const addressOf = (n: (typeof leased)[number]) => (n.recipientRef ? `ref:${n.recipientRef}` : `email:${n.recipientEmail}`);
    // Fail open: if preferences cannot be read (for example before migration 0003 runs), email everyone as before.
    const muted = await this.d.preferences.optedOut(leased.map(addressOf)).catch((error: unknown) => {
      this.d.log(`[delivery] email preferences unavailable: ${scrubAddresses(error instanceof Error ? error.message : String(error))}`);
      return new Set<string>();
    });
    const refs = leased.flatMap((n) => (n.recipientRef ? [n.recipientRef] : []));
    const [addresses, onRoster] = await Promise.all([this.d.directory.emailsFor(refs), this.d.directory.present(refs)]);
    let sent = 0;
    let directoryHasEmails: boolean | undefined;
    for (const n of leased) {
      if (muted.has(`${addressOf(n)}|${n.kind}`)) {
        await db.update(notifications).set({ emailAttempts: MAX_EMAIL_ATTEMPTS, emailError: 'Skipped: email turned off for this notice type.' }).where(byId(n.id));
        continue;
      }
      const to = n.recipientEmail ?? (n.recipientRef ? addresses.get(n.recipientRef) : undefined);
      if (!to && n.recipientRef && !onRoster.has(n.recipientRef) && !(await this.d.directory.isEmpty())) {
        // Backlog item 14: someone who has left (no longer Onboarding, Active or Offboarding) keeps the in-app notice but gets no email.
        await db.update(notifications).set({ emailAttempts: MAX_EMAIL_ATTEMPTS, emailError: 'Skipped: no longer on the roster.' }).where(byId(n.id));
        continue;
      }
      if (!to) {
        // Right after the email column was added no address is known yet: wait for the next directory refresh instead of giving up.
        directoryHasEmails ??= await this.d.directory.hasAnyEmail();
        if (!directoryHasEmails) {
          await db.update(notifications).set({ emailAttempts: n.emailAttempts, emailNextAt: new Date(clock.now().getTime() + 3600_000) }).where(byId(n.id));
          continue;
        }
        await db.update(notifications).set({ emailAttempts: MAX_EMAIL_ATTEMPTS, emailError: 'No email address on the roster.' }).where(byId(n.id));
        continue;
      }
      const result = await this.d.mailer.send({ to, subject: n.title, text: `${n.body}\n\nOpen Planning: ${n.link}`, messageId: `<notice-${n.id}@${new URL(this.d.publicUrl()).hostname}>` });
      if (result.ok) {
        sent++;
        await db.update(notifications).set({ emailedAt: clock.now(), emailError: null }).where(byId(n.id));
      } else {
        const attempts = n.emailAttempts + 1; // already counted when leased
        await db.update(notifications)
          .set({ emailError: scrubAddresses(result.error), emailNextAt: new Date(clock.now().getTime() + 2 ** attempts * 60_000) })
          .where(byId(n.id));
      }
    }
    return sent;
  }

  /** Step 3, also called after mark-read. A person's count covers their employee and manager notices. Never throws; false means the push did not succeed and should be retried. */
  async pushBadges(touched: Touched): Promise<boolean> {
    if (!this.d.badges.enabled || (touched.refs.size === 0 && touched.emails.size === 0)) return true;
    try {
      const refEmails = await this.d.directory.emailsFor([...touched.refs]);
      const emails = [...new Set([...touched.emails, ...refEmails.values()])];
      const refOf = await this.d.directory.refsFor(emails);
      const managers = new Set((await this.d.managers.all()).map((m) => m.email));
      const counts = await this.d.inbox.unreadCounts(emails.map((email) => ({ ref: refOf.get(email) ?? null, email, isManager: managers.has(email) })));
      return await this.d.badges.publish(emails.map((email, i) => ({ email, count: counts[i]! })));
    } catch (error) {
      this.d.log(`[badges] could not compute counts: ${scrubAddresses(error instanceof Error ? error.message : String(error))}`);
      return false;
    }
  }

  /** The whole sweep. Never throws: delivery must not break the request that triggered it. */
  async deliverDue(): Promise<DeliveryReport> {
    let touched: Touched;
    try {
      touched = await this.expandDue();
    } catch (error) {
      this.d.log(`[delivery] sweep failed: ${scrubAddresses(error instanceof Error ? error.message : String(error))}`);
      return { notified: 0, emailed: 0 };
    }
    let emailed = 0;
    try {
      emailed = await this.sendEmails();
    } catch (error) {
      this.d.log(`[delivery] email step failed: ${scrubAddresses(error instanceof Error ? error.message : String(error))}`);
    }
    await this.pushBadges(touched);
    return { notified: touched.refs.size + touched.emails.size, emailed };
  }
}
