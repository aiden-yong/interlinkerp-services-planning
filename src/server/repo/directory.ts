import { and, eq, inArray, max } from 'drizzle-orm';
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

  async replaceAll(rows: DirectoryRow[], fetchedAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org));
      if (rows.length > 0) await tx.insert(employeeDirectory).values(rows.map((r) => ({ ...r, organisationId: this.org, fetchedAt })));
    });
  }

  all(): Promise<DirectoryRow[]> {
    return this.db.select(COLUMNS).from(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org)).orderBy(employeeDirectory.displayName);
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

  /** email -> employee_ref, so a person's badge counts both their employee and manager notices. */
  async refsFor(emails: string[]): Promise<Map<string, string>> {
    if (emails.length === 0) return new Map();
    const rows = await this.db.select({ ref: employeeDirectory.employeeRef, email: employeeDirectory.email }).from(employeeDirectory)
      .where(and(eq(employeeDirectory.organisationId, this.org), inArray(employeeDirectory.email, emails)));
    return new Map(rows.flatMap((r) => (r.email ? [[r.email, r.ref] as [string, string]] : [])));
  }
}