'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, query } from '../api';
import type { Me, SchedulePayload } from '../types';
import { Board } from './Board';
import { periodFor, periodLabel, type Scale, step } from './period';
import { buildRows, type Filters, type GroupBy, NO_FILTERS } from './rows';
import { todayIn } from './tz';

export function SchedulePage({ me }: { me: Me }) {
  const [scale, setScale] = useState<Scale>('week');
  const [anchor, setAnchor] = useState(() => todayIn(me.organisation_timezone));
  const [groupBy, setGroupBy] = useState<GroupBy>('employee');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const period = useMemo(() => periodFor(scale, anchor), [scale, anchor]);

  const reload = useCallback(async () => {
    try {
      setData(await api<SchedulePayload>('GET', `/api/schedule${query({ from: period.from, to: period.to })}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [period.from, period.to]);
  useEffect(() => void reload(), [reload]);

  const rows = useMemo(() => (data ? buildRows(data, groupBy, filters) : []), [data, groupBy, filters]);
  const departments = useMemo(() => [...new Map((data?.employees ?? []).filter((e) => e.department_id).map((e) => [e.department_id!, e.department_name ?? e.department_id!]))], [data]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <section className="schedule">
      <div className="toolbar">
        <button type="button" aria-label="Previous period" onClick={() => setAnchor(step(scale, anchor, -1))}>‹</button>
        <button type="button" onClick={() => setAnchor(todayIn(me.organisation_timezone))}>Today</button>
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
      </div>
      {data?.directory_stale && <p className="notice">Employee names may be out of date because the roster could not be refreshed. Planning still works.</p>}
      {error && <p className="form-error">{error}</p>}
      {data ? <Board data={data} rows={rows} period={period} /> : !error && <p className="empty">Loading…</p>}
    </section>
  );
}
