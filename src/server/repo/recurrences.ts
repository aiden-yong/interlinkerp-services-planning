import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { recurrences } from '../db/schema';
import type { RepeatEnds, RepeatRule, RepeatUnit } from '../domain/recurrence';
import { isUuid } from '../support/ids';

export interface SeriesRecord extends RepeatRule {
  id: string;
  employeeRef: string | null;
  roleId: string | null;
  breakMinutes: number;
  percent: number;
  note: string | null;
  /**
   * How far occurrences have been generated so far. Always advances to the horizon cutoff on every `extendOne` sweep,
   * even for a bounded (`ends: 'on'`/`'after'`) series that had already produced every occurrence it ever will (that
   * sweep inserts nothing, but still bumps this). So this means "a sweep last ran up to here", not "real occurrences
   * exist up to here, and the series is still generating" — do not use it to infer whether a series is still active.
   */
  generatedUntil: Date;
  createdBy: string;
}

const toRecord = (r: typeof recurrences.$inferSelect): SeriesRecord => ({
  id: r.id,
  interval: r.interval,
  unit: r.unit as RepeatUnit,
  ends: r.ends as RepeatEnds,
  untilDate: r.untilDate,
  count: r.occurrenceCount,
  timezone: r.timezone,
  // Postgres returns `timestamp` columns as "YYYY-MM-DD HH:MI:SS[.ffffff]" (mode: 'string'); normalise back to the
  // 'YYYY-MM-DDTHH:MM' wall-clock format RepeatRule.firstStartLocal documents and occurrences() expects.
  firstStartLocal: `${r.firstStartLocal.slice(0, 10)}T${r.firstStartLocal.slice(11, 16)}`,
  durationMinutes: r.durationMinutes,
  lastIndex: r.lastIndex,
  employeeRef: r.employeeRef,
  roleId: r.roleId,
  breakMinutes: r.breakMinutes,
  percent: r.allocatedPercent,
  note: r.note,
  generatedUntil: r.generatedUntil,
  createdBy: r.createdBy,
});

export function seriesToApi(s: SeriesRecord, index: number | null, detached: boolean) {
  return {
    id: s.id, interval: s.interval, unit: s.unit, ends: s.ends, until_date: s.untilDate, count: s.count, index, detached,
  };
}

export class RecurrenceRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async find(id: string): Promise<SeriesRecord | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(recurrences).where(and(eq(recurrences.organisationId, this.org), eq(recurrences.id, id))).limit(1);
    return row ? toRecord(row) : null;
  }

  /** Several series in one query (e.g. for a schedule's list of shifts), so a page of shifts never costs one query per series. */
  async findMany(ids: string[]): Promise<SeriesRecord[]> {
    const valid = [...new Set(ids)].filter(isUuid);
    if (valid.length === 0) return [];
    const rows = await this.db.select().from(recurrences).where(and(eq(recurrences.organisationId, this.org), inArray(recurrences.id, valid)));
    return rows.map(toRecord);
  }

  async insert(s: SeriesRecord, now: Date): Promise<void> {
    await this.db.insert(recurrences).values({
      id: s.id, organisationId: this.org, interval: s.interval, unit: s.unit, ends: s.ends, untilDate: s.untilDate,
      occurrenceCount: s.count, timezone: s.timezone, firstStartLocal: s.firstStartLocal, durationMinutes: s.durationMinutes,
      employeeRef: s.employeeRef, roleId: s.roleId, breakMinutes: s.breakMinutes, allocatedPercent: s.percent, note: s.note,
      lastIndex: s.lastIndex, generatedUntil: s.generatedUntil, createdBy: s.createdBy, createdAt: now, updatedAt: now,
    });
  }

  async update(s: SeriesRecord, now: Date): Promise<void> {
    await this.db.update(recurrences).set({
      interval: s.interval, unit: s.unit, ends: s.ends, untilDate: s.untilDate, occurrenceCount: s.count,
      timezone: s.timezone, firstStartLocal: s.firstStartLocal, durationMinutes: s.durationMinutes,
      employeeRef: s.employeeRef, roleId: s.roleId, breakMinutes: s.breakMinutes, allocatedPercent: s.percent, note: s.note,
      lastIndex: s.lastIndex, generatedUntil: s.generatedUntil, updatedAt: now,
    }).where(and(eq(recurrences.organisationId, this.org), eq(recurrences.id, s.id)));
  }

  /**
   * Ids with generated_until < before. Does not additionally filter out series that have already produced every
   * occurrence they ever will (ends: 'on' / 'after' fully generated) — `occurrences()` is self-limiting for those,
   * so re-matching one here only costs a cheap no-op extension, never a correctness problem.
   */
  async dueForExtension(before: Date): Promise<string[]> {
    const rows = await this.db.select({ id: recurrences.id }).from(recurrences)
      .where(and(eq(recurrences.organisationId, this.org), lt(recurrences.generatedUntil, before)));
    return rows.map((r) => r.id);
  }
}
