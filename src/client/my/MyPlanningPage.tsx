'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { ApiError, api, query } from '../api';
import { dayLabel, periodFor, periodLabel, step } from '../schedule/period';
import { formatTime, todayIn } from '../schedule/tz';
import type { Me, MyShiftsPayload } from '../types';
import { groupByDay } from './days';

export function MyPlanningPage({ me }: { me: Me }) {
  const zone = me.timezone || me.organisation_timezone;
  const [anchor, setAnchor] = useState(() => todayIn(zone));
  const [data, setData] = useState<MyShiftsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const week = useMemo(() => periodFor('week', anchor), [anchor]);

  useEffect(() => {
    let current = true;
    api<MyShiftsPayload>('GET', `/api/my/shifts${query({ from: week.from, to: week.to })}`).then(
      (payload) => {
        if (!current) return;
        setData(payload);
        setError(null);
      },
      (e: unknown) => {
        if (current) setError(e instanceof ApiError ? e.message : 'Could not load your shifts. Please try again.');
      },
    );
    return () => {
      current = false;
    };
  }, [week.from, week.to]);

  const roles = new Map((data?.roles ?? []).map((r) => [r.id, r]));
  const today = todayIn(zone);

  return (
    <section className="my">
      <div className="toolbar">
        <button type="button" aria-label="Previous week" onClick={() => setAnchor(step('week', anchor, -1))}>‹</button>
        <button type="button" onClick={() => setAnchor(todayIn(zone))}>This week</button>
        <button type="button" aria-label="Next week" onClick={() => setAnchor(step('week', anchor, 1))}>›</button>
        <span className="period">{periodLabel(week)}</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      {data && data.shifts.length === 0 && <p className="empty">No published shifts this week.</p>}
      {data && data.shifts.length > 0 && (
        <>
          <div className="week">
            {groupByDay(data.shifts, week.days, zone).map((group) => (
              <div key={group.date} className={`day${group.date === today ? ' today' : ''}${group.shifts.length ? '' : ' empty-day'}`}>
                <h3>{dayLabel(group.date, 'week')}</h3>
                {group.shifts.map((s) => {
                  const role = s.role_id ? roles.get(s.role_id) : undefined;
                  return (
                    <div key={s.id} className="card" style={role ? ({ '--role-color': role.color } as CSSProperties) : undefined}>
                      <div className="time">{formatTime(s.start_at, zone)}–{formatTime(s.end_at, zone)}</div>
                      <div className="meta">{[role?.name, `${s.allocated_hours.toFixed(1)} h`, s.break_minutes ? `${s.break_minutes} min break` : ''].filter(Boolean).join(' · ')}</div>
                      {s.note && <div className="note">{s.note}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="empty">Times are shown in {zone}.</p>
        </>
      )}
    </section>
  );
}
