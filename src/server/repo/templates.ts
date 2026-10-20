import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { shiftTemplates } from '../db/schema';
import { isUuid } from '../support/ids';

export interface Template {
  id: string;
  name: string;
  role_id: string | null;
  start_time: string;
  duration_minutes: number;
  break_minutes: number;
}

const toTemplate = (r: typeof shiftTemplates.$inferSelect): Template => ({
  id: r.id, name: r.name, role_id: r.roleId, start_time: r.startTime, duration_minutes: r.durationMinutes, break_minutes: r.breakMinutes,
});

export class TemplateRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async all(): Promise<Template[]> {
    return (await this.db.select().from(shiftTemplates).where(eq(shiftTemplates.organisationId, this.org)).orderBy(shiftTemplates.name)).map(toTemplate);
  }

  async find(id: string): Promise<Template | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(shiftTemplates).where(and(eq(shiftTemplates.organisationId, this.org), eq(shiftTemplates.id, id))).limit(1);
    return row ? toTemplate(row) : null;
  }

  async nameTaken(name: string, exceptId: string | null): Promise<boolean> {
    const conditions = [eq(shiftTemplates.organisationId, this.org), sql`lower(${shiftTemplates.name}) = lower(${name})`];
    if (exceptId) conditions.push(ne(shiftTemplates.id, exceptId));
    return (await this.db.select({ id: shiftTemplates.id }).from(shiftTemplates).where(and(...conditions)).limit(1)).length > 0;
  }

  async create(t: { name: string; role_id: string | null; start_time: string; duration_minutes: number; break_minutes: number }, now: Date): Promise<Template> {
    const [row] = await this.db.insert(shiftTemplates).values({
      id: randomUUID(), organisationId: this.org, name: t.name, roleId: t.role_id, startTime: t.start_time,
      durationMinutes: t.duration_minutes, breakMinutes: t.break_minutes, createdAt: now, updatedAt: now,
    }).returning();
    return toTemplate(row);
  }

  async update(
    id: string,
    fields: Partial<{ name: string; role_id: string | null; start_time: string; duration_minutes: number; break_minutes: number }>,
    now: Date,
  ): Promise<Template> {
    const [row] = await this.db.update(shiftTemplates).set({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.role_id !== undefined ? { roleId: fields.role_id } : {}),
      ...(fields.start_time !== undefined ? { startTime: fields.start_time } : {}),
      ...(fields.duration_minutes !== undefined ? { durationMinutes: fields.duration_minutes } : {}),
      ...(fields.break_minutes !== undefined ? { breakMinutes: fields.break_minutes } : {}),
      updatedAt: now,
    }).where(and(eq(shiftTemplates.organisationId, this.org), eq(shiftTemplates.id, id))).returning();
    return toTemplate(row);
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows = await this.db.delete(shiftTemplates).where(and(eq(shiftTemplates.organisationId, this.org), eq(shiftTemplates.id, id))).returning({ id: shiftTemplates.id });
    return rows.length === 1;
  }
}
