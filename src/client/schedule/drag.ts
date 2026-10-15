import type { Shift } from '../types';
import type { Scale } from './period';
import { isoToWall, toIso, wallToIso } from './tz';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export const snapMinutes = (scale: Scale) => (scale === 'day' ? 15 : scale === 'week' ? 30 : 24 * 60);

/** Pixels dragged -> milliseconds, rounded to the snap step. A deliberate drag (3px or more) always moves at least one step. */
export function deltaFromPixels(dxPx: number, widthPx: number, periodMs: number, snapMin: number): number {
  const snap = snapMin * 60_000;
  const steps = Math.round(((dxPx / widthPx) * periodMs) / snap);
  if (steps === 0 && Math.abs(dxPx) >= 3) return Math.sign(dxPx) * snap;
  return steps * snap;
}

export function applyDrag(s: Pick<Shift, 'start_at' | 'end_at'>, mode: DragMode, deltaMs: number, minMs = 15 * 60_000): { start_at: string; end_at: string } | null {
  const origStart = Date.parse(s.start_at);
  const origEnd = Date.parse(s.end_at);
  let start = origStart;
  let end = origEnd;
  if (mode === 'move') {
    start += deltaMs;
    end += deltaMs;
  } else if (mode === 'resize-start') {
    start = Math.min(start + deltaMs, end - minMs);
  } else {
    end = Math.max(end + deltaMs, start + minMs);
  }
  return start === origStart && end === origEnd ? null : { start_at: toIso(start), end_at: toIso(end) };
}

/** Day view: the clicked hour, one hour long. Week and month: 09:00–17:00 on the clicked day. */
export function newShiftTimes(scale: Scale, clickedIso: string | null, zone: string, fallbackDate: string): { start_at: string; end_at: string } {
  const wall = clickedIso ? isoToWall(clickedIso, zone) : { date: fallbackDate, time: '09:00' };
  if (scale === 'day' && clickedIso) {
    const start = wallToIso(wall.date, `${wall.time.slice(0, 2)}:00`, zone);
    return { start_at: start, end_at: toIso(Date.parse(start) + 3_600_000) };
  }
  return { start_at: wallToIso(wall.date, '09:00', zone), end_at: wallToIso(wall.date, '17:00', zone) };
}

export function publishSummary(shifts: Shift[]): { ids: string[]; employees: number; open: number } {
  const drafts = shifts.filter((s) => s.state === 'draft');
  return {
    ids: drafts.map((s) => s.id),
    employees: new Set(drafts.flatMap((s) => (s.employee_ref ? [s.employee_ref] : []))).size,
    open: drafts.filter((s) => s.employee_ref === null).length,
  };
}
