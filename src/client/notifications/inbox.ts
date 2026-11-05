const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A short age for the list: "now", "5m", "3h", "2d", then the date. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  return `${then.getDate()} ${MONTHS[then.getMonth()]}`;
}

/** A notice names the zone on every line, for email. In the app everything is already in the reader's own zone. */
export const withoutZone = (body: string): string => body.replace(/ (?:GMT|UTC)(?:[+-]\d{1,2}(?::\d{2})?)?(?=$|\n|\.| -)/gm, '');

/** The badge text: the count, capped at 99+. */
export const unreadLabel = (n: number): string => (n > 99 ? '99+' : String(n));
