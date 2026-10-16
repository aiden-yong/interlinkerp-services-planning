export type Scale = 'day' | 'week' | 'month';
export interface Period { scale: Scale; from: string; to: string; days: string[] }

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar dates are handled as UTC midnights, so no local time zone can shift them. */
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, n: number) => format(parse(date) + n * DAY_MS);

export function periodFor(scale: Scale, anchor: string): Period {
  let from = anchor;
  let to = anchor;
  if (scale === 'week') {
    from = addDays(anchor, -((new Date(parse(anchor)).getUTCDay() + 6) % 7));
    to = addDays(from, 6);
  } else if (scale === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    from = format(Date.UTC(y, m - 1, 1));
    to = format(Date.UTC(y, m, 0));
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { scale, from, to, days };
}

export function step(scale: Scale, anchor: string, direction: -1 | 1): string {
  if (scale === 'day') return addDays(anchor, direction);
  if (scale === 'week') return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split('-').map(Number);
  return format(Date.UTC(y, m - 1 + direction, 1));
}

export const weekdayOf = (date: string) => WEEKDAYS[new Date(parse(date)).getUTCDay()];

export function dayLabel(date: string, scale: Scale): string {
  const d = new Date(parse(date));
  return scale === 'month' ? String(d.getUTCDate()) : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

const long = (date: string) => {
  const d = new Date(parse(date));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function periodLabel(p: Period): string {
  if (p.scale === 'day') return `${WEEKDAYS[new Date(parse(p.from)).getUTCDay()]} ${long(p.from)}`;
  if (p.scale === 'week') return `${long(p.from)} – ${long(p.to)}`;
  const d = new Date(parse(p.from));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
