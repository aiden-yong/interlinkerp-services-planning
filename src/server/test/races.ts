import type { PoolClient } from 'pg';
import type { Database } from '../db/client';

/**
 * Backlog item 22: makes a race deterministic. `lock` runs in its own transaction and takes row locks (and may change
 * rows). While those locks are held, `work` starts; once `waiters` statements are blocked on a lock, the transaction
 * commits, so every racer is guaranteed to have started before the locked change becomes visible.
 */
export async function whileLocked<T>(database: Database, lock: (client: PoolClient) => Promise<void>, work: () => Promise<T>, waiters: number): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await lock(client);
    const running = work();
    running.catch(() => {}); // awaited below; avoid an unhandled rejection while we wait
    await blockedOnLocks(database, waiters);
    await client.query('commit');
    return await running;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function blockedOnLocks(database: Database, waiters: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await database.pool.query<{ n: string }>(
      "select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    );
    if (Number(rows[0]?.n ?? 0) >= waiters) return;
    if (Date.now() > deadline) throw new Error(`Expected ${waiters} statements waiting on a lock; saw ${rows[0]?.n}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
