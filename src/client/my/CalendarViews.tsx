'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { periodFor, step, weekdayOf } from '../schedule/period';
import { formatTime, toIso } from '../schedule/tz';
import type { Role } from '../types';
import { type CalendarEvent, eventsStartingOn, firstVisibleHour, monthGrid, placeOnDay } from './calendar';
import { shiftLabel } from './openShifts';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** How many chips a month cell shows before "+N more". */
const MONTH_CHIPS = 3;

const dayNumber = (date: string) => Number(date.slice(8));
const monthOf = (date: string) => date.slice(0, 7);
const roleStyle = (role: Role | undefined) => (role ? ({ '--role-color': role.color } as CSSProperties) : undefined);

function eventLabel(event: CalendarEvent, zone: string): string {
  const when = shiftLabel(event.shift, zone);
  if (event.kind === 'open') return `Open shift ${when}`;
  if (event.kind === 'switch') return `Cover wanted ${when}, for ${event.ownerName}`;
  return `My shift ${when}${event.shift.switch_requested ? ', up for switch' : ''}`;
}

const eventClass = (event: CalendarEvent) => `cal-event ${event.kind}${event.shift.switch_requested ? ' asking' : ''}`;

interface ViewProps {
  events: CalendarEvent[];
  roles: Map<string, Role>;
  zone: string;
  today: string;
  onOpen: (event: CalendarEvent) => void;
}

function eventTitle(event: CalendarEvent, roles: Map<string, Role>): string {
  const role = event.shift.role_id ? roles.get(event.shift.role_id) : undefined;
  if (event.kind === 'open') return `Open: ${role?.name ?? 'Shift'}`;
  if (event.kind === 'switch') return `Cover: ${role?.name ?? 'Shift'}`;
  return role?.name ?? 'Shift';
}

/** Day and Week: a scrolling 24-hour grid, one column per day, opening on the hours that matter. */
export function TimeGrid({ days, events, roles, zone, today, onOpen, onPickDay }: ViewProps & { days: string[]; onPickDay: (date: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Only when the days change: scrolling back after every reload would fight the person reading.
  const opening = firstVisibleHour(events, days, zone);
  const scrolledFor = useRef('');
  const key = days.join();
  useEffect(() => {
    const el = scroller.current;
    if (!el || scrolledFor.current === key || el.scrollHeight === 0) return;
    if (events.length === 0 && scrolledFor.current !== '') return;
    scrolledFor.current = key;
    el.scrollTop = (el.scrollHeight / 24) * opening;
  }, [key, opening, events.length]);

  const nowLine = useMemo(() => {
    const local = new Date(now);
    const time = formatTime(toIso(local.getTime()), zone);
    return (Number(time.slice(0, 2)) + Number(time.slice(3)) / 60) / 24 * 100;
  }, [now, zone]);

  return (
    <div className={`cal-grid cols-${days.length}`} ref={scroller} role="group" aria-label="Calendar">
      <div className="cal-grid-head">
        <div className="cal-gutter" />
        {days.map((date) => (
          <div key={date} className={`cal-col-head${date === today ? ' today' : ''}`}>
            <button type="button" aria-label={`Open ${weekdayOf(date)} ${dayNumber(date)} in the day view`} aria-current={date === today ? 'date' : undefined} onClick={() => onPickDay(date)}>
              <span className="weekday">{weekdayOf(date)}</span>
              <span className="num">{dayNumber(date)}</span>
            </button>
          </div>
        ))}
      </div>
      <div className="cal-grid-body">
        <div className="cal-gutter">
          {HOURS.map((h) => <div key={h} className="cal-hour"><span>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</span></div>)}
        </div>
        {days.map((date) => (
          <div key={date} className={`cal-col${date === today ? ' today' : ''}`}>
            {HOURS.map((h) => <div key={h} className="cal-slot" />)}
            {date === today && <div className="cal-now" style={{ top: `${nowLine}%` }} aria-hidden="true" />}
            {placeOnDay(events, date, zone).map((p) => {
              const role = p.event.shift.role_id ? roles.get(p.event.shift.role_id) : undefined;
              const width = 100 / p.columns;
              return (
                <button
                  key={`${p.event.id}-${date}`}
                  type="button"
                  className={`${eventClass(p.event)}${p.continuesBefore ? ' from-before' : ''}${p.continuesAfter ? ' to-after' : ''}`}
                  aria-label={eventLabel(p.event, zone)}
                  style={{ top: `${p.top}%`, height: `${p.height}%`, left: `${p.column * width}%`, width: `${width}%`, ...roleStyle(role) }}
                  onClick={() => onOpen(p.event)}
                >
                  <span className="time">{formatTime(p.event.shift.start_at, zone)}–{formatTime(p.event.shift.end_at, zone)}</span>
                  <span className="title">{eventTitle(p.event, roles)}</span>
                  {p.event.shift.switch_requested && <span className="flag">Up for switch</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Month: whole weeks, with a chip per shift and "+N more" that opens the day. */
export function MonthGrid({ anchor, events, roles, zone, today, onOpen, onPickDay }: ViewProps & { anchor: string; onPickDay: (date: string) => void }) {
  const days = monthGrid(anchor);
  return (
    <div className="cal-month" role="group" aria-label="Calendar" style={{ '--weeks': days.length / 7 } as CSSProperties}>
      {WEEK.map((d) => <div key={d} className="cal-month-head">{d}</div>)}
      {days.map((date) => {
        const dayEvents = eventsStartingOn(events, date, zone);
        const shown = dayEvents.length > MONTH_CHIPS ? dayEvents.slice(0, MONTH_CHIPS - 1) : dayEvents;
        const hidden = dayEvents.length - shown.length;
        return (
          <div key={date} className={`cal-month-cell${monthOf(date) !== monthOf(anchor) ? ' outside' : ''}${date === today ? ' today' : ''}`}>
            <button type="button" className="num" aria-label={`Open ${weekdayOf(date)} ${dayNumber(date)} in the day view`} aria-current={date === today ? 'date' : undefined} onClick={() => onPickDay(date)}>{dayNumber(date)}</button>
            {shown.map((event) => {
              const role = event.shift.role_id ? roles.get(event.shift.role_id) : undefined;
              return (
                <button key={event.id} type="button" className={`cal-chip ${event.kind}${event.shift.switch_requested ? ' asking' : ''}`} aria-label={eventLabel(event, zone)} style={roleStyle(role)} onClick={() => onOpen(event)}>
                  <span className="time">{formatTime(event.shift.start_at, zone)}</span> {eventTitle(event, roles)}
                </button>
              );
            })}
            {hidden > 0 && <button type="button" className="cal-more" onClick={() => onPickDay(date)}>+{hidden} more</button>}
          </div>
        );
      })}
    </div>
  );
}

function MonthTitle({ anchor }: { anchor: string }) {
  return <>{MONTHS[Number(anchor.slice(5, 7)) - 1]}</>;
}

/** Year: twelve small months, shaded on the days with shifts. A day opens Day, a month's name opens Month. */
export function YearGrid({ anchor, hours, today, onPickDay, onPickMonth }: { anchor: string; hours: Map<string, number>; today: string; onPickDay: (date: string) => void; onPickMonth: (date: string) => void }) {
  const year = anchor.slice(0, 4);
  return (
    <div className="cal-year">
      {MONTHS.map((_, i) => {
        const first = `${year}-${String(i + 1).padStart(2, '0')}-01`;
        const total = [...hours].filter(([d]) => monthOf(d) === monthOf(first)).reduce((sum, [, h]) => sum + h, 0);
        return (
          <section key={first} className="cal-year-month" aria-label={MONTHS[i]}>
            <header>
              <button type="button" className="cal-year-title" onClick={() => onPickMonth(first)}><MonthTitle anchor={first} /></button>
              <span className="muted">{total > 0 ? `${total.toFixed(1)} h` : ''}</span>
            </header>
            <MiniDays anchor={first} selected={null} today={today} hours={hours} onPick={onPickDay} />
          </section>
        );
      })}
    </div>
  );
}

function MiniDays({ anchor, selected, today, hours, onPick }: { anchor: string; selected: string | null; today: string; hours: Map<string, number>; onPick: (date: string) => void }) {
  return (
    <div className="mini-days">
      {WEEK.map((d) => <span key={d} className="mini-head" aria-hidden="true">{d[0]}</span>)}
      {monthGrid(anchor).map((date) => {
        const outside = monthOf(date) !== monthOf(anchor);
        const worked = hours.get(date) ?? 0;
        const label = `${weekdayOf(date)} ${dayNumber(date)} ${MONTHS[Number(date.slice(5, 7)) - 1]}${worked > 0 ? `, ${worked.toFixed(1)} hours` : ''}`;
        return (
          <button
            key={date}
            type="button"
            className={['mini-day', outside && 'outside', date === today && 'today', date === selected && 'selected', worked > 0 && !outside && 'worked'].filter(Boolean).join(' ')}
            aria-label={label}
            aria-current={date === today ? 'date' : undefined}
            onClick={() => onPick(date)}
          >
            {dayNumber(date)}
          </button>
        );
      })}
    </div>
  );
}

/** The small month in the sidebar: jump to any date without changing the view. */
export function MiniMonth({ anchor, today, hours, onPick }: { anchor: string; today: string; hours: Map<string, number>; onPick: (date: string) => void }) {
  const [shown, setShown] = useState(anchor);
  useEffect(() => setShown(anchor), [anchor]);
  const year = shown.slice(0, 4);
  return (
    <div className="mini-month">
      <header>
        <strong><MonthTitle anchor={shown} /> {year}</strong>
        <span>
          <button type="button" className="icon-btn" aria-label="Previous month in the small calendar" onClick={() => setShown(step('month', shown, -1))}><ChevronLeftIcon /></button>
          <button type="button" className="icon-btn" aria-label="Next month in the small calendar" onClick={() => setShown(step('month', shown, 1))}><ChevronRightIcon /></button>
        </span>
      </header>
      <MiniDays anchor={shown} selected={anchor} today={today} hours={hours} onPick={onPick} />
    </div>
  );
}

/** The days a time grid shows for a view. */
export function gridDays(scale: 'day' | 'week', anchor: string): string[] {
  return scale === 'day' ? [anchor] : periodFor('week', anchor).days;
}

