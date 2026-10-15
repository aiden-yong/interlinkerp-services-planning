import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  pool: Pool;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** The pool connects lazily, so /health and pages that need no data stay cheap (performance guide §3). */
export function createDatabase(url: string): Database {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 4_000, idleTimeoutMillis: 10_000 });
  return {
    db: drizzle(pool, { schema }),
    pool,
    async ping() {
      try {
        await pool.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
