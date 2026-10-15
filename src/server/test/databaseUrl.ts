/** Kept free of Vitest imports so globalSetup can use it (Vitest forbids importing 'vitest' there). */
export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgres://planning:planning-dev-only@localhost:5432/planning_test';
}
