import type { DirectoryRepository, DirectoryRow } from '../repo/directory';
import type { HolidayRepository } from '../repo/holidays';
import { blankProfile, type ProfileRepository } from '../repo/profiles';
import type { RoleRepository } from '../repo/roles';
import type { SettingsRepository } from '../repo/settings';
import type { ShiftRepository } from '../repo/shifts';
import type { TimeOff, TimeOffRepository } from '../repo/timeOff';
import type { DirectoryRefresher } from '../roster/refresher';
import { ConflictContext } from '../scheduling/conflictContext';
import type { RecurrenceService } from '../scheduling/recurrenceService';
import type { Clock } from '../support/clock';
import { localDate, localMidnight, nextDay } from '../support/time';
import type { ReportData } from './build';
import { reportEmployee, type ReportPeriod } from './hours';

const CONTEXT_MARGIN_MS = 7 * 86_400_000; // the longest possible shift, as the schedule reads it

/**
 * Loads what the reports (and Auto Plan) compute from. It reads exactly what ScheduleService.build reads, so
 * hours come out the same as on the schedule: shifts around the period are included, and the builders cut them.
 */
export class ReportService {
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

  /**
   * `viewZone` cuts the period's days (BR-10); it defaults to the organisation's zone. The role filter keeps shifts
   * of that role; the department filter keeps that department's employees and their shifts (open shifts stay).
   */
  async load(fromDate: string, toDate: string, viewZone: string | undefined, roleId?: string, departmentId?: string): Promise<ReportData> {
    await this.recurrences.extendAll(this.clock.now());
    const orgZone = await this.settings.timezone();
    const periodZone = viewZone ?? orgZone;
    const period: ReportPeriod = { from: localMidnight(fromDate, periodZone), to: localMidnight(nextDay(toDate), periodZone), viewZone: periodZone };
    const wideFrom = new Date(period.from - CONTEXT_MARGIN_MS);
    const wideTo = new Date(period.to + CONTEXT_MARGIN_MS);

    await this.refresher.refreshIfEmpty();
    const [directoryRows, profiles, allShifts, timeOffRows, holidays, roles] = await Promise.all([
      this.directory.all(),
      this.profiles.all(),
      this.shifts.overlapping(wideFrom, wideTo),
      this.timeOff.between(wideFrom, wideTo),
      this.holidays.visibleBetween(localDate(wideFrom.getTime(), orgZone), localDate(wideTo.getTime(), orgZone)),
      this.roles.all(),
    ]);

    const directory = new Map<string, DirectoryRow>(directoryRows.map((d) => [d.employeeRef, d]));
    const visible = allShifts.filter((s) => s.start.getTime() < period.to && s.end.getTime() > period.from);
    const awayByEmployee = new Map<string, TimeOff[]>();
    for (const t of timeOffRows) awayByEmployee.set(t.employeeRef, [...(awayByEmployee.get(t.employeeRef) ?? []), t]);
    const refs = [...new Set([...directory.keys(), ...visible.flatMap((s) => (s.employeeRef ? [s.employeeRef] : []))])];

    let employees = refs.map((ref) => {
      const profile = profiles.get(ref) ?? blankProfile(ref);
      const zone = profile.timezone ?? orgZone;
      return reportEmployee(ref, directory.get(ref), profile, zone, ConflictContext.spans(awayByEmployee.get(ref) ?? [], holidays, zone));
    });
    if (departmentId) employees = employees.filter((e) => e.departmentId === departmentId);
    const kept = new Set(employees.map((e) => e.ref));

    const shifts = allShifts
      .filter((s) => !roleId || s.roleId === roleId)
      .filter((s) => !s.employeeRef || kept.has(s.employeeRef))
      .map((s) => ({ id: s.id, employeeRef: s.employeeRef, roleId: s.roleId, start: s.start, end: s.end, breakMinutes: s.breakMinutes, percent: s.percent, state: s.state }));

    return { period, orgZone, shifts, employees, roles: roles.map((r) => ({ id: r.id, name: r.name })) };
  }
}
