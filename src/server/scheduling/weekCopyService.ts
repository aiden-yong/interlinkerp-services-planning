import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { DirectoryRepository } from '../repo/directory';
import type { SettingsRepository } from '../repo/settings';
import type { ShiftRecord, ShiftRepository } from '../repo/shifts';
import { Input } from '../http/input';
import type { ConflictContext } from './conflictContext';
import type { UnitOfWork } from './unitOfWork';

export interface WeekCopyReport {
  created: number;
  skipped_recurring: number;
  skipped_already_copied: number;
  skipped_off_roster: number;
  conflicts: number;
}

/** FR-PUB-04: duplicates last week's one-off shifts into this week as drafts, so a manager need not re-plan a week from scratch. */
export class WeekCopyService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly directory: DirectoryRepository,
    private readonly context: ConflictContext,
    private readonly settings: SettingsRepository,
    private readonly unit: UnitOfWork,
  ) {}

  /** Validates { week_start, dry_run? } from the request body; returns the parsed values, or null when field errors have already been added to `input`. */
  parse(input: Input): { weekStart: string; dryRun: boolean } | null {
    const weekStart = input.date('week_start', true);
    let ok = weekStart !== null;
    if (weekStart && DateTime.fromISO(weekStart).weekday !== 1) {
      input.error('week_start', 'Must be a Monday.');
      ok = false;
    }
    const dryRun = input.bool('dry_run', false);
    return ok ? { weekStart: weekStart!, dryRun } : null;
  }

  /**
   * D11: sources are live, one-off (non-recurring) shifts starting in [weekStart - 7 days, weekStart) in the
   * organisation zone, whose employee (if any) is still on the roster, and that have not already been copied into
   * this destination week. Copies move +7 days with Luxon in the organisation zone (so a DST/month-end boundary
   * keeps the same wall-clock time), land as drafts with no acknowledgement, and record `copied_from`.
   */
  async run(weekStart: string, dryRun: boolean, by: string, now: Date): Promise<WeekCopyReport> {
    const zone = await this.settings.timezone();
    const to = DateTime.fromISO(weekStart, { zone }).toJSDate();
    const from = DateTime.fromJSDate(to, { zone }).minus({ days: 7 }).toJSDate();
    const sources = (await this.shifts.overlapping(from, to)).filter((s) => s.start >= from && s.start < to);

    const report: WeekCopyReport = { created: 0, skipped_recurring: 0, skipped_already_copied: 0, skipped_off_roster: 0, conflicts: 0 };
    const directoryEmpty = await this.directory.isEmpty();
    const destTo = DateTime.fromJSDate(to, { zone }).plus({ days: 7 }).toJSDate();
    const already = await this.shifts.copiedInto(sources.map((s) => s.id), to, destTo);

    const candidates: ShiftRecord[] = [];
    for (const source of sources) {
      if (source.recurrenceId !== null) { report.skipped_recurring++; continue; }
      // eslint-disable-next-line no-await-in-loop -- pool-level roster lookups, same pattern as ShiftService.validateEmployee
      if (source.employeeRef && !directoryEmpty && !(await this.directory.find(source.employeeRef))) { report.skipped_off_roster++; continue; }
      if (already.has(source.id)) { report.skipped_already_copied++; continue; }
      candidates.push(source);
    }

    const copies: ShiftRecord[] = [];
    for (const source of candidates) {
      const start = DateTime.fromJSDate(source.start, { zone }).plus({ days: 7 }).toJSDate();
      const end = DateTime.fromJSDate(source.end, { zone }).plus({ days: 7 }).toJSDate();
      const copy: ShiftRecord = {
        ...source, id: randomUUID(), start, end, state: 'draft', publishedAt: null, version: 1, createdBy: by,
        deletedAt: null, switchRequestedAt: null, ackBy: null, ackAt: null,
        recurrenceId: null, recurrenceIndex: null, recurrenceDetached: false, copiedFrom: source.id,
      };
      // eslint-disable-next-line no-await-in-loop -- pool-level conflict checks, same pattern as ShiftService.guardConflicts/RecurrenceService.previewConflicts
      if ((await this.context.conflictsFor(copy)).length > 0) report.conflicts++;
      copies.push(copy);
    }
    report.created = copies.length;

    if (!dryRun && copies.length > 0) await this.unit.run(({ shifts }) => shifts.insertMany(copies, now));
    return report;
  }
}
