'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, query } from '../api';
import { useFeedback } from '../feedback';
import type { Me, SchedulePayload, Shift } from '../types';
import { Board, type ShiftChange } from './Board';
import { newShiftTimes, publishSummary } from './drag';
import { periodFor, periodLabel, type Scale, step } from './period';
import { buildRows, type Filters, type GroupBy, NO_FILTERS } from './rows';
import { ShiftDialog } from './ShiftDialog';
import { saveShift, type ShiftForm, shiftToForm, STALE_MESSAGE } from './shiftForm';
import { todayIn } from './tz';

export function SchedulePage({ me }: { me: Me }) {
  const { confirm, toast } = useFeedback();
  const [scale, setScale] = useState<Scale>('week');
  const zone = me.timezone || me.organisation_timezone; // the viewer's own time zone (BR-10)
  const [anchor, setAnchor] = useState(() => todayIn(zone));
  const [groupBy, setGroupBy] = useState<GroupBy>('employee');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ shift: Shift | null; initial: ShiftForm } | null>(null);
  const period = useMemo(() => periodFor(scale, anchor), [scale, anchor]);

  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const payload = await api<SchedulePayload>('GET', `/api/schedule${query({ from: period.from, to: period.to, timezone: zone })}`);
      if (request !== latest.current) return;
      setData(payload);
      setError(null);
    } catch (e) {
      if (request === latest.current) setError((e as Error).message);
    }
  }, [period.from, period.to, zone]);
  useEffect(() => void reload(), [reload]);

  const rows = useMemo(() => (data ? buildRows(data, groupBy, filters) : []), [data, groupBy, filters]);
  const departments = useMemo(() => [...new Map((data?.employees ?? []).filter((e) => e.department_id).map((e) => [e.department_id!, e.department_name ?? e.department_id!]))], [data]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const report = (e: unknown) => toast(e instanceof ApiError && e.code === 'STALE_SHIFT'
    ? STALE_MESSAGE
    : (e as Error).message, undefined, 6000);

  function openNew(rowRef: string | null, atIso: string | null) {
    if (!data) return;
    const times = newShiftTimes(scale, atIso, data.period.timezone, period.from);
    const employee = data.employees.find((e) => e.employee_ref === rowRef);
    setEditing({ shift: null, initial: shiftToForm({ employee_ref: rowRef, role_id: employee?.default_role_id ?? null, ...times, break_minutes: 0, allocated_percent: 100, note: null }, data.period.timezone) });
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
    ];
    if (!(await confirm('Publish shifts?', lines, 'Publish'))) return;
    try {
      const result = await api<{ published: number }>('POST', '/api/publications', { shift_ids: summary.ids });
      toast(`Published ${result.published} shift${result.published === 1 ? '' : 's'}.`, undefined, 5000);
    } catch (e) {
      report(e);
    }
    await reload();
  }

  return (
    <section className="schedule">
      <div className="toolbar">
        <button type="button" aria-label="Previous period" onClick={() => setAnchor(step(scale, anchor, -1))}>‹</button>
        <button type="button" onClick={() => setAnchor(todayIn(zone))}>Today</button>
        <button type="button" aria-label="Next period" onClick={() => setAnchor(step(scale, anchor, 1))}>›</button>
        <span className="period">{periodLabel(period)}</span>
        <select aria-label="Scale" value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
          <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
        </select>
        <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="employee">By employee</option><option value="role">By role</option>
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
        <span className="spacer" />
        <button type="button" onClick={() => openNew(null, null)}>Add shift</button>
        <button type="button" className="primary" disabled={busy} onClick={publish}>Publish</button>
      </div>
      {data?.directory_stale && <p className="notice">Employee names may be out of date because the roster could not be refreshed. Planning still works.</p>}
      {error && <p className="form-error">{error}</p>}
      {data ? (
        <Board
          data={data}
          rows={rows}
          period={period}
          onOpen={(shift) => setEditing({ shift, initial: shiftToForm(shift, data.period.timezone) })}
          onCreate={openNew}
          onChange={applyChange}
        />
      ) : !error && <p className="empty">Loading…</p>}
      {editing && data && <ShiftDialog data={data} shift={editing.shift} initial={editing.initial} onClose={() => setEditing(null)} onSaved={reload} />}
    </section>
  );
}
