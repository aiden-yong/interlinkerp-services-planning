'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, query } from '../api';
import { periodFor, periodLabel, type Scale, step } from '../schedule/period';
import { todayIn } from '../schedule/tz';
import { Segmented } from '../Segmented';
import { Stepper } from '../Stepper';
import type { Me, MyShift, MyShiftsPayload, Role } from '../types';
import { AvailableShifts } from './AvailableShifts';
import { CalendarFeed } from './CalendarFeed';
import { type CalendarEvent, chunkRange, eventsFrom, hoursByDay, scaleForKey, summarise, visibleRange } from './calendar';
import { gridDays, MiniMonth, MonthGrid, TimeGrid, YearGrid } from './CalendarViews';
import { useOpenShifts } from './openShifts';
import { ShiftDetail } from './ShiftDetail';
import './calendar.css';

const SCALES = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }] as const satisfies readonly { value: Scale; label: string }[];
const VIEW_KEY = 'interlinkerp-planning-my-view';

/** The view last used in this browser; otherwise a week, or a day on a phone, where seven columns don't fit. */
function initialScale(): Scale {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'day' || saved === 'week' || saved === 'month' || saved === 'year') return saved;
  } catch {
    // Storage blocked (private window, site data off): use the default.
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 700px)').matches ? 'day' : 'week';
}

/** My published shifts for a range. Year needs several requests, since each one covers at most 62 days. */
function useMyShifts(from: string, to: string) {
  const [state, setState] = useState<{ key: string; shifts: MyShift[]; roles: Role[]; error: string | null } | null>(null);
  const key = `${from}|${to}`;
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const pages = await Promise.all(chunkRange(from, to).map((c) => api<MyShiftsPayload>('GET', `/api/my/shifts${query({ from: c.from, to: c.to })}`)));
      if (mine !== latest.current) return;
      const byId = new Map(pages.flatMap((p) => p.shifts).map((s) => [s.id, s]));
      setState({ key, shifts: [...byId.values()], roles: pages[0]?.roles ?? [], error: null });
    } catch (e) {
      if (mine === latest.current) setState((s) => ({ key, shifts: s?.shifts ?? [], roles: s?.roles ?? [], error: e instanceof ApiError ? e.message : 'Could not load your shifts. Please try again.' }));
    }
  }, [from, to, key]);
  useEffect(() => void reload(), [reload]);
  // Another period's shifts stay on screen until this one arrives, so moving around doesn't flash an empty grid.
  return { shifts: state?.shifts ?? [], roles: state?.roles ?? [], error: state?.error ?? null, loaded: state?.key === key, reload };
}

export function MyPlanningPage({ me }: { me: Me }) {
  const zone = me.timezone || me.organisation_timezone;
  const today = todayIn(zone);
  const [scale, setScale] = useState<Scale>(initialScale);
  const [anchor, setAnchor] = useState(() => todayIn(zone));
  const [showMine, setShowMine] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const range = useMemo(() => visibleRange(scale, anchor), [scale, anchor]);
  const period = useMemo(() => periodFor(scale, anchor), [scale, anchor]);
  const { shifts, roles, error, loaded, reload } = useMyShifts(range.from, range.to);
  // A year is too long for one request and too small to show shifts on, so its list covers the anchor's month.
  const offered = scale === 'year' ? periodFor('month', anchor) : range;
  const openShifts = useOpenShifts(offered.from, offered.to);

  const roleMap = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const hours = useMemo(() => hoursByDay(shifts, zone), [shifts, zone]);
  const totals = useMemo(() => summarise(shifts, period.from, period.to, zone), [shifts, period.from, period.to, zone]);
  const allEvents = useMemo(() => eventsFrom(shifts, openShifts.data), [shifts, openShifts.data]);
  const events = useMemo(() => allEvents.filter((e) => (e.kind === 'mine' ? showMine : showAvailable)), [allEvents, showMine, showAvailable]);
  const detail: CalendarEvent | null = allEvents.find((e) => e.id === selected) ?? null;

  const chooseScale = useCallback((next: Scale) => {
    setScale(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The view still changes; it just won't be remembered.
    }
  }, []);
  const openDay = useCallback((date: string) => {
    setAnchor(date);
    chooseScale('day');
  }, [chooseScale]);
  const openMonth = useCallback((date: string) => {
    setAnchor(date);
    chooseScale('month');
  }, [chooseScale]);

  // Both loaders swallow their own failures, so one failing never blocks the other.
  const reloadAll = async () => {
    await Promise.all([openShifts.reload(), reload()]);
  };

  // The keys Google Calendar uses. Never while typing, choosing in a control, or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target instanceof Element && e.target.closest('input, select, textarea')) || document.querySelector('[role="dialog"]')) return;
      const next = scaleForKey(e.key);
      if (next) chooseScale(next);
      else if (e.key.toLowerCase() === 't') setAnchor(todayIn(zone));
      else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'k') setAnchor((a) => step(scale, a, -1));
      else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'j') setAnchor((a) => step(scale, a, 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scale, zone, chooseScale]);

  const nothing = loaded && !error && scale !== 'year' && events.length === 0;
  const view = { events, roles: roleMap, zone, today, onOpen: (e: CalendarEvent) => setSelected(e.id) };

  return (
    <section className="my-calendar">
      <aside className="my-side">
        <MiniMonth anchor={anchor} today={today} hours={hours} onPick={(date) => (scale === 'year' ? openDay(date) : setAnchor(date))} />

        <section className="side-card side-summary" aria-label="This period">
          <div className="side-stat">
            <span>
              <span className="side-stat-label">Planned this {scale}</span>
              <span className="side-stat-note">{totals.count} published shift{totals.count === 1 ? '' : 's'}</span>
            </span>
            <strong>{totals.hours.toFixed(1)} h</strong>
          </div>
          <div className="side-show" role="group" aria-label="Show on the calendar">
            <label className="check"><input type="checkbox" checked={showMine} onChange={(e) => setShowMine(e.target.checked)} /> My shifts <i className="swatch mine" aria-hidden="true" /></label>
            <label className="check"><input type="checkbox" checked={showAvailable} onChange={(e) => setShowAvailable(e.target.checked)} /> Available shifts <i className="swatch open" aria-hidden="true" /></label>
          </div>
        </section>

        <AvailableShifts data={openShifts.data} onChanged={reloadAll} />
        <CalendarFeed />
        <details className="cal-keys">
          <summary>Keyboard shortcuts</summary>
          <dl>
            <dt><kbd>D</kbd> <kbd>W</kbd> <kbd>M</kbd> <kbd>Y</kbd></dt><dd>Change view</dd>
            <dt><kbd>T</kbd></dt><dd>Go to today</dd>
            <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous or next</dd>
          </dl>
        </details>
      </aside>

      <div className="my-main">
        <div className="toolbar">
          <Stepper unit={scale} nowLabel="Today" onStep={(d) => setAnchor(step(scale, anchor, d))} onNow={() => setAnchor(todayIn(zone))} />
          <h1 className="period">{periodLabel(period)}</h1>
          <span className="spacer" />
          <Segmented label="View" value={scale} segments={SCALES} onChange={chooseScale} />
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
        {nothing && <p className="cal-empty" role="status">No shifts to show in this {scale}.</p>}
        {(scale === 'day' || scale === 'week') && <TimeGrid {...view} days={gridDays(scale, anchor)} onPickDay={openDay} />}
        {scale === 'month' && <MonthGrid {...view} anchor={anchor} onPickDay={openDay} />}
        {scale === 'year' && <YearGrid anchor={anchor} hours={hours} today={today} onPickDay={openDay} onPickMonth={openMonth} />}
        <div className="cal-foot">
          <span>Times are in {zone}.</span>
          {roles.filter((r) => !r.archived && shifts.some((s) => s.role_id === r.id)).map((r) => <span key={r.id} className="cal-role"><i className="swatch" style={{ background: r.color }} aria-hidden="true" />{r.name}</span>)}
        </div>
      </div>

      {detail && (
        <ShiftDetail
          key={detail.id}
          event={detail}
          role={detail.shift.role_id ? roleMap.get(detail.shift.role_id) : undefined}
          zone={zone}
          giveUp={openShifts.data?.give_up ?? null}
          onClose={() => setSelected(null)}
          onChanged={reloadAll}
        />
      )}
    </section>
  );
}
