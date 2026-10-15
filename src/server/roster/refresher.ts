import type { Logger } from '../http/kernel';
import type { DirectoryRepository, DirectoryRow } from '../repo/directory';
import type { Clock } from '../support/clock';
import type { DepartmentNames, Roster } from './roster';

export const DIRECTORY_MAX_AGE_SECONDS = 86_400;
const BACKOFF_MS = 5 * 60_000;

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
    let names = new Map<string, string>();
    try {
      names = await this.departments.all();
    } catch (error) {
      this.log(`[planning-api] department names unavailable: ${(error as Error).message}`);
    }
    const rows: DirectoryRow[] = people.map((p) => ({
      employeeRef: p.ref, displayName: p.name, photoUrl: p.photoUrl, departmentId: p.departmentId,
      departmentName: p.departmentId ? names.get(p.departmentId) ?? null : null, status: p.status,
    }));
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
