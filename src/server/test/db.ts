import { afterAll, beforeEach } from 'vitest';
import { createDatabase, type Database } from '../db/client';
import { testDatabaseUrl } from './databaseUrl';

export { testDatabaseUrl };

export const ORG = 'test-org';

export const TABLES = [
  'roles', 'employee_profiles', 'employee_roles', 'shifts', 'unavailabilities', 'public_holidays',
  'organisation_settings', 'planning_managers', 'employee_directory', 'notification_outbox',
];

/** One connection pool per test file, emptied before every test. Call at the top of the file. */
export function useTestDatabase(): Database {
  const database = createDatabase(testDatabaseUrl());
  beforeEach(async () => {
    await database.pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
  });
  afterAll(async () => {
    await database.close();
  });
  return database;
}
