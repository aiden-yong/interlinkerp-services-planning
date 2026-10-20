import { chromium } from '@playwright/test';
import type { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../src/server/db/client';
import { employeeDirectory } from '../src/server/db/schema';
import { BASE_URL, DATABASE_URL, ORG } from './env';

/** Brings the test database to the latest migration and seeds the people the flows use. */
export default async function globalSetup(): Promise<void> {
  if (!decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1)).endsWith('_test')) {
    throw new Error('The browser tests empty every table, so TEST_DATABASE_URL must name a database ending in _test.');
  }
  const database = createDatabase(DATABASE_URL);
  try {
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await reset(database.pool, false);
    const now = new Date();
    await database.db.insert(employeeDirectory).values([
      { organisationId: ORG, employeeRef: 'E1', displayName: 'Ana Lim', status: 'Active', email: 'ana@example.com', fetchedAt: now },
      { organisationId: ORG, employeeRef: 'E2', displayName: 'Bo Tan', status: 'Active', email: 'bo@example.com', fetchedAt: now },
    ]);
  } finally {
    await database.close();
  }
  // `next dev` compiles each page and its browser code on first visit; do that now, in a real browser, so no test
  // spends its time budget waiting for a compile.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of ['/schedule', '/my']) {
      await page.goto(`${BASE_URL}${path}`);
      await page.getByRole('button', { name: 'Notifications', exact: false }).first().waitFor({ timeout: 120_000 });
    }
  } finally {
    await browser.close();
  }
}

/** Empties every application table (the migration journal lives in another schema). Between tests the seeded directory stays. */
export async function reset(pool: Pool, keepDirectory = true): Promise<void> {
  const { rows } = await pool.query<{ name: string }>("select tablename as name from pg_tables where schemaname = 'public'");
  const tables = rows.map((r) => r.name).filter((name) => !keepDirectory || name !== 'employee_directory');
  if (tables.length > 0) await pool.query(`truncate ${tables.map((name) => `"${name}"`).join(', ')} restart identity`);
}
