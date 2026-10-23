import type { ShiftFacts } from '../domain/allocation';
import { type Candidate, type OpenDraft, planAutoAssignments, REASON_TEXT, type UnfilledReason } from '../domain/autoPlan';
import { HttpError } from '../http/errors';
import { ConflictContext } from './conflictContext';
import { managerActor } from '../repo/audit';
import { factsOf } from '../repo/shifts';
import type { ReportService } from '../reports/reportService';
import type { UnitOfWork } from './unitOfWork';

export interface AutoPlanReport {
  filled: { shift_id: string; employee_ref: string }[];
  unfilled: { shift_id: string; reason_code: UnfilledReason; reason: string }[];
  skipped_published: string[];
  skipped_changed: string[];
}

const MARGIN_MS = 7 * 86_400_000; // the longest possible shift, as the schedule reads it

/** FR-AUT-01/02 (D8, D12-D14): fills the draft open shifts of a period and says what it could not fill and why. */
export class AutoPlanService {
  constructor(private readonly reports: ReportService, private readonly unit: UnitOfWork) {}

  /** `by` is the manager running it, for the audit trail. Assigned shifts stay drafts; nothing is sent (FR-AUT-01 AC1). */
  async run(from: string, to: string, viewZone: string | undefined, by: string, now: Date): Promise<AutoPlanReport> {
    // Read through the pool before the transaction: profiles, directory, time off and holidays.
    const { period, employees } = await this.reports.load(from, to, viewZone);

    return this.unit.run(async (scope) => {
      if (!(await scope.tryLockAutoPlan())) throw HttpError.conflict('AUTO_PLAN_RUNNING', 'Auto Plan is already running for this organisation. Try again in a moment.');

      // Take every candidate's employee lock, the one claims and take-overs hold while they check eligibility and write.
      // Those take a single employee lock each, so taking ours in sorted order cannot deadlock with them.
      // Manager shift and time-off writes take the same lock (see the lock order in unitOfWork.ts).
      await scope.lockEmployees(employees.filter((e) => e.onRoster).map((e) => e.ref));

      // Shifts and time off are re-read only now, with every candidate's lock held. No other Auto Plan run, claim,
      // take-over, manager shift write or time-off write can give a candidate a shift or time off between this read and
      // the commit (they wait for the lock), so none can create a conflict with what we assign; one that committed before
      // we took the lock is seen here. Unassigns only take shifts away. Not locked out: profile changes (working hours,
      // roles) and holidays made after the load above; the schedule shows any conflict that results.
      const wideFrom = new Date(period.from - MARGIN_MS);
      const wideTo = new Date(period.to + MARGIN_MS);
      const timeOff = await scope.timeOff.between(wideFrom, wideTo);
      const rows = await scope.shifts.overlapping(wideFrom, wideTo);
      const notStartedOpenInPeriod = rows.filter((s) => s.employeeRef === null && s.start > now && s.start.getTime() >= period.from && s.start.getTime() < period.to);
      const open: OpenDraft[] = notStartedOpenInPeriod.filter((s) => s.state === 'draft')
        .map((s) => ({ id: s.id, roleId: s.roleId, start: s.start, end: s.end, breakMinutes: s.breakMinutes, percent: s.percent, version: s.version }));
      const skippedPublished = notStartedOpenInPeriod.filter((s) => s.state === 'published').map((s) => s.id);

      const existing = new Map<string, ShiftFacts[]>();
      for (const s of rows) if (s.employeeRef) existing.set(s.employeeRef, [...(existing.get(s.employeeRef) ?? []), factsOf(s)]);
      const people: Candidate[] = employees.map((e) => ({
        ...e,
        // Time off from the fresh read replaces what the load saw; holidays (and any other kind) are kept as loaded.
        away: [...e.away.filter((span) => span.kind !== 'time_off'), ...ConflictContext.spans(timeOff.filter((t) => t.employeeRef === e.ref), [], e.zone)],
        existing: existing.get(e.ref) ?? [],
      }));

      const plan = planAutoAssignments(open, people, period);
      const byId = new Map(rows.map((s) => [s.id, s]));
      const report: AutoPlanReport = {
        filled: [],
        unfilled: plan.unfilled.map((u) => ({ shift_id: u.shiftId, reason_code: u.reason, reason: REASON_TEXT[u.reason] })),
        skipped_published: skippedPublished,
        skipped_changed: [],
      };
      for (const a of plan.assignments) {
        const shift = byId.get(a.shiftId)!;
        // eslint-disable-next-line no-await-in-loop -- one conditional update per shift, in order, on the transaction's connection
        const saved = await scope.shifts.assign(shift.id, a.employeeRef, shift.version, shift.recurrenceId !== null, now);
        if (saved) report.filled.push({ shift_id: shift.id, employee_ref: a.employeeRef });
        else report.skipped_changed.push(shift.id);
      }
      await scope.audit.record(report.filled.map((f) => ({
        shiftId: f.shift_id, action: 'auto_planned', ...managerActor(by), changes: { employee_ref: [null, f.employee_ref] },
      })), now);
      return report;
    });
  }
}
