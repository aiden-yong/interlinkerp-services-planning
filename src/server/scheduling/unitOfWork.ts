import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { HolidayRepository } from '../repo/holidays';
import { Outbox } from '../repo/outbox';
import { ProfileRepository } from '../repo/profiles';
import { RecurrenceRepository } from '../repo/recurrences';
import { SettingsRepository } from '../repo/settings';
import { ShiftRepository } from '../repo/shifts';
import { TimeOffRepository } from '../repo/timeOff';
import { ConflictContext } from './conflictContext';
import { Eligibility } from './eligibility';

/** The repositories a write may use; all of them share one transaction (and one connection). */
export interface WriteScope {
  shifts: ShiftRepository;
  outbox: Outbox;
  settings: SettingsRepository;
  /** BR-05 reading through this transaction's connection, so a transaction never waits on the pool. */
  eligibility: Eligibility;
  recurrences: RecurrenceRepository;
  /** Serialises this employee's claims and take-overs until the transaction ends (NFR-04). */
  lockEmployee(ref: string): Promise<void>;
  /** Serialises changes to the give-up settings against switch requests until the transaction ends (BR-07). */
  lockSettings(): Promise<void>;
  /** Serialises two extensions of the same series until the transaction ends (Review Focus 4). */
  lockSeries(id: string): Promise<void>;
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
      return work({
        shifts,
        outbox: new Outbox(db, this.org),
        settings,
        eligibility: new Eligibility(shifts, profiles, timeOff, context),
        recurrences: new RecurrenceRepository(db, this.org),
        lockEmployee: async (ref) => {
          // hashtext is 32-bit, so two employees can share a key; the only effect is a little extra serialisation.
          await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${this.org}:${ref}`}))`);
        },
        lockSettings: async () => {
          await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${this.org}:settings`}))`);
        },
        lockSeries: async (id) => {
          await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${this.org}:series:${id}`}))`);
        },
      });
    }, { isolationLevel: 'read committed' });
  }
}
