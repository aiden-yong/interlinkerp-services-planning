import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORG, TABLES, useTestDatabase } from '../test/db';
import { auditEntries, roles, shifts } from './schema';

const database = useTestDatabase();
const now = new Date('2026-10-13T00:00:00Z');

function shift(start: string, end: string) {
  return { id: randomUUID(), organisationId: ORG, startAt: new Date(start), endAt: new Date(end), createdBy: 'test', createdAt: now, updatedAt: now };
}

/** Drizzle wraps driver errors; the PostgreSQL error code is on the error or its cause. */
async function pgErrorCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

describe('schema', () => {
  it('has every table', async () => {
    const { rows } = await database.pool.query("select table_name from information_schema.tables where table_schema = 'public'");
    expect(rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(TABLES));
  });

  it('refuses a shift that ends before it starts (CHECK constraint)', async () => {
    expect(await pgErrorCode(database.db.insert(shifts).values(shift('2026-10-13T10:00:00Z', '2026-10-13T09:00:00Z')))).toBe('23514');
  });

  it('keeps role names unique regardless of case (expression index)', async () => {
    const role = (name: string) => ({ id: randomUUID(), organisationId: ORG, name, color: '#000000', createdAt: now, updatedAt: now });
    await database.db.insert(roles).values(role('Technician'));
    expect(await pgErrorCode(database.db.insert(roles).values(role('technician')))).toBe('23505');
  });

  it('round-trips instants exactly (timestamptz)', async () => {
    await database.db.insert(shifts).values(shift('2026-10-13T01:00:00Z', '2026-10-13T09:00:00Z'));
    const [saved] = await database.db.select().from(shifts);
    expect(saved.startAt.toISOString()).toBe('2026-10-13T01:00:00.000Z');
  });

  it('back-fills history for shifts made before M4', async () => {
    const created = new Date('2026-10-01T00:00:00Z');
    const published = new Date('2026-10-02T00:00:00Z');
    const deleted = new Date('2026-10-03T00:00:00Z');
    const live = { ...shift('2026-10-13T01:00:00Z', '2026-10-13T09:00:00Z'), createdBy: 'mona@example.com', createdAt: created, state: 'published', publishedAt: published };
    const gone = { ...shift('2026-10-14T01:00:00Z', '2026-10-14T09:00:00Z'), createdBy: 'mona@example.com', createdAt: created, deletedAt: deleted, deletedBy: 'dan@example.com' };
    await database.db.insert(shifts).values([live, gone]);

    const file = readFileSync(join(process.cwd(), 'drizzle', '0005_reporting_audit_feeds.sql'), 'utf8');
    const block = file.slice(file.indexOf('-- back-fill (D18)'));
    for (const statement of block.split('--> statement-breakpoint')) await database.pool.query(statement);

    const rows = await database.db.select().from(auditEntries);
    const byShift = (id: string) => rows.filter((r) => r.shiftId === id).map((r) => [r.action, r.actor, r.actorKind, r.at.toISOString()]).sort();
    expect(byShift(live.id)).toEqual([
      ['created', 'mona@example.com', 'manager', created.toISOString()],
      ['published', null, 'system', published.toISOString()],
    ]);
    expect(byShift(gone.id)).toEqual([
      ['created', 'mona@example.com', 'manager', created.toISOString()],
      ['deleted', 'dan@example.com', 'manager', deleted.toISOString()],
    ]);
  });

  it('refuses an unknown audit action', async () => {
    const entry = { organisationId: ORG, shiftId: randomUUID(), action: 'renamed' as never, actor: 'x', actorKind: 'manager', at: now };
    expect(await pgErrorCode(database.db.insert(auditEntries).values(entry))).toBe('23514');
  });
});
