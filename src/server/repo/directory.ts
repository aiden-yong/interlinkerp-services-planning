import { and, eq, inArray, isNotNull, max, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { employeeDirectory } from '../db/schema';

export interface DirectoryRow {
  employeeRef: string;
  displayName: string;
  photoUrl: string | null;
  departmentId: string | null;
  departmentName: string | null;
  status: string;
  email: string | null;
}

const COLUMNS = {
  employeeRef: employeeDirectory.employeeRef,
  displayName: employeeDirectory.displayName,
  photoUrl: employeeDirectory.photoUrl,
  departmentId: employeeDirectory.departmentId,
  departmentName: employeeDirectory.departmentName,
  status: employeeDirectory.status,
  email: employeeDirectory.email,
};

/** DR-02: display fields plus the work email (used only to address notification emails), at most 24 hours old. */
export class DirectoryRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  /** Makes the cache exactly `rows`: changed people are updated in place and people who left are removed (backlog item 24). */
  async replaceAll(rows: DirectoryRow[], fetchedAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const refs = rows.map((r) => r.employeeRef);
      await tx.delete(employeeDirectory).where(and(eq(employeeDirectory.organisationId, this.org), refs.length > 0 ? notInArray(employeeDirectory.employeeRef, refs) : undefined));
      if (rows.length === 0) return;
      await tx.insert(employeeDirectory).values(rows.map((r) => ({ ...r, organisationId: this.org, fetchedAt })))
        .onConflictDoUpdate({
          target: [employeeDirectory.organisationId, employeeDirectory.employeeRef],
          set: {
            displayName: sql`excluded.display_name`, photoUrl: sql`excluded.photo_url`, departmentId: sql`excluded.department_id`,
            departmentName: sql`excluded.department_name`, status: sql`excluded.status`, email: sql`excluded.email`, fetchedAt: sql`excluded.fetched_at`,
          },
        });
    });
  }

  all(): Promise<DirectoryRow[]> {
    return this.db.select(COLUMNS).from(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org)).orderBy(employeeDirectory.displayName);
  }

  /** Every employee_ref, for callers that need no other column. */
  async refs(): Promise<string[]> {
    const rows = await this.db.select({ ref: employeeDirectory.employeeRef }).from(employeeDirectory)
      .where(eq(employeeDirectory.organisationId, this.org)).orderBy(employeeDirectory.employeeRef);
    return rows.map((r) => r.ref);
  }

  async find(ref: string): Promise<DirectoryRow | null> {
    const [row] = await this.db.select(COLUMNS).from(employeeDirectory)
      .where(and(eq(employeeDirectory.organisationId, this.org), eq(employeeDirectory.employeeRef, ref))).limit(1);
    return row ?? null;
  }

  async isEmpty(): Promise<boolean> {
    const rows = await this.db.select({ ref: employeeDirectory.employeeRef }).from(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org)).limit(1);
    return rows.length === 0;
  }

  /** False until a directory refresh has stored at least one work email (right after the email column was added). */
  async hasAnyEmail(): Promise<boolean> {
    const rows = await this.db.select({ one: sql<number>`1` }).from(employeeDirectory)
      .where(and(eq(employeeDirectory.organisationId, this.org), isNotNull(employeeDirectory.email))).limit(1);
    return rows.length > 0;
  }

  async lastFetchedAt(): Promise<Date | null> {
    const [row] = await this.db.select({ at: max(employeeDirectory.fetchedAt) }).from(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org));
    return row?.at ?? null;
  }

  /** employee_ref -> cached work email, for addressing notification emails only (DR-02). */
  async emailsFor(refs: string[]): Promise<Map<string, string>> {
    if (refs.length === 0) return new Map();
    const rows = await this.db.select({ ref: employeeDirectory.employeeRef, email: employeeDirectory.email }).from(employeeDirectory)
      .where(and(eq(employeeDirectory.organisationId, this.org), inArray(employeeDirectory.employeeRef, refs)));
    return new Map(rows.flatMap((r) => (r.email ? [[r.ref, r.email] as [string, string]] : [])));
  }

  /** The refs among these that are still on the roster (the refresh keeps plannable statuses only). */
  async present(refs: string[]): Promise<Set<string>> {
    if (refs.length === 0) return new Set();
    const rows = await this.db.select({ ref: employeeDirectory.employeeRef }).from(employeeDirectory)
      .where(and(eq(employeeDirectory.organisationId, this.org), inArray(employeeDirectory.employeeRef, refs)));
    return new Set(rows.map((r) => r.ref));
  }

  /** email -> employee_ref, so a person's badge counts both their employee and manager notices. */
  async refsFor(emails: string[]): Promise<Map<string, string>> {
    if (emails.length === 0) return new Map();
    const rows = await this.db.select({ ref: employeeDirectory.employeeRef, email: employeeDirectory.email }).from(employeeDirectory)
      .where(and(eq(employeeDirectory.organisationId, this.org), inArray(employeeDirectory.email, emails)));
    return new Map(rows.flatMap((r) => (r.email ? [[r.email, r.ref] as [string, string]] : [])));
  }
}
