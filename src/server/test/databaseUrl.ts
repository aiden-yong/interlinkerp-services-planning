/** Kept free of Vitest imports so globalSetup can use it (Vitest forbids importing 'vitest' there). */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://planning:planning-dev-only@localhost:5432/planning_test';
  let name = '';
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    // Reported below.
  }
  if (!name.endsWith('_test')) {
    throw new Error(`The test database name must end with _test (got "${name}"). The tests empty every table, so point TEST_DATABASE_URL at a test database.`);
  }
  return url;
}
