const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgreSQL rejects a malformed uuid with an error, so repositories check first and treat it as "not found". */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** PostgreSQL unique_violation (23505), however Drizzle wrapped it. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
