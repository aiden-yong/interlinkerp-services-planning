import { randomUUID } from 'node:crypto';
import { actorId, type Principal } from '../auth/principal';
import type { Conflict } from '../domain/conflicts';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import type { DirectoryRepository } from '../repo/directory';
import type { Outbox } from '../repo/outbox';
import type { ProfileRepository } from '../repo/profiles';
import type { RoleRepository } from '../repo/roles';
import type { ShiftRecord, ShiftRepository } from '../repo/shifts';
import type { Clock } from '../support/clock';
import type { ConflictContext } from './conflictContext';

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
    private readonly clock: Clock,
  ) {}

  async create(body: Record<string, unknown>, by: Principal): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const input = new Input(body);
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
    validateTimes(input, start, end, breakMinutes);
    input.check();

    const now = this.clock.now();
    const draft: ShiftRecord = {
      id: randomUUID(), employeeRef, roleId, start: start!, end: end!, breakMinutes, percent, note, state: 'draft', publishedAt: null,
      ackBy: null, ackAt: null, version: 1, createdBy: actorId(by), deletedAt: null,
    };
    const { shift, conflicts } = await this.guardConflicts(draft, acknowledged, by, now);
    await this.shifts.insert(shift, now);
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
    if (!(await this.shifts.update(shift, current.version, now))) throw stale();
    const saved = (await this.shifts.find(id))!;
    if (current.state === 'published') await this.notifyChange(current, saved, now); // BR-11: stays published; employees are told
    return { shift: saved, conflicts };
  }

  private async guardConflicts(shift: ShiftRecord, acknowledged: boolean, by: Principal, now: Date): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const conflicts = await this.context.conflictsFor(shift);
    if (conflicts.length === 0) return { shift: { ...shift, ackBy: null, ackAt: null }, conflicts };
    if (!acknowledged) {
      throw HttpError.conflict('SHIFT_CONFLICT', 'This shift breaks a planning rule. Send acknowledge_conflicts: true to save it anyway.', { conflicts });
    }
    return { shift: { ...shift, ackBy: actorId(by), ackAt: now }, conflicts };
  }

  private async notifyChange(before: ShiftRecord, after: ShiftRecord, now: Date): Promise<void> {
    const changed = NOTIFY_FIELDS.filter(([field]) => !same(before[field], after[field])).map(([, label]) => label);
    if (changed.length === 0) return;
    if (before.employeeRef !== after.employeeRef) {
      if (before.employeeRef) await this.outbox.add('shift_unassigned', before.employeeRef, after.id, { shift_id: after.id }, now, now);
      if (after.employeeRef) await this.outbox.add('shift_assigned', after.employeeRef, after.id, { shift_id: after.id }, now, now);
      return;
    }
    if (after.employeeRef) await this.outbox.add('shift_changed', after.employeeRef, after.id, { shift_id: after.id, changed }, now, now);
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
