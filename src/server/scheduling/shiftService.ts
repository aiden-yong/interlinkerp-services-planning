import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { actorId, type Principal } from '../auth/principal';
import type { Conflict } from '../domain/conflicts';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import type { DirectoryRepository } from '../repo/directory';
import type { Outbox } from '../repo/outbox';
import type { ProfileRepository } from '../repo/profiles';
import type { RoleRepository } from '../repo/roles';
import type { SettingsRepository } from '../repo/settings';
import type { ShiftRecord, ShiftRepository } from '../repo/shifts';
import type { Clock } from '../support/clock';
import { iso } from '../support/time';
import type { ConflictContext } from './conflictContext';
import type { RecurrenceService } from './recurrenceService';
import type { UnitOfWork, WriteScope } from './unitOfWork';

export const MAX_DURATION_MS = 7 * 86_400_000;
export const UNDO_MS = 30_000;

const NOTIFY_FIELDS: [keyof ShiftRecord, string][] = [
  ['employeeRef', 'employee'], ['roleId', 'role'], ['start', 'start'], ['end', 'end'], ['breakMinutes', 'break'], ['percent', 'allocation'], ['note', 'note'],
];
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const stale = () => HttpError.conflict('STALE_SHIFT', 'Someone else changed this shift since you loaded it. Reload and try again.');

/** FR-SHF-*, BR-01/02/11. Managers are warned about conflicts, never blocked (FR-SHF-09). */
export class ShiftService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly roles: RoleRepository,
    private readonly directory: DirectoryRepository,
    private readonly context: ConflictContext,
    private readonly outbox: Outbox,
    private readonly settings: SettingsRepository,
    private readonly clock: Clock,
    private readonly unit: UnitOfWork,
    private readonly recurrences: RecurrenceService,
  ) {}

  async create(body: Record<string, unknown>, by: Principal): Promise<{ shift: ShiftRecord; conflicts: Conflict[]; recurrence?: { id: string; created: number } }> {
    const input = new Input(body);
    if (input.has('duplicate_of')) return this.duplicate(input, by);
    const employeeRef = input.string('employee_ref', 64);
    await this.validateEmployee(input, employeeRef);
    let roleId = input.has('role_id') ? input.string('role_id', 36) : null;
    if (!input.has('role_id') && employeeRef) roleId = (await this.profiles.find(employeeRef)).defaultRoleId; // FR-SHF-01 AC2
    await this.validateRole(input, roleId);
    const start = input.instant('start_at', true);
    const end = input.instant('end_at', true);
    const breakMinutes = input.int('break_minutes', 0, 1440, 0)!;
    const percent = input.int('allocated_percent', 1, 100, 100)!;
    const note = input.string('note', 2000);
    const acknowledged = input.bool('acknowledge_conflicts');
    const repeat = input.has('repeat') ? this.recurrences.parseRepeat(input, 'repeat') : null;
    validateTimes(input, start, end, breakMinutes);
    input.check();

    const now = this.clock.now();
    const draft: ShiftRecord = {
      id: randomUUID(), employeeRef, roleId, start: start!, end: end!, breakMinutes, percent, note, state: 'draft', publishedAt: null,
      ackBy: null, ackAt: null, version: 1, createdBy: actorId(by), deletedAt: null, switchRequestedAt: null,
      recurrenceId: null, recurrenceIndex: repeat ? 0 : null, recurrenceDetached: false, copiedFrom: null,
    };

    if (repeat) {
      const zone = await this.settings.timezone();
      const horizonMonths = (await this.settings.get()).recurrence_horizon_months;
      const preview = await this.recurrences.previewConflicts(draft, repeat, zone, horizonMonths, now);
      const flagged = preview.filter((p) => p.conflicts.length > 0);
      if (flagged.length > 0 && !acknowledged) {
        throw HttpError.conflict('SHIFT_CONFLICT', 'This shift breaks a planning rule. Send acknowledge_conflicts: true to save it anyway.', {
          conflicts: preview.flatMap((p) => p.conflicts),
          occurrences: flagged.map((p) => ({ date: p.date, conflicts: p.conflicts })),
        });
      }
      const ack = flagged.length > 0 && acknowledged ? { by: actorId(by), at: now } : null;
      // Computed here, before the transaction opens, from previewConflicts's own pool-backed read — createSeries
      // must not touch ConflictContext/the pool again once scope's transaction is open (see its own doc comment).
      const conflictingDates = new Set(flagged.map((p) => p.date));
      const { shift, seriesId, created } = await this.unit.run(async (scope) => {
        const result = await this.recurrences.createSeries(scope, draft, repeat, zone, horizonMonths, ack, conflictingDates, now);
        const inserted = (await scope.shifts.find(draft.id)) ?? (() => { throw new Error('The first shift of a new series was not found right after being saved.'); })();
        return { shift: inserted, ...result };
      });
      return { shift, conflicts: preview[0]?.conflicts ?? [], recurrence: { id: seriesId, created } };
    }

    const { shift, conflicts } = await this.guardConflicts(draft, acknowledged, by, now);
    await this.unit.run(({ shifts }) => shifts.insert(shift, now));
    return { shift, conflicts };
  }

  async update(id: string, body: Record<string, unknown>, by: Principal): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const current = (await this.shifts.find(id)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    const input = new Input(body);
    const version = input.int('version', 1, Number.MAX_SAFE_INTEGER);
    if (version === null) input.error('version', 'Send the version you last loaded, so edits made by someone else are not overwritten.');

    const next: ShiftRecord = { ...current };
    if (input.has('employee_ref')) {
      next.employeeRef = input.string('employee_ref', 64);
      if (next.employeeRef !== current.employeeRef) await this.validateEmployee(input, next.employeeRef);
    }
    if (next.employeeRef !== current.employeeRef) next.switchRequestedAt = null; // a reassigned shift is no longer up for switch
    if (input.has('role_id')) {
      next.roleId = input.string('role_id', 36);
      if (next.roleId !== current.roleId) await this.validateRole(input, next.roleId);
    }
    if (input.has('start_at')) next.start = input.instant('start_at', true) ?? current.start;
    if (input.has('end_at')) next.end = input.instant('end_at', true) ?? current.end;
    if (input.has('break_minutes')) next.breakMinutes = input.int('break_minutes', 0, 1440, current.breakMinutes)!;
    if (input.has('allocated_percent')) next.percent = input.int('allocated_percent', 1, 100, current.percent)!;
    if (input.has('note')) next.note = input.string('note', 2000);
    const acknowledged = input.bool('acknowledge_conflicts');
    validateTimes(input, next.start, next.end, next.breakMinutes);
    input.check();

    if (version !== current.version) throw stale();
    const now = this.clock.now();
    const { shift, conflicts } = await this.guardConflicts(next, acknowledged, by, now);
    const saved = await this.unit.run(async (scope) => {
      const row = await scope.shifts.update(shift, current.version, now);
      if (!row) throw stale();
      if (current.state === 'published') await this.notifyChange(scope, current, row, now); // BR-11: stays published; employees are told
      return row;
    });
    return { shift: saved, conflicts };
  }

  async delete(id: string, by: Principal): Promise<void> {
    const now = this.clock.now();
    await this.unit.run(async ({ shifts, outbox }) => {
      const shift = (await shifts.softDelete(id, actorId(by), now)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
      if (shift.state === 'published' && shift.employeeRef) {
        // Sent only after the undo window, so an undone deletion never reaches the employee (FR-NTF-02).
        await outbox.add('shift_deleted', shift.employeeRef, shift.id, { shift_id: shift.id, start_at: iso(shift.start), end_at: iso(shift.end) },
          new Date(now.getTime() + UNDO_MS), now);
      }
    });
  }

  async restore(id: string, _by: Principal): Promise<ShiftRecord> {
    const shift = await this.shifts.find(id, true);
    if (!shift || !shift.deletedAt) throw HttpError.notFound('No deleted shift with that id.');
    const now = this.clock.now();
    if (now.getTime() - shift.deletedAt.getTime() >= UNDO_MS) throw HttpError.conflict('UNDO_EXPIRED', 'This deletion can no longer be undone.');
    const deletedAt = shift.deletedAt;
    return this.unit.run(async ({ shifts, outbox }) => {
      const restored = (await shifts.restore(id, deletedAt, now)) ?? (() => { throw HttpError.notFound('No deleted shift with that id.'); })();
      // Backlog item 31: a sweep may deliver the deletion notice at the same moment. cancelPending then waits for that
      // sweep's row lock and cancels nothing; undoing anyway would leave the employee told about a deletion that never
      // happened, so the whole restore is rolled back instead.
      if ((await outbox.cancelPending('shift_deleted', id, now)) === 0 && (await outbox.deliveredSince('shift_deleted', id, deletedAt))) {
        throw HttpError.conflict('UNDO_EXPIRED', 'The employee has already been told about this deletion, so it can no longer be undone.');
      }
      return restored;
    });
  }

  private async duplicate(input: Input, by: Principal): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const sourceId = input.string('duplicate_of', 36, true);
    const start = input.instant('start_at');
    const acknowledged = input.bool('acknowledge_conflicts');
    input.check();
    const source = (await this.shifts.find(sourceId!)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    let copyStart: Date;
    let copyEnd: Date;
    if (start) {
      copyStart = start;
      copyEnd = new Date(start.getTime() + (source.end.getTime() - source.start.getTime()));
    } else {
      // One day later on the organisation's wall clock, so 09:00 stays 09:00 across a DST change.
      const zone = await this.settings.timezone();
      const nextDayAt = (d: Date) => DateTime.fromJSDate(d, { zone }).plus({ days: 1 }).toJSDate();
      copyStart = nextDayAt(source.start);
      copyEnd = nextDayAt(source.end);
    }
    const now = this.clock.now();
    const copy: ShiftRecord = {
      ...source, id: randomUUID(), start: copyStart, end: copyEnd,
      state: 'draft', publishedAt: null, version: 1, createdBy: actorId(by), deletedAt: null, switchRequestedAt: null,
      recurrenceId: null, recurrenceIndex: null, recurrenceDetached: false, copiedFrom: null,
    };
    const result = await this.guardConflicts(copy, acknowledged, by, now);
    await this.unit.run(({ shifts }) => shifts.insert(result.shift, now));
    return result;
  }

  private async guardConflicts(shift: ShiftRecord, acknowledged: boolean, by: Principal, now: Date): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const conflicts = await this.context.conflictsFor(shift);
    if (conflicts.length === 0) return { shift: { ...shift, ackBy: null, ackAt: null }, conflicts };
    if (!acknowledged) {
      throw HttpError.conflict('SHIFT_CONFLICT', 'This shift breaks a planning rule. Send acknowledge_conflicts: true to save it anyway.', { conflicts });
    }
    return { shift: { ...shift, ackBy: actorId(by), ackAt: now }, conflicts };
  }

  private async notifyChange({ outbox }: WriteScope, before: ShiftRecord, after: ShiftRecord, now: Date): Promise<void> {
    const changed = NOTIFY_FIELDS.filter(([field]) => !same(before[field], after[field])).map(([, label]) => label);
    if (changed.length === 0) return;
    if (before.employeeRef !== after.employeeRef) {
      if (before.employeeRef) await outbox.add('shift_unassigned', before.employeeRef, after.id, { shift_id: after.id }, now, now);
      if (after.employeeRef) await outbox.add('shift_assigned', after.employeeRef, after.id, { shift_id: after.id }, now, now);
      return;
    }
    if (after.employeeRef) await outbox.add('shift_changed', after.employeeRef, after.id, { shift_id: after.id, changed }, now, now);
  }

  private async validateEmployee(input: Input, employeeRef: string | null): Promise<void> {
    // An empty directory means the roster could not be loaded yet; never block planning on that (NFR-06).
    if (employeeRef && !(await this.directory.isEmpty()) && !(await this.directory.find(employeeRef))) {
      input.error('employee_ref', 'Not on the employee roster.');
    }
  }

  private async validateRole(input: Input, roleId: string | null): Promise<void> {
    if (!roleId) return;
    const role = await this.roles.find(roleId);
    if (!role) input.error('role_id', 'Unknown role.');
    else if (role.archived) input.error('role_id', 'This role is archived.');
  }
}

function validateTimes(input: Input, start: Date | null, end: Date | null, breakMinutes: number): void {
  if (!start || !end) return;
  if (end <= start) {
    input.error('end_at', 'The shift must end after it starts.');
    return;
  }
  const ms = end.getTime() - start.getTime();
  if (ms > MAX_DURATION_MS) input.error('end_at', 'A shift can last at most 7 days.');
  if (breakMinutes * 60_000 >= ms) input.error('break_minutes', 'The break must be shorter than the shift.');
}
