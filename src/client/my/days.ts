import { isoToWall } from '../schedule/tz';
import type { MyShift } from '../types';

export function groupByDay(shifts: MyShift[], days: string[], zone: string): { date: string; shifts: MyShift[] }[] {
  const sorted = [...shifts].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return days.map((date) => ({ date, shifts: sorted.filter((s) => isoToWall(s.start_at, zone).date === date) }));
}
