import { allocatedByDay, availableByDay, overAllocatedDays } from '../domain/allocation';
import { type Conflict, conflictsForEmployee } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import { workingIntervals } from '../domain/workingHours';
import type { DirectoryRepository, DirectoryRow } from '../repo/directory';
import type { HolidayRepository } from '../repo/holidays';
import { blankProfile, type ProfileRepository } from '../repo/profiles';
import { seriesToApi, type SeriesRecord } from '../repo/recurrences';
import type { RoleRepository } from '../repo/roles';
import type { SettingsRepository } from '../repo/settings';
import { factsOf, type ShiftRecord, type ShiftRepository, shiftToApi } from '../repo/shifts';
import type { TimeOff, TimeOffRepository } from '../repo/timeOff';
import { DIRECTORY_MAX_AGE_SECONDS, type DirectoryRefresher } from '../roster/refresher';
import type { Clock } from '../support/clock';
import { iso, localDate, localMidnight, nextDay } from '../support/time';
import { ConflictContext } from './conflictContext';
import type { RecurrenceService } from './recurrenceService';

export const MAX_RANGE_DAYS = 62;
const CONTEXT_MARGIN_MS = 7 * 86_400_000; // the longest possible shift

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (byDay: Record<string, number>) => round2(Object.values(byDay).reduce((a, b) => a + b, 0));

/** Everything the schedule screen needs, in a fixed number of queries (FR-SCH-01..09, NFR-01). */
export class ScheduleService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly roles: RoleRepository,
    private readonly directory: DirectoryRepository,
    private readonly refresher: DirectoryRefresher,
    private readonly timeOff: TimeOffRepository,
    private readonly holidays: HolidayRepository,
    private readonly settings: SettingsRepository,
    private readonly clock: Clock,
    private readonly recurrences: RecurrenceService,
  ) {}

  /** `viewZone` is the viewer's time zone (BR-10): the period's days start and end there. It defaults to the organisation's. */
  async build(fromDate: string, toDate: string, viewZone?: string) {
    // D3: a missed cron run (or a shrunk horizon) fixes itself on the next schedule read; extendAll's own
    // dueForExtension query makes this a cheap no-op when nothing is actually behind.
    await this.recurrences.extendAll(this.clock.now());
    const orgZone = await this.settings.timezone();
    const periodZone = viewZone ?? orgZone;
    const from = localMidnight(fromDate, periodZone);
    const to = localMidnight(nextDay(toDate), periodZone);
    const period = new Interval(from, to);
    const wideFrom = new Date(from - CONTEXT_MARGIN_MS);
    const wideTo = new Date(to + CONTEXT_MARGIN_MS);

    await this.refresher.refreshIfEmpty();
    const [directoryRows, profiles, allShifts, timeOffRows, holidays, roles, lastFetched] = await Promise.all([
      this.directory.all(),
      this.profiles.all(),
      this.shifts.overlapping(wideFrom, wideTo),
      this.timeOff.between(wideFrom, wideTo),
      this.holidays.visibleBetween(localDate(wideFrom.getTime(), orgZone), localDate(wideTo.getTime(), orgZone)),
      this.roles.all(),
      this.directory.lastFetchedAt(),
    ]);

    const directory = new Map<string, DirectoryRow>(directoryRows.map((d) => [d.employeeRef, d]));
    const visible = allShifts.filter((s) => s.start.getTime() < to && s.end.getTime() > from);
    const seriesIds = [...new Set(visible.flatMap((s) => (s.recurrenceId ? [s.recurrenceId] : [])))];
    const seriesById = new Map<string, SeriesRecord>((await this.recurrences.findMany(seriesIds)).map((s) => [s.id, s]));
    const byEmployee = groupBy(allShifts.filter((s) => s.employeeRef), (s) => s.employeeRef!);
    const awayByEmployee = groupBy(timeOffRows, (t: TimeOff) => t.employeeRef);
    const refs = [...new Set([...directory.keys(), ...visible.flatMap((s) => (s.employeeRef ? [s.employeeRef] : []))])];

    const conflicts = new Map<string, Conflict[]>();
    const employees = refs.map((ref) => {
      const profile = profiles.get(ref) ?? blankProfile(ref);
      const zone = profile.timezone ?? orgZone;
      const mine = byEmployee.get(ref) ?? [];
      const facts = mine.map(factsOf);
      const spans = ConflictContext.spans(awayByEmployee.get(ref) ?? [], holidays, zone);
      for (const [id, list] of conflictsForEmployee(facts, spans, profile.roleIds)) conflicts.set(id, list);

      const working = profile.workingHours ? workingIntervals(profile.workingHours, from, to, zone) : [];
      const periodSpans = spans.filter((s) => s.interval.overlaps(period));
      const available = profile.workingHours ? availableByDay(working, periodSpans.map((s) => s.interval), zone) : null;
      const firstDay = localDate(from, zone);
      const endDay = localDate(to, zone);
      const allocated = Object.fromEntries(Object.entries(allocatedByDay(facts, zone)).filter(([d]) => d >= firstDay && d < endDay));
      const d = directory.get(ref);

      return {
        employee_ref: ref,
        name: d?.displayName ?? 'Unknown employee',
        photo_url: d?.photoUrl ?? null,
        department_id: d?.departmentId ?? null,
        department_name: d?.departmentName ?? null,
        status: d?.status ?? 'unknown',
        on_roster: d !== undefined,
        role_ids: profile.roleIds,
        default_role_id: profile.defaultRoleId,
        timezone: zone,
        flexible: profile.workingHours === null,
        allocated_hours: sum(allocated),
        available_hours: available ? sum(available) : null,
        over_allocated_days: overAllocatedDays(allocated, available),
        working_intervals: working.map((i) => ({ start_at: iso(i.start), end_at: iso(i.end) })),
        unavailable: periodSpans.map((s) => ({ start_at: iso(s.interval.start), end_at: iso(s.interval.end), kind: s.kind, label: s.label })),
      };
    });
    employees.sort((a, b) => a.name.localeCompare(b.name) || a.employee_ref.localeCompare(b.employee_ref));

    return {
      period: { from: fromDate, to: toDate, timezone: periodZone, from_at: iso(from), to_at: iso(to) },
      directory_stale: !lastFetched || this.clock.now().getTime() - lastFetched.getTime() > DIRECTORY_MAX_AGE_SECONDS * 1000,
      roles,
      employees,
      shifts: visible.map((s: ShiftRecord) => {
        const series = s.recurrenceId ? seriesById.get(s.recurrenceId) ?? null : null;
        return shiftToApi(s, conflicts.get(s.id) ?? [], series ? seriesToApi(series, s.recurrenceIndex, s.recurrenceDetached) : null);
      }),
    };
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}
