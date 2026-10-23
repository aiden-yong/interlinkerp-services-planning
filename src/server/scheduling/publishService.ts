import { Input } from '../http/input';
import { managerActor } from '../repo/audit';
import type { DirectoryRepository } from '../repo/directory';
import type { Clock } from '../support/clock';
import type { UnitOfWork } from './unitOfWork';

/** FR-PUB-01, FR-PUB-03, FR-NTF-01. Publishing and its notices are saved in one transaction. */
export class PublishService {
  constructor(
    private readonly unit: UnitOfWork,
    private readonly clock: Clock,
    private readonly directory: DirectoryRepository,
  ) {}

  /** `by` is the manager publishing, for the audit trail (DR-04). */
  async publish(body: Record<string, unknown>, by: string): Promise<{ published: number; employees_notified: number; open_shift_notices: number }> {
    const input = new Input(body);
    const ids = input.stringList('shift_ids', 1000, true);
    if (ids && ids.length === 0) input.error('shift_ids', 'List at least one shift.');
    const notifyOpen = input.has('notify_open_shifts') ? input.raw('notify_open_shifts') : false;
    if (typeof notifyOpen !== 'boolean') input.error('notify_open_shifts', 'Must be true or false.');
    input.check();

    const now = this.clock.now();
    // Read before the transaction, so the transaction never waits on the pool.
    const people = notifyOpen === true ? await this.directory.refs() : [];
    return this.unit.run(async (scope) => {
      const published = await scope.shifts.publish(ids!, now);
      await scope.audit.record(published.map((s) => ({ shiftId: s.id, action: 'published', ...managerActor(by) })), now);
      const byEmployee = new Map<string, string[]>();
      for (const shift of published) {
        if (!shift.employeeRef) continue;
        if (!byEmployee.has(shift.employeeRef)) byEmployee.set(shift.employeeRef, []);
        byEmployee.get(shift.employeeRef)!.push(shift.id);
      }
      for (const [ref, shiftIds] of byEmployee) await scope.outbox.add('schedule_published', ref, null, { shift_ids: shiftIds }, now, now);

      // FR-PUB-03: one notice per eligible employee, listing every open shift they may take. Three bulk reads, on this transaction.
      const open = published.filter((s) => !s.employeeRef && s.start > now);
      const eligible = notifyOpen === true ? await scope.eligibility.eligibleShifts(open, people) : new Map<string, string[]>();
      for (const [ref, shiftIds] of eligible) await scope.outbox.add('open_shifts_available', ref, null, { shift_ids: shiftIds }, now, now);
      return { published: published.length, employees_notified: byEmployee.size, open_shift_notices: eligible.size };
    });
  }
}
