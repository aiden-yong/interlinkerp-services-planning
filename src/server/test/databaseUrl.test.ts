import { afterEach, describe, expect, it, vi } from 'vitest';
import { testDatabaseUrl } from './databaseUrl';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('testDatabaseUrl', () => {
  it('uses a database whose name ends in _test', () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgres://u:p@localhost:5432/planning_test?sslmode=disable');
    expect(testDatabaseUrl()).toBe('postgres://u:p@localhost:5432/planning_test?sslmode=disable');
  });

  it('refuses any other database, so tests never truncate real data', () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgres://u:p@localhost:5432/planning');
    expect(() => testDatabaseUrl()).toThrow(/must end with _test/);
    vi.stubEnv('TEST_DATABASE_URL', 'postgres://u:p@localhost:5432/planning_test_copy');
    expect(() => testDatabaseUrl()).toThrow(/must end with _test/);
  });
});
