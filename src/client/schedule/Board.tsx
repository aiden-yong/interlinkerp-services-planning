'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import type { Role, SchedulePayload, Shift, TimeSpan } from '../types';
import { applyDrag, deltaFromPixels, type DragMode, snapMinutes } from './drag';
import { assignLanes, geometry } from './layout';
import { dayLabel, type Period } from './period';
import type { Row } from './rows';
import { formatTime, toIso } from './tz';

export interface ShiftChange { start_at?: string; end_at?: string; employee_ref?: string | null }

interface BoardProps {
  data: SchedulePayload;
  rows: Row[];
  period: Period;
  onOpen?: (shift: Shift) => void;
  onCreate?: (rowRef: string | null, atIso: string) => void;
  onChange?: (shift: Shift, change: ShiftChange) => void;
}

/** Which row is under the pointer. The dragged bar is hidden for the hit test so it doesn't find itself. */
function rowRefAt(bar: HTMLElement, x: number, y: number): string | null | undefined {
  bar.style.visibility = 'hidden';
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row-ref]');
  bar.style.visibility = '';
  if (!row) return undefined;
  return row.dataset.rowRef === 'open' ? null : row.dataset.rowRef;
}

export function Board({ data, rows, period, onOpen, onCreate, onChange }: BoardProps) {
  const { from_at: from, to_at: to, timezone: zone } = data.period;
  const periodMs = Date.parse(to) - Date.parse(from);
  const roles = new Map(data.roles.map((r) => [r.id, r]));
  const columns = period.scale === 'day'
    ? Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
    : period.days.map((d) => dayLabel(d, period.scale));

  function startGesture(event: PointerEvent<HTMLDivElement>, shift: Shift) {
    if (event.button !== 0 || !onChange) return;
    event.preventDefault();
    const bar = event.currentTarget;
    const width = bar.parentElement!.getBoundingClientRect().width;
    const mode = ((event.target as HTMLElement).dataset.grip as DragMode | undefined) ?? 'move';
    const { clientX: x0, clientY: y0, pointerId } = event;
    const originalStyle = bar.getAttribute('style') ?? '';
    const left0 = bar.offsetLeft;
    const width0 = bar.offsetWidth;
    let moved = false;
    bar.setPointerCapture(pointerId);

    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      if (mode === 'move') bar.style.transform = `translate(${dx}px, ${dy}px)`;
      else if (mode === 'resize-end') bar.style.width = `${Math.max(8, width0 + dx)}px`;
      else {
        bar.style.left = `${left0 + dx}px`;
        bar.style.width = `${Math.max(8, width0 - dx)}px`;
      }
    };
    const detach = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', cancel);
    };
    const cancel = () => {
      detach();
      bar.setAttribute('style', originalStyle);
    };
    const up = (e: globalThis.PointerEvent) => {
      detach();
      bar.releasePointerCapture(pointerId);
      const targetRef = mode === 'move' && moved ? rowRefAt(bar, e.clientX, e.clientY) : undefined;
      bar.setAttribute('style', originalStyle);
      if (!moved) {
        onOpen?.(shift);
        return;
      }
      const change: ShiftChange = { ...(applyDrag(shift, mode, deltaFromPixels(e.clientX - x0, width, periodMs, snapMinutes(period.scale))) ?? {}) };
      if (targetRef !== undefined && targetRef !== shift.employee_ref) change.employee_ref = targetRef;
      if (Object.keys(change).length > 0) onChange(shift, change);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', cancel);
  }

  function clickTrack(event: MouseEvent<HTMLDivElement>, rowRef: string | null) {
    if (!onCreate || (event.target as HTMLElement).closest('[data-shift-id]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onCreate(rowRef, toIso(Date.parse(from) + ((event.clientX - rect.left) / rect.width) * periodMs));
  }

  function keyOnShift(event: KeyboardEvent<HTMLDivElement>, shift: Shift) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen?.(shift);
    }
  }

  const band = (span: TimeSpan, kind: string, label: string, key: string) => {
    const g = geometry(span.start_at, span.end_at, from, to);
    return g && <div key={key} className={`band ${kind}`} style={{ left: `${g.left}%`, width: `${g.width}%` }} title={label || undefined} />;
  };

  const bar = (shift: Shift, lane: number) => {
    const g = geometry(shift.start_at, shift.end_at, from, to);
    if (!g) return null;
    const role: Role | undefined = shift.role_id ? roles.get(shift.role_id) : undefined;
    const label = `${formatTime(shift.start_at, zone)}–${formatTime(shift.end_at, zone)}${role ? ` ${role.name}` : ''}`;
    const problems = shift.conflicts.map((c) => c.message);
    const title = [label, shift.state === 'draft' ? 'Draft, not published' : 'Published', ...problems].join('\n');
    const classes = ['shift', shift.state, problems.length && 'conflict', g.clippedStart && 'clipped-start', g.clippedEnd && 'clipped-end'].filter(Boolean).join(' ');
    return (
      <div
        key={shift.id}
        className={classes}
        data-shift-id={shift.id}
        role="button"
        tabIndex={0}
        title={title}
        aria-label={title.replace(/\n/g, '. ')}
        style={{ left: `${g.left}%`, width: `${g.width}%`, top: lane * 30 + 4, ...(role ? { '--role-color': role.color } : {}) } as CSSProperties}
        onPointerDown={(e) => startGesture(e, shift)}
        onKeyDown={(e) => keyOnShift(e, shift)}
      >
        <span className="grip start" data-grip="resize-start" />
        {problems.length > 0 && '⚠ '}
        {label}
        <span className="grip end" data-grip="resize-end" />
      </div>
    );
  };

  return (
    <div className="board" role="region" aria-label="Schedule">
      <div className="row head">
        <div className="cell label">{rows.some((r) => r.kind === 'header') ? 'Role / employee' : 'Employee'}</div>
        <div className="track cols" style={{ '--cols': columns.length } as CSSProperties}>{columns.map((c, i) => <div key={i}>{c}</div>)}</div>
        <div className="cell hours">Hours</div>
      </div>
      {rows.map((row) => {
        if (row.kind === 'header') return <div key={row.key} className="row group"><div className="cell">{row.label}</div></div>;
        const e = row.employee;
        const { lanes, count } = assignLanes(row.shifts);
        const rowRef = e ? e.employee_ref : null;
        return (
          <div key={row.key} className={`row${e && !e.flexible ? ' has-hours' : ''}`} data-row-ref={rowRef ?? 'open'}>
            <div className="cell label">
              <div className="name">
                {e?.photo_url && <img className="avatar" src={e.photo_url} alt="" />}
                {row.label}
              </div>
              <div className="meta">
                {e ? [e.department_name, e.flexible ? 'Flexible hours' : '', e.on_roster ? '' : 'Not on the roster'].filter(Boolean).join(' · ') : `${row.shifts.length} in view`}
              </div>
            </div>
            <div className="track" data-track style={{ '--cols': columns.length, '--lanes': count } as CSSProperties} onClick={(ev) => clickTrack(ev, rowRef)}>
              {e && !e.flexible && e.working_intervals.map((i, n) => band(i, 'work', '', `w${n}`))}
              {e?.unavailable.map((u, n) => band(u, `away ${u.kind}`, u.label, `u${n}`))}
              {row.shifts.map((s) => bar(s, lanes.get(s.id) ?? 0))}
            </div>
            <div className="cell hours">
              {e && (
                <>
                  {e.allocated_hours.toFixed(1)} / {e.available_hours === null ? 'flexible' : e.available_hours.toFixed(1)} h
                  {e.over_allocated_days.length > 0 && (
                    <span className="over" title={`Over-allocated on ${e.over_allocated_days.join(', ')}`}>
                      ⚠ {e.over_allocated_days.length} day{e.over_allocated_days.length > 1 ? 's' : ''} over
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
