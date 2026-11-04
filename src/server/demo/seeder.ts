import { randomUUID } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  auditEntries, employeeDirectory, employeeProfiles, employeeRoles, jobRuns, notificationOutbox, notifications, organisationSettings,
  planningManagers, publicHolidays, recurrences, roles, shifts, shiftTemplates, unavailabilities,
} from '../db/schema';
import type { Clock } from '../support/clock';
import { DEMO_EMAIL, DEMO_EMPLOYEE_REF, isDemoDatabase } from './demo';
import { buildSampleData } from './sampleData';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Sign-ins wait for one another here, so two first visitors can't both load the sample data. */
const SEED_LOCK = 7_205_001;
const SEED_MARKER = 'demo_seed';
/** The board should always open on a lived-in week: sign-in replaces sample data older than this. */
export const MAX_SAMPLE_AGE_DAYS = 14;
const DAY_MS = 86_400_000;

/** Loads the fictional sample data. Refuses, before connecting, any database whose name doesn't contain "demo". */
export class DemoSeeder {
  constructor(
    private readonly db: Db,
    private readonly org: string,
    private readonly zone: string,
    private readonly clock: Clock,
    private readonly publicUrl: string,
    private readonly databaseUrl: string | undefined,
  ) {}

  private refuseUnlessDemo(): void {
    if (!isDemoDatabase(this.databaseUrl)) throw new Error('Refusing to load demo data: the database name must contain "demo".');
  }

  /** Called on every sign-in: loads the sample data if it is missing or old, otherwise keeps the directory looking current. */
  async ensureReady(): Promise<void> {
    this.refuseUnlessDemo();
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK})`);
      const [marker] = await tx.select({ at: jobRuns.startedAt }).from(jobRuns).where(and(eq(jobRuns.organisationId, this.org), eq(jobRuns.job, SEED_MARKER)));
      if (!marker || now.getTime() - marker.at.getTime() > MAX_SAMPLE_AGE_DAYS * DAY_MS) {
        await this.load(tx, now);
        return;
      }
      // No roster refreshes a demo, so without this the board warns about a stale directory after a day.
      await tx.update(employeeDirectory).set({ fetchedAt: now })
        .where(and(eq(employeeDirectory.organisationId, this.org), lt(employeeDirectory.fetchedAt, new Date(now.getTime() - DAY_MS / 2))));
    });
  }

  /** Puts everything back to the original sample data, for every visitor. */
  async reset(): Promise<void> {
    this.refuseUnlessDemo();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK})`);
      await this.load(tx, this.clock.now());
    });
  }

  private async load(tx: Tx, now: Date): Promise<void> {
    const { rows } = await tx.execute<{ name: string }>(sql`select tablename as name from pg_tables where schemaname = 'public'`);
    await tx.execute(sql.raw(`truncate ${rows.map((r) => `"${r.name}"`).join(', ')} restart identity`));

    const data = buildSampleData(now, this.zone);
    const org = this.org;
    const stamps = { createdAt: now, updatedAt: now };

    await tx.insert(organisationSettings).values({ organisationId: org, ...data.settings, updatedAt: now });
    await tx.insert(roles).values(data.roles.map((r) => ({ ...r, organisationId: org, ...stamps })));
    await tx.insert(employeeDirectory).values(data.people.map((p) => ({
      organisationId: org, employeeRef: p.ref, displayName: p.name, departmentId: p.departmentId, departmentName: p.departmentName, status: 'Active', email: p.email, fetchedAt: now,
    })));
    await tx.insert(employeeProfiles).values(data.people.map((p) => ({
      organisationId: org, employeeRef: p.ref, defaultRoleId: p.defaultRoleId, timezone: null, workingHours: p.workingHours, updatedAt: now,
    })));
    await tx.insert(employeeRoles).values(data.people.flatMap((p) => p.roleIds.map((roleId) => ({ organisationId: org, employeeRef: p.ref, roleId }))));
    await tx.insert(shiftTemplates).values(data.templates.map(({ role, ...t }) => ({ ...t, id: randomUUID(), organisationId: org, roleId: data.roleIds[role], ...stamps })));
    await tx.insert(unavailabilities).values(data.timeOff.map(({ start, end, ...t }) => ({
      ...t, id: randomUUID(), organisationId: org, startAt: start, endAt: end, createdBy: DEMO_EMAIL, ...stamps,
    })));
    await tx.insert(publicHolidays).values(data.holidays.map((h) => ({
      id: randomUUID(), organisationId: org, holidayDate: h.date, name: h.name, source: 'manual', ...stamps,
    })));
    await tx.insert(planningManagers).values(data.managers.map((email) => ({ organisationId: org, email, grantedBy: DEMO_EMAIL, grantedAt: now })));

    const series = data.recurrence;
    await tx.insert(recurrences).values({
      id: series.id, organisationId: org, interval: series.interval, unit: series.unit, ends: series.ends, occurrenceCount: series.count, timezone: this.zone,
      firstStartLocal: series.firstStartLocal, durationMinutes: series.durationMinutes, employeeRef: series.employeeRef, roleId: series.roleId,
      breakMinutes: series.breakMinutes, note: series.note, generatedUntil: series.generatedUntil, createdBy: DEMO_EMAIL, ...stamps,
    });

    const shiftRows = data.shifts.map((s) => ({
      id: s.id, organisationId: org, employeeRef: s.employeeRef, roleId: data.roleIds[s.role], startAt: s.start, endAt: s.end, breakMinutes: s.breakMinutes, note: s.note,
      state: s.published ? 'published' : 'draft', publishedAt: s.published ? now : null, createdBy: DEMO_EMAIL, ...stamps,
      switchRequestedAt: s.switchRequested ? now : null,
      conflictAcknowledgedBy: s.acknowledged ? DEMO_EMAIL : null, conflictAcknowledgedAt: s.acknowledged ? now : null,
      recurrenceId: s.recurrenceIndex === undefined ? null : series.id, recurrenceIndex: s.recurrenceIndex ?? null,
    }));
    const history = data.shifts.flatMap((s) => [
      { organisationId: org, shiftId: s.id, action: 'created' as const, actor: DEMO_EMAIL, actorKind: 'manager', at: now },
      ...(s.published ? [{ organisationId: org, shiftId: s.id, action: 'published' as const, actor: DEMO_EMAIL, actorKind: 'manager', at: now }] : []),
    ]);
    for (let i = 0; i < shiftRows.length; i += 200) await tx.insert(shifts).values(shiftRows.slice(i, i + 200));
    for (let i = 0; i < history.length; i += 400) await tx.insert(auditEntries).values(history.slice(i, i + 400));

    // Notices arrive already delivered and emailed, so no sweep ever tries to send them.
    for (const notice of data.notices) {
      const created = new Date(now.getTime() - notice.ageHours * 3_600_000);
      const [outbox] = await tx.insert(notificationOutbox).values({
        organisationId: org, kind: notice.kind, employeeRef: notice.audience === 'employee' ? DEMO_EMPLOYEE_REF : null, subjectId: notice.shiftId,
        payload: {}, audience: notice.audience, deliverAfter: created, deliveredAt: created, createdAt: created,
      }).returning({ id: notificationOutbox.id });
      await tx.insert(notifications).values({
        organisationId: org, recipientRef: notice.audience === 'employee' ? DEMO_EMPLOYEE_REF : null, recipientEmail: notice.audience === 'managers' ? DEMO_EMAIL : null,
        kind: notice.kind, title: notice.title, body: notice.body, link: `${this.publicUrl}${notice.path}`, shiftId: notice.shiftId, outboxId: outbox!.id,
        createdAt: created, readAt: notice.read ? created : null, emailedAt: created, emailNextAt: created,
      });
    }
    await tx.insert(jobRuns).values({ organisationId: org, job: SEED_MARKER, startedAt: now });
  }
}
