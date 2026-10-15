import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { employeeProfiles, employeeRoles, type WorkingHoursMap } from '../db/schema';

export interface Profile {
  employeeRef: string;
  roleIds: string[];
  defaultRoleId: string | null;
  timezone: string | null;
  /** null = flexible hours */
  workingHours: WorkingHoursMap | null;
}

export const blankProfile = (employeeRef: string): Profile => ({ employeeRef, roleIds: [], defaultRoleId: null, timezone: null, workingHours: null });

/** FR-CFG-02. Planning-owned facts about an employee; the roster owns everything else. */
export class ProfileRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async find(ref: string): Promise<Profile> {
    const [row] = await this.db.select().from(employeeProfiles)
      .where(and(eq(employeeProfiles.organisationId, this.org), eq(employeeProfiles.employeeRef, ref))).limit(1);
    const roles = await this.db.select({ roleId: employeeRoles.roleId }).from(employeeRoles)
      .where(and(eq(employeeRoles.organisationId, this.org), eq(employeeRoles.employeeRef, ref))).orderBy(employeeRoles.roleId);
    return {
      ...blankProfile(ref),
      ...(row ? { defaultRoleId: row.defaultRoleId, timezone: row.timezone, workingHours: row.workingHours } : {}),
      roleIds: roles.map((r) => r.roleId),
    };
  }

  async all(): Promise<Map<string, Profile>> {
    const profiles = new Map<string, Profile>();
    for (const row of await this.db.select().from(employeeProfiles).where(eq(employeeProfiles.organisationId, this.org))) {
      profiles.set(row.employeeRef, { ...blankProfile(row.employeeRef), defaultRoleId: row.defaultRoleId, timezone: row.timezone, workingHours: row.workingHours });
    }
    for (const row of await this.db.select().from(employeeRoles).where(eq(employeeRoles.organisationId, this.org)).orderBy(employeeRoles.roleId)) {
      if (!profiles.has(row.employeeRef)) profiles.set(row.employeeRef, blankProfile(row.employeeRef));
      profiles.get(row.employeeRef)!.roleIds.push(row.roleId);
    }
    return profiles;
  }

  async save(profile: Profile, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const values = { defaultRoleId: profile.defaultRoleId, timezone: profile.timezone, workingHours: profile.workingHours, updatedAt: now };
      await tx.insert(employeeProfiles).values({ organisationId: this.org, employeeRef: profile.employeeRef, ...values })
        .onConflictDoUpdate({ target: [employeeProfiles.organisationId, employeeProfiles.employeeRef], set: values });
      await tx.delete(employeeRoles).where(and(eq(employeeRoles.organisationId, this.org), eq(employeeRoles.employeeRef, profile.employeeRef)));
      if (profile.roleIds.length > 0) {
        await tx.insert(employeeRoles).values(profile.roleIds.map((roleId) => ({ organisationId: this.org, employeeRef: profile.employeeRef, roleId })));
      }
    });
  }
}
