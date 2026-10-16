import { and, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { shifts } from '../db/schema';
import { type ShiftFacts, shiftHours } from '../domain/allocation';
import type { Conflict } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import { isUuid } from '../support/ids';
import { iso } from '../support/time';

export interface ShiftRecord {
  id: string;
  employeeRef: string | null;
  roleId: string | null;
  start: Date;
  end: Date;
  breakMinutes: number;
  percent: number;
  note: string | null;
  state: 'draft' | 'published';
  publishedAt: Date | null;
  ackBy: string | null;
  ackAt: Date | null;
  version: number;
  createdBy: string;
  deletedAt: Date | null;
  switchRequestedAt: Date | null;
}

const toRecord = (r: typeof shifts.$inferSelect): ShiftRecord => ({
  id: r.id, employeeRef: r.employeeRef, roleId: r.roleId, start: r.startAt, end: r.endAt, breakMinutes: r.breakMinutes, percent: r.allocatedPercent,
  note: r.note, state: r.state as ShiftRecord['state'], publishedAt: r.publishedAt, ackBy: r.conflictAcknowledgedBy, ackAt: r.conflictAcknowledgedAt,
  version: r.version, createdBy: r.createdBy, deletedAt: r.deletedAt,
  switchRequestedAt: r.switchRequestedAt,
});

const one = (rows: (typeof shifts.$inferSelect)[]): ShiftRecord | null => (rows.length === 1 ? toRecord(rows[0]!) : null);

export function factsOf(s: ShiftRecord): ShiftFacts {
  return { id: s.id, employeeRef: s.employeeRef, roleId: s.roleId, interval: Interval.of(s.start, s.end), breakMinutes: s.breakMinutes, percent: s.percent };
}

export function shiftToApi(s: ShiftRecord, conflicts: Conflict[] = []) {
  return {
    id: s.id, employee_ref: s.employeeRef, role_id: s.roleId, start_at: iso(s.start), end_at: iso(s.end),
    break_minutes: s.breakMinutes, allocated_percent: s.percent, allocated_hours: shiftHours(factsOf(s)), note: s.note,
    state: s.state, published_at: s.publishedAt ? iso(s.publishedAt) : null, version: s.version,
    conflicts, conflict_acknowledged: s.ackAt !== null, switch_requested: s.switchRequestedAt !== null,
  };
}

/** What an employee sees of their own published shift (FR-MYP-01). */
export function shiftToMyApi(s: ShiftRecord) {
  return { id: s.id, role_id: s.roleId, start_at: iso(s.start), end_at: iso(s.end), break_minutes: s.breakMinutes, allocated_hours: shiftHours(factsOf(s)), note: s.note, switch_requested: s.switchRequestedAt !== null };
}

export class ShiftRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  private live() {
    return and(eq(shifts.organisationId, this.org), isNull(shifts.deletedAt));
  }

  async find(id: string, withDeleted = false): Promise<ShiftRecord | null> {
    if (!isUuid(id)) return null;
    const scope = withDeleted ? eq(shifts.organisationId, this.org) : this.live();
    const [row] = await this.db.select().from(shifts).where(and(scope, eq(shifts.id, id))).limit(1);
    return row ? toRecord(row) : null;
  }

  /** Live shifts overlapping [from, to), open shifts included. Served by the partial index shifts_live_time_idx. */
  async overlapping(from: Date, to: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts).where(and(this.live(), lt(shifts.startAt, to), gt(shifts.endAt, from))).orderBy(shifts.startAt, shifts.id);
    return rows.map(toRecord);
  }

  async forEmployeeOverlapping(ref: string, from: Date, to: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts)
      .where(and(this.live(), eq(shifts.employeeRef, ref), lt(shifts.startAt, to), gt(shifts.endAt, from))).orderBy(shifts.startAt, shifts.id);
    return rows.map(toRecord);
  }

  async insert(s: ShiftRecord, now: Date): Promise<void> {
    await this.db.insert(shifts).values({
      id: s.id, organisationId: this.org, employeeRef: s.employeeRef, roleId: s.roleId, startAt: s.start, endAt: s.end,
      breakMinutes: s.breakMinutes, allocatedPercent: s.percent, note: s.note, state: s.state, publishedAt: s.publishedAt,
      conflictAcknowledgedBy: s.ackBy, conflictAcknowledgedAt: s.ackAt, version: s.version, createdBy: s.createdBy, switchRequestedAt: s.switchRequestedAt, createdAt: now, updatedAt: now,
    });
  }

  /** Saves only if nobody else saved since `expectedVersion` (optimistic concurrency); bumps the version. Returns the saved row, or null when the shift changed or was deleted meanwhile. */
  async update(s: ShiftRecord, expectedVersion: number, now: Date): Promise<ShiftRecord | null> {
    const updated = await this.db.update(shifts).set({
      employeeRef: s.employeeRef, roleId: s.roleId, startAt: s.start, endAt: s.end, breakMinutes: s.breakMinutes, allocatedPercent: s.percent,
      note: s.note, conflictAcknowledgedBy: s.ackBy, conflictAcknowledgedAt: s.ackAt, switchRequestedAt: s.switchRequestedAt, version: expectedVersion + 1, updatedAt: now,
    }).where(and(this.live(), eq(shifts.id, s.id), eq(shifts.version, expectedVersion))).returning();
    return updated.length === 1 ? toRecord(updated[0]!) : null;
  }

  /** Deletes a live shift; returns it as it was, or null when it was already deleted (or unknown). */
  async softDelete(id: string, by: string, now: Date): Promise<ShiftRecord | null> {
    const rows = await this.db.update(shifts).set({ deletedAt: now, deletedBy: by, updatedAt: now }).where(and(this.live(), eq(shifts.id, id))).returning();
    return rows.length === 1 ? toRecord(rows[0]!) : null;
  }

  /** Restores a shift only if it is still deleted at `deletedAt`; returns the live row, or null when that deletion is gone. */
  async restore(id: string, deletedAt: Date, now: Date): Promise<ShiftRecord | null> {
    const rows = await this.db.update(shifts).set({ deletedAt: null, deletedBy: null, updatedAt: now })
      .where(and(eq(shifts.organisationId, this.org), eq(shifts.id, id), eq(shifts.deletedAt, deletedAt))).returning();
    return rows.length === 1 ? toRecord(rows[0]!) : null;
  }

  /** Publishes the listed drafts; deleted, already-published and unknown ids are skipped. Rows are locked so two publishes cannot overlap. */
  async publish(ids: string[], now: Date): Promise<ShiftRecord[]> {
    const valid = ids.filter(isUuid);
    if (valid.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const drafts = await tx.select({ id: shifts.id }).from(shifts)
        .where(and(this.live(), eq(shifts.state, 'draft'), inArray(shifts.id, valid))).orderBy(shifts.startAt, shifts.id).for('update');
      if (drafts.length === 0) return [];
      const published = await tx.update(shifts).set({ state: 'published', publishedAt: now, updatedAt: now })
        .where(and(eq(shifts.organisationId, this.org), inArray(shifts.id, drafts.map((d) => d.id)))).returning();
      return published.map(toRecord).sort((a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id));
    });
  }

  async publishedForEmployee(ref: string, from: Date, to: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts)
      .where(and(this.live(), eq(shifts.employeeRef, ref), eq(shifts.state, 'published'), lt(shifts.startAt, to), gt(shifts.endAt, from)))
      .orderBy(shifts.startAt);
    return rows.map(toRecord);
  }

  /** Shifts by id, deleted ones included (notification rendering needs cancelled shifts too). */
  async byIds(ids: string[]): Promise<ShiftRecord[]> {
    const valid = ids.filter(isUuid);
    if (valid.length === 0) return [];
    const rows = await this.db.select().from(shifts).where(and(eq(shifts.organisationId, this.org), inArray(shifts.id, valid)));
    return rows.map(toRecord);
  }

  /** FR-OPN-01: published open shifts that have not started and overlap [from, to). */
  async openPublished(from: Date, to: Date, now: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts).where(and(this.live(), isNull(shifts.employeeRef), eq(shifts.state, 'published'),
      gt(shifts.startAt, now), lt(shifts.startAt, to), gt(shifts.endAt, from))).orderBy(shifts.startAt, shifts.id);
    return rows.map(toRecord);
  }

  /** FR-OPN-03: shifts with an active switch request. A request lapses when its shift starts (AC3). */
  async upForSwitch(from: Date, to: Date, now: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts).where(and(this.live(), isNotNull(shifts.switchRequestedAt), eq(shifts.state, 'published'),
      gt(shifts.startAt, now), lt(shifts.startAt, to), gt(shifts.endAt, from))).orderBy(shifts.startAt, shifts.id);
    return rows.map(toRecord);
  }

  /** NFR-04: takes an open published shift that has not started and is still at `expectedVersion`. null = someone else got it first, or it changed. */
  async claim(id: string, ref: string, expectedVersion: number, now: Date): Promise<ShiftRecord | null> {
    return one(await this.db.update(shifts).set({ employeeRef: ref, version: sql`${shifts.version} + 1`, updatedAt: now })
      .where(and(this.live(), eq(shifts.id, id), eq(shifts.version, expectedVersion), isNull(shifts.employeeRef), eq(shifts.state, 'published'), gt(shifts.startAt, now))).returning());
  }

  /** BR-07: ends every active switch request on a shift that has not started; returns the shifts whose owners must be told. Bumps the version so an in-flight take-over is caught. */
  async clearSwitchRequests(now: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.update(shifts).set({ switchRequestedAt: null, version: sql`${shifts.version} + 1`, updatedAt: now })
      .where(and(this.live(), isNotNull(shifts.switchRequestedAt), isNotNull(shifts.employeeRef), gt(shifts.startAt, now))).returning();
    return rows.map(toRecord);
  }

  /** Every give-up update below is guarded by `expectedVersion`, so it only applies to the shift as the caller judged it. null = it changed (or no longer qualifies). */
  async requestSwitch(id: string, ref: string, expectedVersion: number, now: Date): Promise<ShiftRecord | null> {
    return one(await this.db.update(shifts).set({ switchRequestedAt: now, version: sql`${shifts.version} + 1`, updatedAt: now })
      .where(and(this.live(), eq(shifts.id, id), eq(shifts.version, expectedVersion), eq(shifts.employeeRef, ref), eq(shifts.state, 'published'), gt(shifts.startAt, now), isNull(shifts.switchRequestedAt)))
      .returning());
  }

  async cancelSwitch(id: string, ref: string, expectedVersion: number, now: Date): Promise<ShiftRecord | null> {
    return one(await this.db.update(shifts).set({ switchRequestedAt: null, version: sql`${shifts.version} + 1`, updatedAt: now })
      .where(and(this.live(), eq(shifts.id, id), eq(shifts.version, expectedVersion), eq(shifts.employeeRef, ref), isNotNull(shifts.switchRequestedAt))).returning());
  }

  /** NFR-04: hands an up-for-switch shift from its owner to the taker. null = someone else took it, or it changed. */
  async takeOver(id: string, ownerRef: string, takerRef: string, expectedVersion: number, now: Date): Promise<ShiftRecord | null> {
    return one(await this.db.update(shifts).set({ employeeRef: takerRef, switchRequestedAt: null, version: sql`${shifts.version} + 1`, updatedAt: now })
      .where(and(this.live(), eq(shifts.id, id), eq(shifts.version, expectedVersion), eq(shifts.employeeRef, ownerRef), eq(shifts.state, 'published'), isNotNull(shifts.switchRequestedAt), gt(shifts.startAt, now)))
      .returning());
  }

  /** BR-06: only shifts starting after `earliestStart` (now + window) can be given up. */
  async unassign(id: string, ref: string, earliestStart: Date, expectedVersion: number, now: Date): Promise<ShiftRecord | null> {
    return one(await this.db.update(shifts).set({ employeeRef: null, switchRequestedAt: null, version: sql`${shifts.version} + 1`, updatedAt: now })
      .where(and(this.live(), eq(shifts.id, id), eq(shifts.version, expectedVersion), eq(shifts.employeeRef, ref), eq(shifts.state, 'published'), gt(shifts.startAt, earliestStart)))
      .returning());
  }
}
