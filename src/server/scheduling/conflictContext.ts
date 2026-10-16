import { type Conflict, conflictsForEmployee, type UnavailableSpan } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import type { HolidayRepository } from '../repo/holidays';
import type { Profile, ProfileRepository } from '../repo/profiles';
import type { SettingsRepository } from '../repo/settings';
import { factsOf, type ShiftRecord, type ShiftRepository } from '../repo/shifts';
import type { TimeOff, TimeOffRepository } from '../repo/timeOff';
import { localDate, localMidnight, nextDay } from '../support/time';

/** Loads what BR-01 needs for one shift and runs the pure detector. */
export class ConflictContext {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly timeOff: TimeOffRepository,
    private readonly holidays: HolidayRepository,
    private readonly settings: SettingsRepository,
  ) {}

  /** Conflicts the shift would have if saved as given. Open shifts never conflict. Holidays count unless `holidays: false` (BR-05). */
  async conflictsFor(candidate: ShiftRecord, options: { holidays?: boolean } = {}): Promise<Conflict[]> {
    if (!candidate.employeeRef) return [];
    const profile = await this.profiles.find(candidate.employeeRef);
    const zone = await this.timezoneFor(profile);
    // Sequential: this may run on a transaction connection, which can run only one query at a time.
    const others = await this.shifts.forEmployeeOverlapping(candidate.employeeRef, candidate.start, candidate.end);
    const away = await this.timeOff.between(candidate.start, candidate.end, candidate.employeeRef);
    const holidays = options.holidays === false ? [] : await this.holidays.visibleBetween(localDate(candidate.start.getTime(), zone), localDate(candidate.end.getTime(), zone));
    const facts = [...others.filter((s) => s.id !== candidate.id).map(factsOf), factsOf(candidate)];
    return conflictsForEmployee(facts, ConflictContext.spans(away, holidays, zone), profile.roleIds).get(candidate.id) ?? [];
  }

  async timezoneFor(profile: Profile): Promise<string> {
    return profile.timezone ?? (await this.settings.timezone());
  }

  /** Time off plus visible holidays (whole local days in `zone`, so 23- and 25-hour days are right) as spans for the detector. */
  static spans(timeOff: TimeOff[], holidays: { date: string; name: string }[], zone: string): UnavailableSpan[] {
    return [
      ...timeOff.map((t): UnavailableSpan => ({ interval: Interval.of(t.start, t.end), kind: 'time_off', label: t.reason })),
      ...holidays.map((h): UnavailableSpan => ({
        interval: new Interval(localMidnight(h.date, zone), localMidnight(nextDay(h.date), zone)),
        kind: 'holiday',
        label: h.name,
      })),
    ];
  }
}
