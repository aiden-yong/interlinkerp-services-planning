import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import type { MyShift } from '../types';
import type { OpenShiftsPayload } from '../types';
import { giveUpAction, problemText, shiftLabel, useOpenShifts } from './openShifts';

const now = new Date('2026-10-13T02:00:00Z');
const shift = (start: string, switchRequested = false): MyShift =>
  ({ id: 's', role_id: null, start_at: start, end_at: '2026-10-30T09:00:00Z', break_minutes: 0, allocated_hours: 8, note: null, switch_requested: switchRequested });

afterEach(() => vi.unstubAllGlobals());

describe('giveUpAction', () => {
  it('treats exactly now + window as inside, one second later as outside', () => {
    const edge = new Date(now.getTime() + 2 * 86_400_000);
    expect(giveUpAction(shift(edge.toISOString()), { mode: 'unassign', window_days: 2 }, now).kind).toBe('none');
    expect(giveUpAction(shift(new Date(edge.getTime() + 1000).toISOString()), { mode: 'unassign', window_days: 2 }, now)).toEqual({ kind: 'unassign' });
  });

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

describe('useOpenShifts', () => {
  const payload = (from: string, to: string, timezone = 'UTC'): OpenShiftsPayload => ({ timezone, from, to, give_up: { mode: 'switch', window_days: 2 }, roles: [], open: [], up_for_switch: [] });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('keeps the latest response when an earlier one resolves last', async () => {
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve))));
    const { result } = renderHook(() => useOpenShifts('2026-10-12', '2026-10-18'));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    let second!: Promise<void>;
    act(() => { second = result.current.reload(); });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => { resolvers[1](json(payload('2026-10-12', '2026-10-18'))); await second; });
    await act(async () => { resolvers[0](json(payload('2026-10-12', '2026-10-18', 'STALE'))); await Promise.resolve(); });
    expect(result.current.data?.timezone).toBe('UTC');
  });

  it('hides data from another week and reloads the current one', async () => {
    const fetchMock = vi.fn(async (url: string) => json(url.includes('2026-10-19') ? payload('2026-10-19', '2026-10-25') : payload('2026-10-12', '2026-10-18')));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ f, t }) => useOpenShifts(f, t), { initialProps: { f: '2026-10-12', t: '2026-10-18' } });
    await waitFor(() => expect(result.current.data?.from).toBe('2026-10-12'));
    rerender({ f: '2026-10-19', t: '2026-10-25' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.from).toBe('2026-10-19'));
    await act(async () => { await result.current.reload(); });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('2026-10-19');
  });
});
