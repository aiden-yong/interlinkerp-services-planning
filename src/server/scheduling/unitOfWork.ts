import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { AuditRepository } from '../repo/audit';
import { HolidayRepository } from '../repo/holidays';
import { Outbox } from '../repo/outbox';
import { ProfileRepository } from '../repo/profiles';
import { RecurrenceRepository } from '../repo/recurrences';
import { SettingsRepository } from '../repo/settings';
import { ShiftRepository } from '../repo/shifts';
import { TimeOffRepository } from '../repo/timeOff';
import { ConflictContext } from './conflictContext';
import { Eligibility } from './eligibility';

/**
 * The repositories a write may use; all of them share one transaction (and one connection).
 *
 * Lock order (advisory transaction locks). A transaction takes the locks it needs in this order and never goes back:
 *   1. auto-plan (`tryLockAutoPlan`)
 *   2. series (`lockSeries`)
 *   3. employees, in sorted ref order (`lockEmployee`, or `lockEmployees` which sorts)
 *   4. settings (`lockSettings`)
 * Every write that gives an employee a shift or time off (manager shift writes, series writes, week copy, time off,
 * claims, take-overs, Auto Plan) holds that employee's lock before writing, so Auto Plan, which holds every candidate's
 * lock while it re-reads and assigns, is serialised with all of them (BR-02). Auto Plan takes steps 1 and 3 only and
 * never a series lock (it runs the series extension before its own transaction opens), so it cannot deadlock with a
 * series write. Taking the same lock twice in one transaction is a no-op, so a service may re-lock inside a helper.
 */
export interface WriteScope {
  shifts: ShiftRepository;
  /** Time off through this transaction's connection; take the employee's lock before writing it. */
  timeOff: TimeOffRepository;
  outbox: Outbox;
  settings: SettingsRepository;
  /** BR-05 reading through this transaction's connection, so a transaction never waits on the pool. */
  eligibility: Eligibility;
  recurrences: RecurrenceRepository;
  /** DR-04: every shift write records what happened here, in the same transaction. */
  audit: AuditRepository;
  /** Serialises this employee's claims and take-overs until the transaction ends (NFR-04). */
  lockEmployee(ref: string): Promise<void>;
  /** Locks several employees in sorted ref order (nulls and duplicates are ignored), so two callers cannot deadlock. */
  lockEmployees(refs: Iterable<string | null | undefined>): Promise<void>;
  /** Serialises changes to the give-up settings against switch requests until the transaction ends (BR-07). */
  lockSettings(): Promise<void>;
  /** Serialises two extensions of the same series until the transaction ends (Review Focus 4). */
  lockSeries(id: string): Promise<void>;
  /** Auto Plan (D14): takes the organisation's Auto Plan lock until the transaction ends; false when another run holds it. */
  tryLockAutoPlan(): Promise<boolean>;
}

/**
 * Runs a change and the notifications it causes in one transaction, so either
 * both are saved or neither is. Reused by every shift write.
 */
export class UnitOfWork {
  constructor(private readonly db: Db, private readonly org: string, private readonly defaultTimezone: string) {}

  run<T>(work: (scope: WriteScope) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => {
      const db = tx as unknown as Db;
      const shifts = new ShiftRepository(db, this.org);
      const profiles = new ProfileRepository(db, this.org);
      const timeOff = new TimeOffRepository(db, this.org);
      const settings = new SettingsRepository(db, this.org, this.defaultTimezone);
      const context = new ConflictContext(shifts, profiles, timeOff, new HolidayRepository(db, this.org), settings);
      const lockEmployee = async (ref: string) => {
        // hashtext is 32-bit, so two employees can share a key; the only effect is a little extra serialisation.
        await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${this.org}:${ref}`}))`);
      };
      return work({
        shifts,
        timeOff,
        outbox: new Outbox(db, this.org),
        settings,
        eligibility: new Eligibility(shifts, profiles, timeOff, context),
        recurrences: new RecurrenceRepository(db, this.org),
        audit: new AuditRepository(db, this.org),
        lockEmployee,
        lockEmployees: async (refs) => {
          const sorted = [...new Set([...refs].filter((r): r is string => !!r))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          // eslint-disable-next-line no-await-in-loop -- one at a time, in sorted order, on the transaction's connection
          for (const ref of sorted) await lockEmployee(ref);
        },
        lockSettings: async () => {
          await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${this.org}:settings`}))`);
        },
        lockSeries: async (id) => {
          await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${this.org}:series:${id}`}))`);
        },
        tryLockAutoPlan: async () => {
          const result = await db.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`${this.org}:auto-plan`})) as locked`);
          return result.rows[0]?.locked === true;
        },
      });
    }, { isolationLevel: 'read committed' });
  }
}
