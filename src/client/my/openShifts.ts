'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, query } from '../api';
import { formatTime, isoToWall } from '../schedule/tz';
import type { GiveUp, MyShift, OpenShiftsPayload } from '../types';

export type GiveUpAction = { kind: 'switch' } | { kind: 'cancel-switch' } | { kind: 'unassign' } | { kind: 'none'; reason: string };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 14 Oct 09:00-17:00" in the given zone: names a shift for people and for screen readers. */
export function shiftLabel(shift: MyShift, zone: string): string {
  const date = new Date(`${isoToWall(shift.start_at, zone).date}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${formatTime(shift.start_at, zone)}-${formatTime(shift.end_at, zone)}`;
}

/** Which give-up control one of my published shifts gets (FR-OPN-03..05, BR-06, BR-07). The server re-checks all of it. */
export function giveUpAction(shift: MyShift, giveUp: GiveUp, now: Date): GiveUpAction {
  const start = Date.parse(shift.start_at);
  if (start <= now.getTime()) return { kind: 'none', reason: 'Already started.' };
  if (giveUp.mode === 'switch') return shift.switch_requested ? { kind: 'cancel-switch' } : { kind: 'switch' };
  if (start <= now.getTime() + giveUp.window_days * 86_400_000) return { kind: 'none', reason: `Can only be given up more than ${giveUp.window_days} days ahead.` };
  return { kind: 'unassign' };
}

/** A refusal as one sentence, with eligibility reasons when the server sent them. Never shows raw browser errors. */
export function problemText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  const reasons = (error.details as { reasons?: { message: string }[] } | null)?.reasons ?? [];
  return [error.message, ...reasons.map((r) => r.message)].join(' ');
}

/** Loads available shifts for a date range; reload after any action. A failed load only hides the section. */
export function useOpenShifts(from: string, to: string) {
  const [data, setData] = useState<OpenShiftsPayload | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<OpenShiftsPayload>('GET', `/api/my/open-shifts${query({ from, to })}`));
    } catch {
      setData(null);
    }
  }, [from, to]);
  useEffect(() => void reload(), [reload]);
  return { data, reload };
}
