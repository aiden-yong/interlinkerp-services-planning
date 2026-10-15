import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roles } from '../db/schema';
import { isUuid } from '../support/ids';

export interface Role {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

const toRole = (r: typeof roles.$inferSelect): Role => ({ id: r.id, name: r.name, color: r.color, archived: r.archivedAt !== null });

export class RoleRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async all(includeArchived = true): Promise<Role[]> {
    const where = includeArchived ? eq(roles.organisationId, this.org) : and(eq(roles.organisationId, this.org), isNull(roles.archivedAt));
    return (await this.db.select().from(roles).where(where).orderBy(roles.name)).map(toRole);
  }

  async find(id: string): Promise<Role | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(roles).where(and(eq(roles.organisationId, this.org), eq(roles.id, id))).limit(1);
    return row ? toRole(row) : null;
  }

  /** role id -> archived */
  async ids(): Promise<Map<string, boolean>> {
    return new Map((await this.all()).map((r) => [r.id, r.archived]));
  }

  async nameTaken(name: string, exceptId: string | null): Promise<boolean> {
    const conditions = [eq(roles.organisationId, this.org), sql`lower(${roles.name}) = lower(${name})`];
    if (exceptId) conditions.push(ne(roles.id, exceptId));
    return (await this.db.select({ id: roles.id }).from(roles).where(and(...conditions)).limit(1)).length > 0;
  }

  async create(name: string, color: string, now: Date): Promise<Role> {
    const [row] = await this.db.insert(roles).values({ id: randomUUID(), organisationId: this.org, name, color, createdAt: now, updatedAt: now }).returning();
    return toRole(row);
  }

  async update(id: string, fields: { name?: string; color?: string; archived?: boolean }, now: Date): Promise<Role> {
    const [row] = await this.db.update(roles).set({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.color !== undefined ? { color: fields.color } : {}),
      ...(fields.archived !== undefined ? { archivedAt: fields.archived ? sql`coalesce(${roles.archivedAt}, ${now})` : null } : {}),
      updatedAt: now,
    }).where(and(eq(roles.organisationId, this.org), eq(roles.id, id))).returning();
    return toRole(row);
  }
}
