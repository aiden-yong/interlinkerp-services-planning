'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, query } from '../api';
import { useFeedback } from '../feedback';
import { Segmented } from '../Segmented';
import { Stepper } from '../Stepper';
import type { AutoPlanReport, EmployeeProfile, Me, PlannedHoursReport, SchedulePayload, Shift, UtilisationReport } from '../types';
import { AutoPlanResult } from './AutoPlanResult';
import { Board, type ShiftChange } from './Board';
import { newShiftTimes, publishSummary } from './drag';
import { periodFor, periodLabel, type Scale, step } from './period';
import { buildRows, type Filters, type GroupBy, NO_FILTERS } from './rows';
import { ShiftDialog } from './ShiftDialog';
import { saveShift, type ShiftForm, shiftToForm, STALE_MESSAGE } from './shiftForm';
import { todayIn } from './tz';
import { YearBoard } from './YearBoard';
import { type Departments, yearRows } from './year';

const SCALES = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }] as const satisfies readonly { value: Scale; label: string }[];

interface WeekCopyReport { created: number; skipped_recurring: number; skipped_already_copied: number; skipped_off_roster: number; conflicts: number }

export function SchedulePage({ me }: { me: Me }) {
  const { confirm, toast } = useFeedback();
  const [scale, setScale] = useState<Scale>('week');
  const zone = me.timezone || me.organisation_timezone; // the viewer's own time zone (BR-10)
  const [anchor, setAnchor] = useState(() => todayIn(zone));
  const [groupBy, setGroupBy] = useState<GroupBy>('employee');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null); // the period `data` was fetched for
  const [yearData, setYearData] = useState<{ planned: PlannedHoursReport; util: UtilisationReport } | null>(null);
  const [yearDepartments, setYearDepartments] = useState<Departments>({});
  const year = scale === 'year';
  const [busy, setBusy] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ shift: Shift | null; initial: ShiftForm } | null>(null);
  const [planResult, setPlanResult] = useState<AutoPlanReport | null>(null);
  const autoPlanButton = useRef<HTMLButtonElement>(null);
  const period = useMemo(() => periodFor(scale, anchor), [scale, anchor]);
  // The board keeps showing the previous period while a new one loads; actions that need the payload wait for the right one.
  const ready = data !== null && loadedKey === `${period.from}|${period.to}`;

  const yearRole = year ? filters.roleId : ''; // the schedule filters roles itself; only Year asks the server
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      if (year) {
        // Year is a summary: month buckets from the report endpoints, not the shifts themselves (D20).
        const base = { from: period.from, to: period.to, bucket: 'month', timezone: zone };
        const [planned, util] = await Promise.all([
          api<PlannedHoursReport>('GET', `/api/reports/planned-hours${query({ ...base, role_id: yearRole || undefined, group: 'employee' })}`),
          api<UtilisationReport>('GET', `/api/reports/utilisation${query(base)}`),
        ]);
        if (request !== latest.current) return;
        setYearData({ planned, util });
        setError(null);
        return;
      }
      const payload = await api<SchedulePayload>('GET', `/api/schedule${query({ from: period.from, to: period.to, timezone: zone })}`);
      if (request !== latest.current) return;
      setData(payload);
      setLoadedKey(`${period.from}|${period.to}`);
      setError(null);
    } catch (e) {
      if (request === latest.current) setError((e as Error).message);
    }
  }, [period.from, period.to, zone, year, yearRole]);
  useEffect(() => void reload(), [reload]);

  // Utilisation rows carry no department, so Year takes it from the employee directory, as the Reports page does.
  useEffect(() => {
    if (!year) return;
    api<{ employees: EmployeeProfile[] }>('GET', '/api/employees').then((r) => {
      setYearDepartments(Object.fromEntries(r.employees.map((e) => [e.employee_ref, { id: e.department_id, name: e.department_name }])));
    }, (e: Error) => toast(`Departments could not be loaded: ${e.message}`, undefined, 6000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const rows = useMemo(() => (data ? buildRows(data, groupBy, filters) : []), [data, groupBy, filters]);
  const yearView = useMemo(() => (yearData ? yearRows(yearData.planned.rows, yearData.util.rows, filters, groupBy === 'department' ? 'department' : 'employee', yearDepartments, Number(period.from.slice(0, 4))) : []), [yearData, filters, groupBy, yearDepartments, period.from]);
  const departments = useMemo(() => {
    const people = year ? Object.values(yearDepartments) : (data?.employees ?? []).map((e) => ({ id: e.department_id, name: e.department_name }));
    return [...new Map(people.filter((e) => e.id).map((e) => [e.id!, e.name ?? e.id!]))];
  }, [data, year, yearDepartments]);
  // Role grouping has no meaning for a per-employee summary, so Year falls back to Employee.
  function changeScale(next: Scale) {
    if (next === 'year' && groupBy === 'role') setGroupBy('employee');
    setScale(next);
  }
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const report = (e: unknown) => toast(e instanceof ApiError && e.code === 'STALE_SHIFT'
    ? STALE_MESSAGE
    : (e as Error).message, undefined, 6000);

  function openNew(rowRef: string | null, atIso: string | null) {
    if (!data) return;
    const times = newShiftTimes(scale, atIso, data.period.timezone, period.from);
    const employee = data.employees.find((e) => e.employee_ref === rowRef);
    setEditing({ shift: null, initial: shiftToForm({ employee_ref: rowRef, role_id: employee?.default_role_id ?? null, ...times, break_minutes: 0, allocated_percent: 100, note: null, recurrence: null }, data.period.timezone) });
  }

  async function applyChange(shift: Shift, change: ShiftChange) {
    try {
      const saved = await saveShift('PATCH', `/api/shifts/${shift.id}`, { version: shift.version, ...change }, confirm, shift.conflicts.map((c) => c.message));
      if (saved) toast(shift.state === 'published' ? 'Shift moved. The employee will be told.' : 'Shift moved.', undefined, 4000);
    } catch (e) {
      report(e);
    }
    await reload();
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    try {
      await publishDrafts();
    } finally {
      setBusy(false);
    }
  }

  async function publishDrafts() {
    const summary = publishSummary(rows.flatMap((r) => r.shifts));
    if (summary.ids.length === 0) {
      toast('There are no draft shifts in this view.', undefined, 4000);
      return;
    }
    const lines = [
      `${summary.ids.length} draft shift${summary.ids.length === 1 ? '' : 's'} in this view will be published.`,
      `${summary.employees} employee${summary.employees === 1 ? '' : 's'} will be told about their shifts.`,
      ...(summary.open ? [`${summary.open} open shift${summary.open === 1 ? '' : 's'} will be published too.`] : []),
      ...(notifyOpen ? ['Eligible employees will also be told about open shifts.'] : []),
    ];
    if (!(await confirm('Publish shifts?', lines, 'Publish'))) return;
    try {
      const result = await api<{ published: number; open_shift_notices?: number }>('POST', '/api/publications', { shift_ids: summary.ids, notify_open_shifts: notifyOpen });
      setNotifyOpen(false); // one publish only, so a later one cannot notify by accident
      const notices = result.open_shift_notices ?? 0;
      toast(`Published ${result.published} shift${result.published === 1 ? '' : 's'}.${notices > 0 ? ` ${notices} employee${notices === 1 ? '' : 's'} told about open shifts.` : ''}`, undefined, 5000);
    } catch (e) {
      report(e);
    }
    await reload();
  }

  async function autoPlan() {
    if (busy) return;
    setBusy(true);
    let result: AutoPlanReport | null = null;
    try {
      if (!(await confirm('Fill the draft open shifts in this period?', ['Assigned shifts stay drafts until you publish.'], 'Auto Plan'))) return;
      try {
        result = await api<AutoPlanReport>('POST', '/api/auto-plans', { from: period.from, to: period.to, timezone: zone });
      } catch (e) {
        report(e); // AUTO_PLAN_RUNNING and other errors show their own message
      }
      await reload();
    } finally {
      setBusy(false);
      setPlanResult(result); // shown once the button is enabled again, so closing it can return focus there
    }
  }

  async function copyPreviousWeek() {
    if (busy) return;
    setBusy(true);
    try {
      const n = (count: number) => (count === 1 ? '' : 's');
      let dry: WeekCopyReport;
      try {
        dry = await api<WeekCopyReport>('POST', '/api/week-copies', { week_start: period.from, dry_run: true });
      } catch (e) {
        report(e);
        return;
      }
      if (dry.created === 0) {
        toast('Nothing to copy from last week.', undefined, 4000);
        return;
      }
      const lines = [
        `${dry.created} shift${n(dry.created)} will be copied as drafts.`,
        ...(dry.skipped_recurring > 0 ? [`${dry.skipped_recurring} repeated shift${n(dry.skipped_recurring)} are skipped; their series already makes them.`] : []),
        ...(dry.skipped_already_copied > 0 ? [`${dry.skipped_already_copied} were already copied.`] : []),
        ...(dry.skipped_off_roster > 0 ? [`${dry.skipped_off_roster} belong to people no longer on the roster.`] : []),
      ];
      if (!(await confirm('Copy previous week?', lines, 'Copy'))) return;
      try {
        const result = await api<WeekCopyReport>('POST', '/api/week-copies', { week_start: period.from });
        toast(`Copied ${result.created} shift${n(result.created)}.`, undefined, 5000);
      } catch (e) {
        report(e);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="schedule">
      <div className="toolbar">
        <Stepper unit="period" nowLabel="Today" onStep={(d) => setAnchor(step(scale, anchor, d))} onNow={() => setAnchor(todayIn(zone))} />
        <h1 className="period">{periodLabel(period)}</h1>
        <span className="spacer" />
        <Segmented label="Scale" value={scale} segments={SCALES} onChange={changeScale} />
        {!year && <button type="button" disabled={!ready} onClick={() => openNew(null, null)}>Add shift</button>}
        {!year && <button type="button" ref={autoPlanButton} disabled={busy || !ready} onClick={() => void autoPlan()}>Auto Plan</button>}
        {scale === 'week' && <button type="button" disabled={busy || !ready} onClick={() => void copyPreviousWeek()}>Copy previous week</button>}
        {!year && <label className="check"><input type="checkbox" checked={notifyOpen} onChange={(e) => setNotifyOpen(e.target.checked)} /> Tell eligible employees about open shifts</label>}
        {!year && <button type="button" className="primary" disabled={busy || !ready} onClick={publish}>Publish</button>}
      </div>
      <div className="filters">
        <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="employee">By employee</option><option value="role" disabled={year}>By role</option><option value="department">By department</option>
        </select>
        <select aria-label="Filter by role" value={filters.roleId} onChange={(e) => set({ roleId: e.target.value })}>
          <option value="">All roles</option>
          {data?.roles.filter((r) => !r.archived).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select aria-label="Filter by department" value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
          <option value="">All departments</option>
          {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Filter by state" value={filters.state} onChange={(e) => set({ state: e.target.value as Filters['state'] })}>
          <option value="">All shifts</option><option value="draft">Drafts</option><option value="published">Published</option><option value="open">Open shifts</option>
        </select>
        <input type="search" aria-label="Find employee" placeholder="Find employee" value={filters.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      {data?.directory_stale && <p className="notice">Employee names may be out of date because the roster could not be refreshed. Planning still works.</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {year ? (
        yearData ? <YearBoard rows={yearView} onPick={(month) => { setScale('month'); setAnchor(`${month}-01`); }} /> : !error && <p className="empty">Loading…</p>
      ) : data ? (
        <Board
          data={data}
          rows={rows}
          period={period}
          onOpen={(shift) => setEditing({ shift, initial: shiftToForm(shift, data.period.timezone) })}
          onCreate={openNew}
          onChange={applyChange}
        />
      ) : !error && <p className="empty">Loading…</p>}
      {!year && editing && data && <ShiftDialog data={data} shift={editing.shift} initial={editing.initial} onClose={() => setEditing(null)} onSaved={reload} />}
      {!year && planResult && data && <AutoPlanResult report={planResult} data={data} zone={zone} onClose={() => { setPlanResult(null); autoPlanButton.current?.focus(); }} />}
    </section>
  );
}
