import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, char, check, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WorkingHoursMap = Record<Weekday, [string, string][]>;

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const organisationId = () => varchar('organisation_id', { length: 64 }).notNull();
const email = (name: string) => varchar(name, { length: 254 });

/** Email delivery gives up after this many failed attempts (FR-NTF-03). */
export const MAX_EMAIL_ATTEMPTS = 5;

/** Minutes before a shift starts that its employee is reminded; 0 turns reminders off (FR-NTF-05, D24). */
export const REMINDER_LEAD_MINUTES = [0, 30, 60, 120, 240, 720, 1440] as const;

/** What happened to a shift, as recorded in the audit trail. Keep in step with the CHECK on audit_entries. */
export const AUDIT_ACTIONS = [
  'created', 'changed', 'published', 'deleted', 'restored', 'split', 'copied', 'generated', 'auto_planned',
  'claimed', 'switch_requested', 'switch_cancelled', 'taken_over', 'unassigned',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  name: varchar('name', { length: 80 }).notNull(),
  color: char('color', { length: 7 }).notNull(),
  archivedAt: instant('archived_at'),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  uniqueIndex('roles_org_lower_name_key').on(t.organisationId, sql`lower(${t.name})`),
]);

export const employeeProfiles = pgTable('employee_profiles', {
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  defaultRoleId: uuid('default_role_id'),
  timezone: varchar('timezone', { length: 64 }),
  workingHours: jsonb('working_hours').$type<WorkingHoursMap>(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.employeeRef] })]);

export const employeeRoles = pgTable('employee_roles', {
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  roleId: uuid('role_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.organisationId, t.employeeRef, t.roleId] }),
  index('employee_roles_role_idx').on(t.organisationId, t.roleId),
]);

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }),
  roleId: uuid('role_id'),
  startAt: instant('start_at').notNull(),
  endAt: instant('end_at').notNull(),
  breakMinutes: smallint('break_minutes').notNull().default(0),
  allocatedPercent: smallint('allocated_percent').notNull().default(100),
  note: text('note'),
  state: varchar('state', { length: 16 }).notNull().default('draft'),
  publishedAt: instant('published_at'),
  conflictAcknowledgedBy: email('conflict_acknowledged_by'),
  conflictAcknowledgedAt: instant('conflict_acknowledged_at'),
  version: integer('version').notNull().default(1),
  createdBy: email('created_by').notNull(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
  deletedAt: instant('deleted_at'),
  deletedBy: email('deleted_by'),
  switchRequestedAt: instant('switch_requested_at'),
  recurrenceId: uuid('recurrence_id'),
  recurrenceIndex: integer('recurrence_index'),
  recurrenceDetached: boolean('recurrence_detached').notNull().default(false),
  copiedFrom: uuid('copied_from'),
  remindedAt: instant('reminded_at'),
}, (t) => [
  check('shifts_end_after_start', sql`${t.endAt} > ${t.startAt}`),
  check('shifts_percent_range', sql`${t.allocatedPercent} between 1 and 100`),
  check('shifts_break_non_negative', sql`${t.breakMinutes} >= 0`),
  check('shifts_state_valid', sql`${t.state} in ('draft', 'published')`),
  index('shifts_live_time_idx').on(t.organisationId, t.startAt, t.endAt).where(sql`${t.deletedAt} is null`),
  index('shifts_live_employee_idx').on(t.organisationId, t.employeeRef, t.startAt).where(sql`${t.deletedAt} is null`),
  // D4: includes soft-deleted rows (no deleted_at condition) so a deleted occurrence is never regenerated.
  uniqueIndex('shifts_recurrence_step_key').on(t.organisationId, t.recurrenceId, t.recurrenceIndex).where(sql`${t.recurrenceId} is not null`),
]);

export const recurrences = pgTable('recurrences', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  interval: smallint('interval').notNull(),
  unit: varchar('unit', { length: 8 }).notNull(),
  ends: varchar('ends', { length: 8 }).notNull(),
  untilDate: date('until_date', { mode: 'string' }),
  occurrenceCount: smallint('occurrence_count'),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  firstStartLocal: timestamp('first_start_local', { mode: 'string' }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  employeeRef: varchar('employee_ref', { length: 64 }),
  roleId: uuid('role_id'),
  breakMinutes: smallint('break_minutes').notNull().default(0),
  allocatedPercent: smallint('allocated_percent').notNull().default(100),
  note: text('note'),
  lastIndex: integer('last_index'),
  // The series this one was split from by a pattern change (D6); null for a series that was never re-patterned.
  predecessorId: uuid('predecessor_id'),
  generatedUntil: instant('generated_until').notNull(),
  createdBy: email('created_by').notNull(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  check('recurrences_interval_range', sql`${t.interval} between 1 and 99`),
  check('recurrences_unit_valid', sql`${t.unit} in ('day', 'week', 'month')`),
  check('recurrences_ends_valid', sql`${t.ends} in ('never', 'on', 'after')`),
  check('recurrences_occurrence_count_range', sql`${t.occurrenceCount} between 1 and 999`),
  check('recurrences_duration_range', sql`${t.durationMinutes} between 1 and 10080`),
  check('recurrences_break_non_negative', sql`${t.breakMinutes} >= 0`),
  check('recurrences_percent_range', sql`${t.allocatedPercent} between 1 and 100`),
  index('recurrences_org_idx').on(t.organisationId),
  index('recurrences_predecessor_idx').on(t.predecessorId),
]);

export const shiftTemplates = pgTable('shift_templates', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  name: varchar('name', { length: 80 }).notNull(),
  roleId: uuid('role_id'),
  startTime: char('start_time', { length: 5 }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  breakMinutes: smallint('break_minutes').notNull().default(0),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  check('shift_templates_duration_range', sql`${t.durationMinutes} between 1 and 10080`),
  check('shift_templates_break_non_negative', sql`${t.breakMinutes} >= 0`),
  uniqueIndex('shift_templates_org_lower_name_key').on(t.organisationId, sql`lower(${t.name})`),
]);

export const unavailabilities = pgTable('unavailabilities', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  startAt: instant('start_at').notNull(),
  endAt: instant('end_at').notNull(),
  reason: varchar('reason', { length: 200 }).notNull().default(''),
  createdBy: email('created_by').notNull(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  check('unavailabilities_end_after_start', sql`${t.endAt} > ${t.startAt}`),
  index('unavailabilities_employee_idx').on(t.organisationId, t.employeeRef, t.startAt),
  index('unavailabilities_time_idx').on(t.organisationId, t.startAt),
]);

export const publicHolidays = pgTable('public_holidays', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  holidayDate: date('holiday_date', { mode: 'string' }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  source: varchar('source', { length: 16 }).notNull(),
  providerKey: varchar('provider_key', { length: 160 }),
  edited: boolean('edited').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  check('public_holidays_source_valid', sql`${t.source} in ('manual', 'provider')`),
  uniqueIndex('public_holidays_provider_key').on(t.organisationId, t.providerKey),
  index('public_holidays_date_idx').on(t.organisationId, t.holidayDate),
]);

export const organisationSettings = pgTable('organisation_settings', {
  organisationId: varchar('organisation_id', { length: 64 }).primaryKey(),
  countryCode: char('country_code', { length: 2 }),
  regionCode: varchar('region_code', { length: 10 }),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  giveUpMode: varchar('give_up_mode', { length: 16 }).notNull().default('switch'),
  unassignWindowDays: smallint('unassign_window_days').notNull().default(2),
  recurrenceHorizonMonths: smallint('recurrence_horizon_months').notNull().default(6),
  reminderLeadMinutes: smallint('reminder_lead_minutes').notNull().default(60),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  check('organisation_settings_give_up_mode_valid', sql`${t.giveUpMode} in ('switch', 'unassign')`),
  check('organisation_settings_window_range', sql`${t.unassignWindowDays} between 0 and 60`),
  check('organisation_settings_recurrence_horizon_range', sql`${t.recurrenceHorizonMonths} between 1 and 24`),
  check('organisation_settings_reminder_lead_valid', sql`${t.reminderLeadMinutes} in (0, 30, 60, 120, 240, 720, 1440)`),
]);

export const planningManagers = pgTable('planning_managers', {
  organisationId: organisationId(),
  email: email('email').notNull(),
  grantedBy: email('granted_by').notNull(),
  grantedAt: instant('granted_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.email] })]);

export const employeeDirectory = pgTable('employee_directory', {
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  displayName: varchar('display_name', { length: 200 }).notNull(),
  photoUrl: varchar('photo_url', { length: 500 }),
  departmentId: varchar('department_id', { length: 64 }),
  departmentName: varchar('department_name', { length: 160 }),
  status: varchar('status', { length: 32 }).notNull(),
  email: email('email'),
  fetchedAt: instant('fetched_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.organisationId, t.employeeRef] }),
  index('employee_directory_email_idx').on(t.organisationId, t.email),
]);

export const notificationOutbox = pgTable('notification_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organisationId: organisationId(),
  kind: varchar('kind', { length: 40 }).notNull(),
  employeeRef: varchar('employee_ref', { length: 64 }),
  subjectId: uuid('subject_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  audience: varchar('audience', { length: 16 }).notNull().default('employee'),
  attempts: smallint('attempts').notNull().default(0),
  lastError: text('last_error'),
  deliverAfter: instant('deliver_after').notNull(),
  cancelledAt: instant('cancelled_at'),
  deliveredAt: instant('delivered_at'),
  createdAt: instant('created_at').notNull(),
}, (t) => [
  check('notification_outbox_audience_valid', sql`${t.audience} in ('employee', 'managers')`),
  index('notification_outbox_pending_idx').on(t.organisationId, t.deliverAfter).where(sql`${t.deliveredAt} is null and ${t.cancelledAt} is null`),
  index('notification_outbox_subject_idx').on(t.organisationId, t.subjectId),
]);

/** The in-app inbox (FR-NTF-04). Employees by employee_ref, managers by email (DR-02). */
export const notifications = pgTable('notifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organisationId: organisationId(),
  recipientRef: varchar('recipient_ref', { length: 64 }),
  recipientEmail: email('recipient_email'),
  kind: varchar('kind', { length: 40 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body').notNull(),
  link: varchar('link', { length: 500 }).notNull(),
  shiftId: uuid('shift_id'),
  outboxId: bigint('outbox_id', { mode: 'number' }).notNull(),
  createdAt: instant('created_at').notNull(),
  readAt: instant('read_at'),
  emailedAt: instant('emailed_at'),
  emailAttempts: smallint('email_attempts').notNull().default(0),
  emailNextAt: instant('email_next_at').notNull(),
  emailError: text('email_error'),
}, (t) => [
  check('notifications_one_recipient', sql`(${t.recipientRef} is null) <> (${t.recipientEmail} is null)`),
  index('notifications_ref_idx').on(t.organisationId, t.recipientRef, t.createdAt),
  index('notifications_email_idx').on(t.organisationId, t.recipientEmail, t.createdAt),
  index('notifications_email_due_idx').on(t.organisationId, t.emailNextAt)
    .where(sql`${t.emailedAt} is null and ${t.emailAttempts} < ${sql.raw(String(MAX_EMAIL_ATTEMPTS))}`),
  uniqueIndex('notifications_outbox_ref_key').on(t.organisationId, t.outboxId, t.recipientRef).where(sql`${t.recipientRef} is not null`),
  uniqueIndex('notifications_outbox_email_key').on(t.organisationId, t.outboxId, t.recipientEmail).where(sql`${t.recipientEmail} is not null`),
]);

/** Backlog item 10: one token bucket per caller for write requests, shared by every server instance. */
export const rateLimits = pgTable('rate_limits', {
  organisationId: organisationId(),
  bucket: varchar('bucket', { length: 200 }).notNull(),
  tokens: doublePrecision('tokens').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.bucket] })]);

/** Backlog item 30: when a background job last started, so every instance shares one throttle. */
export const jobRuns = pgTable('job_runs', {
  organisationId: organisationId(),
  job: varchar('job', { length: 40 }).notNull(),
  startedAt: instant('started_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.job] })]);

/**
 * Backlog item 29: notice types a person does not want by email (they still get them in the app). `recipient` is
 * `ref:<employee_ref>` for employee notices and `email:<address>` for manager notices, matching how the inbox addresses them.
 */
export const emailOptOuts = pgTable('email_opt_outs', {
  organisationId: organisationId(),
  recipient: varchar('recipient', { length: 260 }).notNull(),
  kind: varchar('kind', { length: 40 }).notNull(),
  createdAt: instant('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.recipient, t.kind] })]);

/** M4 audit trail: one row per thing that happened to a shift. `actor` is null only for back-filled system events. */
export const auditEntries = pgTable('audit_entries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organisationId: organisationId(),
  shiftId: uuid('shift_id').notNull(),
  action: varchar('action', { length: 24 }).notNull().$type<AuditAction>(),
  actor: email('actor'),
  actorKind: varchar('actor_kind', { length: 8 }).notNull(),
  changes: jsonb('changes').$type<Record<string, [unknown, unknown]>>(),
  at: instant('at').notNull(),
}, (t) => [
  check('audit_entries_action_valid', sql`${t.action} in (${sql.raw(AUDIT_ACTIONS.map((a) => `'${a}'`).join(', '))})`),
  check('audit_entries_actor_kind_valid', sql`${t.actorKind} in ('manager', 'employee', 'system')`),
  index('audit_entries_shift_idx').on(t.organisationId, t.shiftId, t.at),
]);

/** M4 calendar feeds: one subscription token per employee, stored only as a SHA-256 hex digest. */
export const calendarFeeds = pgTable('calendar_feeds', {
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  createdAt: instant('created_at').notNull(),
  lastUsedAt: instant('last_used_at'),
}, (t) => [primaryKey({ columns: [t.organisationId, t.employeeRef] })]);
