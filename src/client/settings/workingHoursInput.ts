import type { Weekday, WorkingHoursMap } from '../types';

export const WEEKDAYS: [Weekday, string][] = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

export function parseRanges(text: string): [string, string][] {
  if (!text.trim()) return [];
  return text.split(',').map((part) => {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error(`"${part.trim()}" is not a range like 09:00-13:00.`);
    return [`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`];
  });
}

export const formatRanges = (ranges: [string, string][]) => ranges.map(([a, b]) => `${a}-${b}`).join(', ');

export function readWorkingHours(values: Record<Weekday, string>): WorkingHoursMap {
  const hours = {} as WorkingHoursMap;
  for (const [day, label] of WEEKDAYS) {
    try {
      hours[day] = parseRanges(values[day] ?? '');
    } catch (error) {
      throw new Error(`${label}: ${(error as Error).message}`);
    }
  }
  return hours;
}

export function weeklyHours(hours: WorkingHoursMap | null): number | null {
  if (!hours) return null;
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return WEEKDAYS.reduce((sum, [day]) => sum + (hours[day] ?? []).reduce((s, [a, b]) => s + minutes(b) - minutes(a), 0), 0) / 60;
}
