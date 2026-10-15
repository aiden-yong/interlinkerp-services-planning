import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, char, check, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WorkingHoursMap = Record<Weekday, [string, string][]>;

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const organisationId = () => varchar('organisation_id', { length: 64 }).notNull();
const email = (name: string) => varchar(name, { length: 254 });

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
}, (t) => [
  check('shifts_end_after_start', sql`${t.endAt} > ${t.startAt}`),
  check('shifts_percent_range', sql`${t.allocatedPercent} between 1 and 100`),
  check('shifts_break_non_negative', sql`${t.breakMinutes} >= 0`),
  check('shifts_state_valid', sql`${t.state} in ('draft', 'published')`),
  index('shifts_live_time_idx').on(t.organisationId, t.startAt, t.endAt).where(sql`${t.deletedAt} is null`),
  index('shifts_live_employee_idx').on(t.organisationId, t.employeeRef, t.startAt).where(sql`${t.deletedAt} is null`),
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
  updatedAt: instant('updated_at').notNull(),
});

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
  fetchedAt: instant('fetched_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.employeeRef] })]);

export const notificationOutbox = pgTable('notification_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organisationId: organisationId(),
  kind: varchar('kind', { length: 40 }).notNull(),
  employeeRef: varchar('employee_ref', { length: 64 }),
  subjectId: uuid('subject_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  deliverAfter: instant('deliver_after').notNull(),
  cancelledAt: instant('cancelled_at'),
  deliveredAt: instant('delivered_at'),
  createdAt: instant('created_at').notNull(),
}, (t) => [
  index('notification_outbox_pending_idx').on(t.organisationId, t.deliverAfter).where(sql`${t.deliveredAt} is null and ${t.cancelledAt} is null`),
  index('notification_outbox_subject_idx').on(t.organisationId, t.subjectId),
]);
