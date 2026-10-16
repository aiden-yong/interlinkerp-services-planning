'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, query } from '../api';
import { dayLabel, periodFor, periodLabel, step } from '../schedule/period';
import { formatTime, todayIn } from '../schedule/tz';
import { Stepper } from '../Stepper';
import type { Me, MyShiftsPayload } from '../types';
import { groupByDay } from './days';
import { AvailableShifts } from './AvailableShifts';
import { GiveUpButton } from './GiveUpButton';
import { useOpenShifts } from './openShifts';

export function MyPlanningPage({ me }: { me: Me }) {
  const zone = me.timezone || me.organisation_timezone;
  const [anchor, setAnchor] = useState(() => todayIn(zone));
  const [data, setData] = useState<MyShiftsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const week = useMemo(() => periodFor('week', anchor), [anchor]);
  const openShifts = useOpenShifts(week.from, week.to);

  const loadShifts = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      const payload = await api<MyShiftsPayload>('GET', `/api/my/shifts${query({ from: week.from, to: week.to })}`);
      if (!isCurrent()) return;
      setData(payload);
      setError(null);
    } catch (e) {
      if (isCurrent()) setError(e instanceof ApiError ? e.message : 'Could not load your shifts. Please try again.');
    }
  }, [week.from, week.to]);

  useEffect(() => {
    let current = true;
    void loadShifts(() => current);
    return () => {
      current = false;
    };
  }, [loadShifts]);

  // Both loaders swallow their own failures, so one failing never blocks the other.
  const reloadAll = async () => {
    await Promise.all([openShifts.reload(), loadShifts()]);
  };

  const roles = new Map((data?.roles ?? []).map((r) => [r.id, r]));
  const today = todayIn(zone);

  return (
    <section className="my">
      <div className="toolbar">
        <Stepper unit="week" nowLabel="This week" onStep={(d) => setAnchor(step('week', anchor, d))} onNow={() => setAnchor(todayIn(zone))} />
        <h1 className="period">{periodLabel(week)}</h1>
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
                      {s.switch_requested && <div className="switch-flag">Up for switch</div>}
                      {openShifts.data && <GiveUpButton shift={s} giveUp={openShifts.data.give_up} zone={zone} onChanged={reloadAll} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="footnote">Times are shown in {zone}.</p>
        </>
      )}
      <AvailableShifts data={openShifts.data} onChanged={reloadAll} />
    </section>
  );
}
