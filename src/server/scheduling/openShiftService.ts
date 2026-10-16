import type { Principal } from '../auth/principal';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import type { DirectoryRepository } from '../repo/directory';
import type { ProfileRepository } from '../repo/profiles';
import type { RoleRepository } from '../repo/roles';
import type { SettingsRepository } from '../repo/settings';
import { type ShiftRecord, type ShiftRepository, shiftToMyApi } from '../repo/shifts';
import type { Clock } from '../support/clock';
import { localMidnight, nextDay } from '../support/time';
import type { Eligibility } from './eligibility';
import { MAX_RANGE_DAYS } from './scheduleService';
import type { UnitOfWork, WriteScope } from './unitOfWork';

export const taken = () => HttpError.conflict('SHIFT_TAKEN', 'Someone else took this shift first.');
export const changed = () => HttpError.conflict('SHIFT_CHANGED', 'This shift changed while you were acting on it. Reload and try again.');
export const started = () => HttpError.conflict('SHIFT_STARTED', 'This shift has already started.');

/** Only people on the roster plan their own shifts. */
export function rosterRef(by: Principal): string {
  if (!by.employeeRef) throw HttpError.forbidden('You are not on the planning roster.', 'NOT_ON_ROSTER');
  return by.employeeRef;
}

export function shiftIdFrom(body: Record<string, unknown>): string {
  const input = new Input(body);
  const id = input.string('shift_id', 36, true);
  input.check();
  return id!;
}

/** FR-OPN-01..05, BR-05..07, NFR-04: what employees do with open shifts and with shifts they cannot work. */
export class OpenShiftService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly roles: RoleRepository,
    private readonly directory: DirectoryRepository,
    private readonly settings: SettingsRepository,
    private readonly eligibility: Eligibility,
    private readonly unit: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async available(query: Record<string, string>, by: Principal) {
    const ref = rosterRef(by);
    const input = new Input(query);
    const range = input.dateRange('from', 'to', MAX_RANGE_DAYS);
    input.check();
    const settings = await this.settings.get();
    const zone = (await this.profiles.find(ref)).timezone ?? settings.timezone;
    const from = new Date(localMidnight(range![0], zone));
    const to = new Date(localMidnight(nextDay(range![1]), zone));
    const now = this.clock.now();
    const [open, switchable, roles, people] = await Promise.all([
      this.shifts.openPublished(from, to, now), this.shifts.upForSwitch(from, to, now), this.roles.all(), this.directory.all(),
    ]);
    const names = new Map(people.map((p) => [p.employeeRef, p.displayName]));
    // Switch requests only count in Switch mode, so one that slipped past a mode change is never offered.
    const takeable = settings.give_up_mode === 'switch' ? switchable.filter((s) => s.employeeRef !== ref) : [];
    const allowed = new Set((await this.eligibility.eligibleShifts([...open, ...takeable], [ref])).get(ref) ?? []);
    return {
      timezone: zone, from: range![0], to: range![1],
      give_up: { mode: settings.give_up_mode, window_days: settings.unassign_window_days },
      roles,
      open: open.filter((s) => allowed.has(s.id)).map(shiftToMyApi),
      up_for_switch: takeable.filter((s) => allowed.has(s.id)).map((s) => ({
        ...shiftToMyApi(s), note: null, owner_ref: s.employeeRef, owner_name: names.get(s.employeeRef!) ?? 'Unknown employee',
      })),
    };
  }

  /** FR-OPN-02. The lock makes one employee's claims run one at a time; the conditional update makes the shift go to exactly one person. */
  async claim(body: Record<string, unknown>, by: Principal): Promise<ShiftRecord> {
    const ref = rosterRef(by);
    const id = shiftIdFrom(body);
    const now = this.clock.now();
    const early = await this.shifts.find(id);
    if (!early || early.state !== 'published') throw HttpError.notFound('No published shift with that id.');
    if (early.start <= now) throw started();
    if (early.employeeRef) throw taken();
    return this.unit.run(async (scope) => {
      await scope.lockEmployee(ref);
      // Re-read inside the transaction: eligibility is judged on the shift as it is now, and the update is guarded by its version.
      const shift = await scope.shifts.find(id);
      if (!shift || shift.state !== 'published') throw HttpError.notFound('No published shift with that id.');
      await requireEligible(scope.eligibility, shift, ref);
      const claimed = (await scope.shifts.claim(shift.id, ref, shift.version, now)) ?? (await whyNotClaimed(scope, shift.id, now));
      await scope.outbox.addForManagers('shift_claimed', shift.id, { shift_id: shift.id, employee_ref: ref }, now);
      return claimed;
    });
  }
}

/** Refuses with every reason (FR-OPN-02 AC2). Pass `scope.eligibility` inside a transaction. */
export async function requireEligible(eligibility: Eligibility, shift: ShiftRecord, ref: string): Promise<void> {
  const reasons = await eligibility.check(shift, ref);
  if (reasons.length > 0) throw HttpError.conflict('NOT_ELIGIBLE', 'You cannot take this shift.', { reasons });
}

/** Explains a failed conditional update, from the shift as it is now. Always throws. */
export async function whyNotClaimed(scope: Pick<WriteScope, 'shifts'>, id: string, now: Date): Promise<never> {
  const fresh = await scope.shifts.find(id);
  if (!fresh || fresh.state !== 'published') throw HttpError.notFound('No published shift with that id.');
  if (fresh.employeeRef) throw taken();
  if (fresh.start <= now) throw started();
  throw changed();
}
