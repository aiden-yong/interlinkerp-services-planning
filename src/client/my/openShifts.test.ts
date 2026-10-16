import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import type { MyShift } from '../types';
import { giveUpAction, problemText, shiftLabel } from './openShifts';

const now = new Date('2026-10-13T02:00:00Z');
const shift = (start: string, switchRequested = false): MyShift =>
  ({ id: 's', role_id: null, start_at: start, end_at: '2026-10-30T09:00:00Z', break_minutes: 0, allocated_hours: 8, note: null, switch_requested: switchRequested });

describe('giveUpAction', () => {
  it('offers switch or cancel in Switch mode', () => {
    expect(giveUpAction(shift('2026-10-14T01:00:00Z'), { mode: 'switch', window_days: 2 }, now)).toEqual({ kind: 'switch' });
    expect(giveUpAction(shift('2026-10-14T01:00:00Z', true), { mode: 'switch', window_days: 2 }, now)).toEqual({ kind: 'cancel-switch' });
  });

  it('offers unassign only outside the window (BR-06)', () => {
    expect(giveUpAction(shift('2026-10-14T01:00:00Z'), { mode: 'unassign', window_days: 2 }, now))
      .toEqual({ kind: 'none', reason: 'Can only be given up more than 2 days ahead.' });
    expect(giveUpAction(shift('2026-10-16T01:00:00Z'), { mode: 'unassign', window_days: 2 }, now)).toEqual({ kind: 'unassign' });
  });

  it('offers nothing once a shift has started (FR-OPN-05)', () => {
    expect(giveUpAction(shift('2026-10-13T01:00:00Z'), { mode: 'switch', window_days: 2 }, now)).toEqual({ kind: 'none', reason: 'Already started.' });
  });
});

describe('problemText', () => {
  it('adds eligibility reasons to the message', () => {
    const error = new ApiError(409, 'NOT_ELIGIBLE', 'You cannot take this shift.', { reasons: [{ rule: 'overlap', message: 'Overlaps other shifts.' }] }, null);
    expect(problemText(error)).toBe('You cannot take this shift. Overlaps other shifts.');
    expect(problemText(new TypeError('Failed to fetch'))).toBe('Something went wrong. Please try again.');
  });
});

describe('shiftLabel', () => {
  it('names the weekday, date and local time range', () => {
    const s = { ...shift('2026-10-14T01:00:00Z'), end_at: '2026-10-14T09:00:00Z' };
    expect(shiftLabel(s, 'Asia/Kuala_Lumpur')).toBe('Wed 14 Oct 09:00-17:00');
  });
});
