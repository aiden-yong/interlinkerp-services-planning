import { Input } from '../http/input';
import type { Clock } from '../support/clock';
import type { UnitOfWork } from './unitOfWork';

/** FR-PUB-01, FR-NTF-01 (delivery arrives in M2). Publishing and its notices are saved in one transaction. */
export class PublishService {
  constructor(private readonly unit: UnitOfWork, private readonly clock: Clock) {}

  async publish(body: Record<string, unknown>): Promise<{ published: number; employees_notified: number }> {
    const input = new Input(body);
    const ids = input.stringList('shift_ids', 1000, true);
    if (ids && ids.length === 0) input.error('shift_ids', 'List at least one shift.');
    input.check();

    const now = this.clock.now();
    return this.unit.run(async (scope) => {
      const published = await scope.shifts.publish(ids!, now);
      const byEmployee = new Map<string, string[]>();
      for (const shift of published) {
        if (!shift.employeeRef) continue;
        if (!byEmployee.has(shift.employeeRef)) byEmployee.set(shift.employeeRef, []);
        byEmployee.get(shift.employeeRef)!.push(shift.id);
      }
      for (const [ref, shiftIds] of byEmployee) await scope.outbox.add('schedule_published', ref, null, { shift_ids: shiftIds }, now, now);
      return { published: published.length, employees_notified: byEmployee.size };
    });
  }
}
