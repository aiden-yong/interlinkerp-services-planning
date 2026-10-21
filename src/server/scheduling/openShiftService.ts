import type { Principal } from '../auth/principal';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { changesOf, employeeActor } from '../repo/audit';
import type { DirectoryRepository } from '../repo/directory';
import type { ProfileRepository } from '../repo/profiles';
import type { RoleRepository } from '../repo/roles';
import type { OrgSettings, SettingsRepository } from '../repo/settings';
import { type ShiftRecord, type ShiftRepository, shiftToMyApi } from '../repo/shifts';
import type { Clock } from '../support/clock';
import { localMidnight, nextDay } from '../support/time';
import type { Eligibility } from './eligibility';
import { MAX_RANGE_DAYS } from './scheduleService';
import type { UnitOfWork, WriteScope } from './unitOfWork';

export const taken = () => HttpError.conflict('SHIFT_TAKEN', 'Someone else took this shift first.');
export const changed = () => HttpError.conflict('SHIFT_CHANGED', 'This shift changed while you were acting on it. Reload and try again.');
const notUp = () => HttpError.conflict('NOT_UP_FOR_SWITCH', 'This shift is not up for switch.');
const alreadyUp = () => HttpError.conflict('ALREADY_UP_FOR_SWITCH', 'This shift is already up for switch.');
const notYours = () => HttpError.notFound('No published shift of yours with that id.');
const outsideWindow = (days: number) => HttpError.conflict('OUTSIDE_UNASSIGN_WINDOW', days > 0 ? `Shifts can only be given up more than ${days} days before they start.` : 'Shifts can only be given up before they start.');
const modeOff = (mode: 'switch' | 'unassign') => HttpError.conflict('MODE_NOT_ACTIVE', mode === 'switch'
  ? 'Shifts cannot be put up for switch right now. Give them up instead.'
  : 'Shifts cannot be given up right now. Put them up for switch instead.');
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
        ...shiftToMyApi(s), note: null, owner_name: names.get(s.employeeRef!) ?? 'Unknown employee',
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
    if (early.employeeRef === ref) throw HttpError.conflict('OWN_SHIFT', 'This is already your shift.');
    if (early.employeeRef) throw taken();
    return this.unit.run(async (scope) => {
      await scope.lockEmployee(ref);
      // Re-read inside the transaction: eligibility is judged on the shift as it is now, and the update is guarded by its version.
      const shift = await scope.shifts.find(id);
      if (!shift || shift.state !== 'published') throw HttpError.notFound('No published shift with that id.');
      await requireEligible(scope.eligibility, shift, ref);
      const claimed = (await scope.shifts.claim(shift.id, ref, shift.version, now)) ?? (await whyNotClaimed(scope, shift.id, now));
      await scope.audit.record([{ shiftId: claimed.id, action: 'claimed', ...employeeActor(ref), changes: changesOf(shift, claimed) }], now);
      await scope.outbox.addForManagers('shift_claimed', shift.id, { shift_id: shift.id, employee_ref: ref }, now);
      return claimed;
    });
  }

  /** FR-OPN-03: the shift stays mine until a colleague takes it. Judged on the shift as it is inside the transaction. */
  async requestSwitch(body: Record<string, unknown>, by: Principal): Promise<ShiftRecord> {
    const ref = rosterRef(by);
    const id = shiftIdFrom(body);
    const now = this.clock.now();
    return this.unit.run(async (scope) => {
      // Same lock as applySettings: a request cannot read mode=switch and commit after the mode became Unassign.
      await scope.lockSettings();
      const shift = await ownFresh(scope, id, ref);
      if (shift.start <= now) throw started();
      if ((await scope.settings.get()).give_up_mode !== 'switch') throw modeOff('switch');
      if (shift.switchRequestedAt) throw alreadyUp();
      const row = await scope.shifts.requestSwitch(shift.id, ref, shift.version, now);
      if (row) {
        await scope.audit.record([{ shiftId: row.id, action: 'switch_requested', ...employeeActor(ref) }], now);
        return row;
      }
      const fresh = await ownFresh(scope, id, ref);
      if (fresh.start <= now) throw started();
      if (fresh.switchRequestedAt) throw alreadyUp();
      throw changed();
    });
  }

  async cancelSwitch(id: string, by: Principal): Promise<void> {
    const ref = rosterRef(by);
    const now = this.clock.now();
    await this.unit.run(async (scope) => {
      const shift = await ownFresh(scope, id, ref);
      if (!shift.switchRequestedAt) throw notUp();
      if (await scope.shifts.cancelSwitch(shift.id, ref, shift.version, now)) {
        await scope.audit.record([{ shiftId: shift.id, action: 'switch_cancelled', ...employeeActor(ref) }], now);
        return;
      }
      const fresh = await ownFresh(scope, id, ref);
      if (!fresh.switchRequestedAt) throw notUp();
      throw changed();
    });
  }

  /** FR-OPN-03 AC1, NFR-04: same lock, in-transaction re-read and version-guarded update as claim. */
  async takeOver(body: Record<string, unknown>, by: Principal): Promise<ShiftRecord> {
    const ref = rosterRef(by);
    const id = shiftIdFrom(body);
    const now = this.clock.now();
    return this.unit.run(async (scope) => {
      await scope.lockEmployee(ref);
      const shift = await scope.shifts.find(id);
      if (!shift || shift.state !== 'published') throw HttpError.notFound('No published shift with that id.');
      if (shift.employeeRef === ref) throw HttpError.conflict('OWN_SHIFT', 'This is already your shift.');
      if (shift.start <= now) throw started();
      // Checked before the request itself: a request that slipped past a change to Unassign is never acted on (BR-07).
      if ((await scope.settings.get()).give_up_mode !== 'switch') throw modeOff('switch');
      if (!shift.switchRequestedAt || !shift.employeeRef) throw notUp();
      const owner = shift.employeeRef;
      await requireEligible(scope.eligibility, shift, ref);
      const row = await scope.shifts.takeOver(shift.id, owner, ref, shift.version, now);
      if (!row) {
        const fresh = await scope.shifts.find(id);
        if (!fresh || fresh.state !== 'published') throw HttpError.notFound('No published shift with that id.');
        if (fresh.start <= now) throw started();
        if (fresh.employeeRef !== owner) throw taken();
        if (!fresh.switchRequestedAt) throw notUp();
        throw changed();
      }
      await scope.audit.record([{ shiftId: row.id, action: 'taken_over', ...employeeActor(ref), changes: changesOf(shift, row) }], now);
      await scope.outbox.add('switch_taken', owner, shift.id, { shift_id: shift.id, taker_ref: ref }, now, now);
      await scope.outbox.add('shift_assigned', ref, shift.id, { shift_id: shift.id }, now, now);
      await scope.outbox.addForManagers('shift_switched', shift.id, { shift_id: shift.id, from_ref: owner, to_ref: ref }, now);
      return row;
    });
  }

  /** FR-OPN-04, BR-06: the shift becomes an open shift and stays published. */
  async unassign(body: Record<string, unknown>, by: Principal): Promise<ShiftRecord> {
    const ref = rosterRef(by);
    const id = shiftIdFrom(body);
    const now = this.clock.now();
    return this.unit.run(async (scope) => {
      const shift = await ownFresh(scope, id, ref);
      if (shift.start <= now) throw started();
      const settings = await scope.settings.get();
      if (settings.give_up_mode !== 'unassign') throw modeOff('unassign');
      const earliest = new Date(now.getTime() + settings.unassign_window_days * 86_400_000);
      if (shift.start <= earliest) throw outsideWindow(settings.unassign_window_days);
      const row = await scope.shifts.unassign(shift.id, ref, earliest, shift.version, now);
      if (!row) {
        const fresh = await ownFresh(scope, id, ref);
        if (fresh.start <= now) throw started();
        if (fresh.start <= earliest) throw outsideWindow(settings.unassign_window_days);
        throw changed();
      }
      await scope.audit.record([{ shiftId: row.id, action: 'unassigned', ...employeeActor(ref), changes: changesOf(shift, row) }], now);
      await scope.outbox.addForManagers('shift_given_up', shift.id, { shift_id: shift.id, employee_ref: ref }, now);
      return row;
    });
  }

  /**
   * Saves settings; switching to Unassign cancels pending switch requests and tells their owners, in one transaction (BR-07).
   * `by` is the manager making the change, recorded on each cancelled request (DR-04); null only when no person is known.
   */
  async applySettings(next: OrgSettings, by: string | null = null): Promise<number> {
    const now = this.clock.now();
    return this.unit.run(async (scope) => {
      await scope.lockSettings();
      const previous = await scope.settings.get();
      await scope.settings.save(next, now);
      if (previous.give_up_mode !== 'switch' || next.give_up_mode !== 'unassign') return 0;
      const cancelled = await scope.shifts.clearSwitchRequests(now);
      await scope.audit.record(cancelled.map((shift) => ({ shiftId: shift.id, action: 'switch_cancelled', actor: by, actorKind: 'manager' as const })), now);
      for (const shift of cancelled) await scope.outbox.add('switch_cancelled', shift.employeeRef!, shift.id, { shift_id: shift.id }, now, now);
      return cancelled.length;
    });
  }
}

/** The caller's own published shift, read inside the transaction. */
async function ownFresh(scope: Pick<WriteScope, 'shifts'>, id: string, ref: string): Promise<ShiftRecord> {
  const shift = await scope.shifts.find(id);
  if (!shift || shift.employeeRef !== ref || shift.state !== 'published') throw notYours();
  return shift;
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
