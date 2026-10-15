import type { Logger } from '../http/kernel';
import type { DirectoryRepository, DirectoryRow } from '../repo/directory';
import type { Clock } from '../support/clock';
import type { DepartmentNames, Roster, RosterPerson } from './roster';

export const DIRECTORY_MAX_AGE_SECONDS = 86_400;
const BACKOFF_MS = 5 * 60_000;

/** Column limits from the employee_directory table. */
const LIMITS = { ref: 64, departmentId: 64, status: 32, displayName: 200, departmentName: 160, photoUrl: 500 };

/**
 * Turns roster people into directory rows that fit the table. Over-long names
 * are cut, over-long photo URLs dropped, duplicate refs collapsed (first wins),
 * and rows with an over-long ref, department id or status are skipped.
 */
export function toDirectoryRows(people: RosterPerson[], names: Map<string, string>): { rows: DirectoryRow[]; skipped: number } {
  const seen = new Set<string>();
  const rows: DirectoryRow[] = [];
  let skipped = 0;
  for (const p of people) {
    if (seen.has(p.ref)) continue;
    seen.add(p.ref);
    if (p.ref.length > LIMITS.ref || (p.departmentId?.length ?? 0) > LIMITS.departmentId || p.status.length > LIMITS.status) {
      skipped++;
      continue;
    }
    const departmentName = p.departmentId ? names.get(p.departmentId) ?? null : null;
    rows.push({
      employeeRef: p.ref,
      displayName: p.name.slice(0, LIMITS.displayName),
      photoUrl: p.photoUrl && p.photoUrl.length <= LIMITS.photoUrl ? p.photoUrl : null,
      departmentId: p.departmentId,
      departmentName: departmentName === null ? null : departmentName.slice(0, LIMITS.departmentName),
      status: p.status,
    });
  }
  return { rows, skipped };
}

/**
 * Keeps employee_directory fresh (DR-02). Never throws: when the roster or
 * department service is down, the old cache stays and planning goes on (NFR-06).
 */
export class DirectoryRefresher {
  private lastFailureAt = 0;

  constructor(
    private readonly roster: Roster,
    private readonly departments: DepartmentNames,
    private readonly directory: DirectoryRepository,
    private readonly clock: Clock,
    private readonly log: Logger,
  ) {}

  async refresh(): Promise<boolean> {
    let people;
    try {
      people = await this.roster.listPlannable();
    } catch (error) {
      this.log(`[planning-api] roster refresh failed: ${(error as Error).message}`);
      return false;
    }
    try {
      // An empty answer while the cache has people is more likely an outage than a real empty roster.
      if (people.length === 0 && !(await this.directory.isEmpty())) {
        this.log('[planning-api] roster returned no plannable people; keeping the existing directory cache.');
        return false;
      }
    } catch (error) {
      this.log(`[planning-api] directory read failed: ${(error as Error).message}`);
      return false;
    }
    let names = new Map<string, string>();
    try {
      names = await this.departments.all();
    } catch (error) {
      this.log(`[planning-api] department names unavailable: ${(error as Error).message}`);
    }
    const { rows, skipped } = toDirectoryRows(people, names);
    if (skipped > 0) this.log(`[planning-api] skipped ${skipped} directory row(s) with over-long or invalid fields.`);
    try {
      await this.directory.replaceAll(rows, this.clock.now());
      return true;
    } catch (error) {
      this.log(`[planning-api] directory write failed: ${(error as Error).message}`);
      return false;
    }
  }

  /** First-use bootstrap. After a failure, waits 5 minutes before trying again so pages stay fast. */
  async refreshIfEmpty(): Promise<boolean> {
    try {
      if (!(await this.directory.isEmpty())) return false;
    } catch {
      return false;
    }
    const now = this.clock.now().getTime();
    if (now - this.lastFailureAt < BACKOFF_MS) return false;
    const ok = await this.refresh();
    this.lastFailureAt = ok ? 0 : now;
    return ok;
  }
}
