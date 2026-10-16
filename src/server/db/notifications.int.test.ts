import { describe, expect, it } from 'vitest';
import { ORG, useTestDatabase } from '../test/db';
import { notifications } from './schema';

const database = useTestDatabase();
const now = new Date('2026-10-13T00:00:00Z');

function notice(overrides: Partial<typeof notifications.$inferInsert>) {
  return {
    organisationId: ORG,
    kind: 'shift.published',
    title: 'Shift published',
    body: 'Your shift is published.',
    link: '/my',
    outboxId: 1,
    createdAt: now,
    emailNextAt: now,
    recipientRef: 'E1' as string | null,
    recipientEmail: null as string | null,
    ...overrides,
  };
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

describe('notifications table', () => {
  it('accepts a notice for one employee or one manager email', async () => {
    await database.db.insert(notifications).values([notice({}), notice({ recipientRef: null, recipientEmail: 'mona@example.com', outboxId: 2 })]);
    const rows = await database.db.select().from(notifications);
    expect(rows).toHaveLength(2);
  });

  it('refuses a notice with both a ref and an email (CHECK constraint)', async () => {
    expect(await pgErrorCode(database.db.insert(notifications).values(notice({ recipientEmail: 'mona@example.com' })))).toBe('23514');
  });

  it('refuses a notice with neither a ref nor an email (CHECK constraint)', async () => {
    expect(await pgErrorCode(database.db.insert(notifications).values(notice({ recipientRef: null })))).toBe('23514');
  });

  it('refuses a second notice for the same outbox row and recipient (unique index)', async () => {
    await database.db.insert(notifications).values(notice({ outboxId: 7 }));
    expect(await pgErrorCode(database.db.insert(notifications).values(notice({ outboxId: 7 })))).toBe('23505');
  });
});
