import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadLocalEnv } from '../config/env';
import { createDatabase } from '../db/client';
import { testDatabaseUrl } from './databaseUrl';

/** Runs once before the integration project: brings planning_test up to the latest migration. */
export default async function setup(): Promise<void> {
  loadLocalEnv();
  const database = createDatabase(testDatabaseUrl());
  await migrate(database.db, { migrationsFolder: 'drizzle' });
  await database.close();
}
