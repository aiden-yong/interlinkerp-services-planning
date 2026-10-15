import { randomUUID } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { unavailabilities } from '../db/schema';
import { isUuid } from '../support/ids';
import { iso } from '../support/time';

export interface TimeOff {
  id: string;
  employeeRef: string;
  start: Date;
  end: Date;
  reason: string;
}

const toTimeOff = (r: typeof unavailabilities.$inferSelect): TimeOff => ({ id: r.id, employeeRef: r.employeeRef, start: r.startAt, end: r.endAt, reason: r.reason });

export function toApi(t: TimeOff) {
  return { id: t.id, employee_ref: t.employeeRef, start_at: iso(t.start), end_at: iso(t.end), reason: t.reason };
}

/**
 * FR-CFG-03, DR-03: personal time off stored by Planning until an HR leave
 * service exists. Everything reads time off through between(), so moving to
 * that service later means replacing this class only.
 */
export class TimeOffRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async between(from: Date, to: Date, employeeRef?: string | null): Promise<TimeOff[]> {
    const conditions = [eq(unavailabilities.organisationId, this.org), lt(unavailabilities.startAt, to), gt(unavailabilities.endAt, from)];
    if (employeeRef) conditions.push(eq(unavailabilities.employeeRef, employeeRef));
    return (await this.db.select().from(unavailabilities).where(and(...conditions)).orderBy(unavailabilities.startAt)).map(toTimeOff);
  }

  async find(id: string): Promise<TimeOff | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(unavailabilities).where(and(eq(unavailabilities.organisationId, this.org), eq(unavailabilities.id, id))).limit(1);
    return row ? toTimeOff(row) : null;
  }

  async create(employeeRef: string, start: Date, end: Date, reason: string, by: string, now: Date): Promise<TimeOff> {
    const [row] = await this.db.insert(unavailabilities)
      .values({ id: randomUUID(), organisationId: this.org, employeeRef, startAt: start, endAt: end, reason, createdBy: by, createdAt: now, updatedAt: now })
      .returning();
    return toTimeOff(row);
  }

  async update(id: string, start: Date, end: Date, reason: string, now: Date): Promise<TimeOff> {
    const [row] = await this.db.update(unavailabilities).set({ startAt: start, endAt: end, reason, updatedAt: now })
      .where(and(eq(unavailabilities.organisationId, this.org), eq(unavailabilities.id, id))).returning();
    return toTimeOff(row);
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const deleted = await this.db.delete(unavailabilities).where(and(eq(unavailabilities.organisationId, this.org), eq(unavailabilities.id, id))).returning({ id: unavailabilities.id });
    return deleted.length === 1;
  }
}
