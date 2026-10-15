import { DateTime } from 'luxon';

export const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** "2026-10-14" + "09:00" in zone -> "2026-10-14T01:00:00Z". Luxon resolves daylight-saving edges. */
export function wallToIso(date: string, time: string, zone: string): string {
  return toIso(DateTime.fromISO(`${date}T${time}`, { zone }).toMillis());
}

export function isoToWall(iso: string, zone: string): { date: string; time: string } {
  const local = DateTime.fromISO(iso, { zone });
  return { date: local.toISODate()!, time: local.toFormat('HH:mm') };
}

export const formatTime = (iso: string, zone: string) => isoToWall(iso, zone).time;

export const todayIn = (zone: string, now: Date = new Date()) => DateTime.fromJSDate(now, { zone }).toISODate()!;
