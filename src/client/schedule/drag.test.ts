import { describe, expect, it } from 'vitest';
import { applyDrag, deltaFromPixels, newShiftTimes, publishSummary, snapMinutes } from './drag';
import { shift } from './testData';

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

describe('drag maths', () => {
  it('snaps by scale and never loses a deliberate nudge', () => {
    expect([snapMinutes('day'), snapMinutes('week'), snapMinutes('month')]).toEqual([15, 30, 1440]);
    expect(deltaFromPixels(100, 700, WEEK, 30)).toBe(24 * HOUR);
    expect(deltaFromPixels(3, 700, WEEK, 30)).toBe(30 * 60_000);
    expect(deltaFromPixels(3, 7000, 24 * HOUR, 15)).toBe(15 * 60_000);
  });

  it('moves and resizes, keeping at least 15 minutes', () => {
    const s = shift();
    expect(applyDrag(s, 'move', 2 * HOUR)).toEqual({ start_at: '2026-10-14T03:00:00Z', end_at: '2026-10-14T11:00:00Z' });
    expect(applyDrag(s, 'resize-end', -HOUR)).toEqual({ start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T08:00:00Z' });
    expect(applyDrag(s, 'resize-start', 20 * HOUR)).toEqual({ start_at: '2026-10-14T08:45:00Z', end_at: '2026-10-14T09:00:00Z' });
    expect(applyDrag(s, 'move', 0)).toBeNull();
  });

  it('suggests times for a new shift', () => {
    const tz = 'Asia/Kuala_Lumpur';
    expect(newShiftTimes('week', '2026-10-14T05:30:00Z', tz, '2026-10-12')).toEqual({ start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z' });
    expect(newShiftTimes('day', '2026-10-14T05:30:00Z', tz, '2026-10-14')).toEqual({ start_at: '2026-10-14T05:00:00Z', end_at: '2026-10-14T06:00:00Z' });
    expect(newShiftTimes('week', null, tz, '2026-10-12')).toEqual({ start_at: '2026-10-12T01:00:00Z', end_at: '2026-10-12T09:00:00Z' });
  });

  it('summarises what publishing will do', () => {
    const summary = publishSummary([
      shift({ id: 'a' }), shift({ id: 'b' }), shift({ id: 'c', employee_ref: 'E2' }), shift({ id: 'd', employee_ref: null }), shift({ id: 'e', state: 'published' }),
    ]);
    expect(summary).toEqual({ ids: ['a', 'b', 'c', 'd'], employees: 2, open: 1 });
  });
});
