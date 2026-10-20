import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Conflict } from '../domain/conflicts';
import { occurrences, type RepeatEnds, type RepeatRule, type RepeatUnit } from '../domain/recurrence';
import type { Logger } from '../http/kernel';
import type { Input } from '../http/input';
import { RecurrenceRepository, type SeriesRecord } from '../repo/recurrences';
import type { ShiftRecord } from '../repo/shifts';
import { localDate } from '../support/time';
import type { Clock } from '../support/clock';
import type { ConflictContext } from './conflictContext';
import type { UnitOfWork, WriteScope } from './unitOfWork';

export type RepeatFields = Pick<RepeatRule, 'interval' | 'unit' | 'ends' | 'untilDate' | 'count'>;

/** Builds the full RepeatRule used by occurrences(), from the parsed `repeat` fields plus the first shift. */
function ruleFrom(repeat: RepeatFields, zone: string, first: { start: Date; end: Date }): RepeatRule {
  return {
    interval: repeat.interval,
    unit: repeat.unit,
    ends: repeat.ends,
    untilDate: repeat.untilDate,
    count: repeat.count,
    timezone: zone,
    firstStartLocal: DateTime.fromJSDate(first.start, { zone }).toFormat("yyyy-MM-dd'T'HH:mm"),
    durationMinutes: Math.round((first.end.getTime() - first.start.getTime()) / 60_000),
    lastIndex: null,
  };
}

/** FR-REC-*, D1/D3/D4/D8: creates and extends repeating-shift series. */
export class RecurrenceService {
  constructor(
    private readonly recurrences: RecurrenceRepository,
    private readonly context: ConflictContext,
    private readonly unit: UnitOfWork,
    private readonly clock: Clock,
    private readonly log: Logger,
  ) {}

  /** Validates `repeat`; returns the rule fields or adds field errors to input (one 422 alongside the shift's own field errors). */
  parseRepeat(input: Input, key: 'repeat'): RepeatFields | null {
    const raw = input.raw(key);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      input.error(key, 'Must be an object.');
      return null;
    }
    const r = raw as Record<string, unknown>;
    let ok = true;

    const interval = r.interval;
    if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > 99) {
      input.error(`${key}.interval`, 'Must be a whole number between 1 and 99.');
      ok = false;
    }

    const unit = r.unit;
    if (unit !== 'day' && unit !== 'week' && unit !== 'month') {
      input.error(`${key}.unit`, 'Use day, week or month.');
      ok = false;
    }

    const ends = r.ends;
    if (ends !== 'never' && ends !== 'on' && ends !== 'after') {
      input.error(`${key}.ends`, 'Use never, on or after.');
      ok = false;
    }

    let untilDate: string | null = null;
    if (ends === 'on') {
      const value = r.until_date;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || DateTime.fromISO(value).toISODate() !== value) {
        input.error(`${key}.until_date`, 'Required when ends is on; use a real date in YYYY-MM-DD format.');
        ok = false;
      } else {
        untilDate = value;
      }
    }

    let count: number | null = null;
    if (r.count !== undefined && r.count !== null) {
      if (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1 || r.count > 999) {
        input.error(`${key}.count`, 'Must be a whole number between 1 and 999.');
        ok = false;
      } else {
        count = r.count;
      }
    }
    if (ends === 'after' && count === null && (typeof r.count === 'undefined' || r.count === null)) {
      input.error(`${key}.count`, 'Required when ends is after.');
      ok = false;
    }

    if (!ok) return null;
    return { interval: interval as number, unit: unit as RepeatUnit, ends: ends as RepeatEnds, untilDate, count };
  }

  /** Conflicts of every occurrence createSeries would make (first included), for the 409 SHIFT_CONFLICT answer (D8). */
  async previewConflicts(first: ShiftRecord, repeat: RepeatFields, zone: string, horizonMonths: number, now: Date): Promise<{ date: string; conflicts: Conflict[] }[]> {
    const rule = ruleFrom(repeat, zone, first);
    const until = DateTime.fromJSDate(now, { zone }).plus({ months: horizonMonths }).toJSDate();
    const steps = occurrences(rule, 0, until);
    const out: { date: string; conflicts: Conflict[] }[] = [];
    for (const step of steps) {
      const candidate: ShiftRecord = { ...first, start: step.start, end: step.end };
      // eslint-disable-next-line no-await-in-loop -- pool-level checks, one shift's time range at a time (same pattern as ShiftService.guardConflicts)
      const conflicts = await this.context.conflictsFor(candidate);
      out.push({ date: localDate(step.start.getTime(), zone), conflicts });
    }
    return out;
  }

  /**
   * In the caller's transaction: insert the series row from `first`, then `first` + its occurrences up to now + horizon.
   * Trusts the caller already resolved conflicts via `previewConflicts` — `conflictingDates` is that call's result
   * (the set of occurrence dates it flagged), reused here only to decide which rows get the acknowledgement stamped
   * on them. This never touches `ConflictContext`/the connection pool itself: a transaction must only read through its
   * own `scope`-bound repositories, never await the pool, so recomputing conflicts in here would risk pool starvation
   * or deadlock under load.
   */
  async createSeries(
    scope: WriteScope, first: ShiftRecord, repeat: RepeatFields, zone: string, horizonMonths: number,
    ack: { by: string; at: Date } | null, conflictingDates: ReadonlySet<string>, now: Date,
  ): Promise<{ seriesId: string; created: number }> {
    const rule = ruleFrom(repeat, zone, first);
    const until = DateTime.fromJSDate(now, { zone }).plus({ months: horizonMonths }).toJSDate();
    const steps = occurrences(rule, 0, until);
    const seriesId = randomUUID();

    const series: SeriesRecord = {
      id: seriesId, interval: rule.interval, unit: rule.unit, ends: rule.ends, untilDate: rule.untilDate, count: rule.count,
      timezone: zone, firstStartLocal: rule.firstStartLocal, durationMinutes: rule.durationMinutes, lastIndex: null,
      employeeRef: first.employeeRef, roleId: first.roleId, breakMinutes: first.breakMinutes, percent: first.percent, note: first.note,
      generatedUntil: until, createdBy: first.createdBy,
    };
    await scope.recurrences.insert(series, now);

    const rows: ShiftRecord[] = steps.map((step) => {
      const date = localDate(step.start.getTime(), zone);
      const flagged = ack !== null && conflictingDates.has(date);
      return {
        ...first, id: step.index === 0 ? first.id : randomUUID(), start: step.start, end: step.end,
        recurrenceId: seriesId, recurrenceIndex: step.index,
        ackBy: flagged ? ack!.by : null, ackAt: flagged ? ack!.at : null,
      };
    });
    const insertedIds = await scope.shifts.insertMany(rows, now);
    return { seriesId, created: insertedIds.length };
  }

  /** Generates missing shifts for one series up to now + horizon; one transaction, lockSeries first (so two extensions never double-create, Review Focus 4). */
  async extendOne(id: string, now: Date): Promise<number> {
    return this.unit.run(async (scope) => {
      await scope.lockSeries(id);
      const series = await scope.recurrences.find(id);
      if (!series) return 0;

      const horizonMonths = (await scope.settings.get()).recurrence_horizon_months;
      const until = DateTime.fromJSDate(now, { zone: series.timezone }).plus({ months: horizonMonths }).toJSDate();
      const maxIndex = await scope.shifts.maxRecurrenceIndex(id);
      const fromIndex = maxIndex === null ? 0 : maxIndex + 1;

      const rule: RepeatRule = {
        interval: series.interval, unit: series.unit, ends: series.ends, untilDate: series.untilDate, count: series.count,
        timezone: series.timezone, firstStartLocal: series.firstStartLocal, durationMinutes: series.durationMinutes, lastIndex: series.lastIndex,
      };
      const steps = occurrences(rule, fromIndex, until);
      const rows: ShiftRecord[] = steps.map((step) => ({
        id: randomUUID(), employeeRef: series.employeeRef, roleId: series.roleId, start: step.start, end: step.end,
        breakMinutes: series.breakMinutes, percent: series.percent, note: series.note, state: 'draft', publishedAt: null,
        ackBy: null, ackAt: null, version: 1, createdBy: series.createdBy, deletedAt: null, switchRequestedAt: null,
        recurrenceId: id, recurrenceIndex: step.index, recurrenceDetached: false, copiedFrom: null,
      }));
      const insertedIds = await scope.shifts.insertMany(rows, now);
      // generatedUntil always advances to `until` here, even for a bounded (ends: 'on'/'after') series that has
      // already produced every occurrence it ever will (occurrences() then returns an empty `steps`, so nothing is
      // actually inserted). That means generatedUntil can drift to mean "the last time a sweep touched this series",
      // not "real occurrences exist up to here" — do not read it as a signal that the series is still active/generating.
      await scope.recurrences.update({ ...series, generatedUntil: until }, now);
      return insertedIds.length;
    });
  }

  /** Every series due; never throws, logs failures (D1-style backstop); returns shifts created in total. */
  async extendAll(now: Date): Promise<number> {
    let total = 0;
    try {
      const { recurrence_horizon_months: horizonMonths, timezone: orgZone } = await this.unit.run((scope) => scope.settings.get());
      // D3: a series is "due" once its own horizon has fallen more than a day behind now + horizon, so a missed cron
      // run (or a shrunk horizon) is fixed on the next sweep or schedule read without re-extending on every single one.
      const threshold = DateTime.fromJSDate(now, { zone: orgZone }).plus({ months: horizonMonths }).minus({ days: 1 }).toJSDate();
      const ids = await this.recurrences.dueForExtension(threshold);
      for (const id of ids) {
        try {
          // eslint-disable-next-line no-await-in-loop -- each series gets its own transaction (lockSeries), sequential by design.
          total += await this.extendOne(id, now);
        } catch (err) {
          this.log(`[alert] recurrence extension failed for series ${id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.log(`[alert] recurrence extension sweep failed: ${(err as Error).message}`);
    }
    return total;
  }

  /** Used by GET /api/shifts/{id} to show the series on a shift. */
  async find(id: string): Promise<SeriesRecord | null> {
    return this.recurrences.find(id);
  }

  /** Used by ScheduleService.build() to show the series on every shift in a period, in one query. */
  async findMany(ids: string[]): Promise<SeriesRecord[]> {
    return this.recurrences.findMany(ids);
  }
}
