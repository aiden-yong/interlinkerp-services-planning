import { DateTime } from 'luxon';

export type RepeatUnit = 'day' | 'week' | 'month';
export type RepeatEnds = 'never' | 'on' | 'after';

export interface RepeatRule {
  interval: number;
  unit: RepeatUnit;
  ends: RepeatEnds;
  untilDate: string | null; // YYYY-MM-DD, inclusive, for 'on'
  count: number | null; // for 'after': number of created shifts, step 0 included
  timezone: string; // IANA
  firstStartLocal: string; // 'YYYY-MM-DDTHH:MM' wall clock of step 0
  durationMinutes: number; // end - start, wall-clock independent
  lastIndex: number | null; // a series ended early stops after this step
}

export interface Occurrence {
  index: number;
  start: Date;
  end: Date;
}

export const MAX_PER_RUN = 1000;

const unitKey: Record<RepeatUnit, 'days' | 'weeks' | 'months'> = { day: 'days', week: 'weeks', month: 'months' };

/** Steps with index >= fromIndex whose start is < until, in order, at most MAX_PER_RUN. */
export function occurrences(rule: RepeatRule, fromIndex: number, until: Date): Occurrence[] {
  const zone = rule.timezone;
  const first = DateTime.fromISO(rule.firstStartLocal, { zone });
  const firstDay = first.day;
  const untilMs = until.getTime();
  // Sized to outlast month-skip inflation (10x the 'after' budget) AND to reach
  // fromIndex/lastIndex even when there's no count at all (a 'never'/'on' series),
  // since the loop always starts walking at k = 0.
  const safetyCap = 10 * (rule.count ?? Math.max(fromIndex, rule.lastIndex ?? 0, 1)) + 10_000;
  const result: Occurrence[] = [];
  let remaining = rule.ends === 'after' ? (rule.count ?? 0) : Infinity;

  for (let k = 0; k <= safetyCap; k++) {
    if (rule.lastIndex !== null && k > rule.lastIndex) break;

    const step = first.plus({ [unitKey[rule.unit]]: k * rule.interval });

    // D2: a monthly step whose day-of-month drifted (e.g. no 31st this month) is skipped —
    // it still consumes an index, but not one of the 'after' budget's remaining slots.
    const skipped = rule.unit === 'month' && step.day !== firstDay;
    if (skipped) continue;

    const startMs = step.toMillis();

    if (rule.ends === 'on' && rule.untilDate !== null) {
      const localDate = step.toFormat('yyyy-MM-dd');
      if (localDate > rule.untilDate) break;
    }

    if (startMs >= untilMs) break;

    if (rule.ends === 'after') {
      if (remaining <= 0) break;
      remaining -= 1;
    }

    if (k >= fromIndex) {
      const start = step.toJSDate();
      const end = new Date(startMs + rule.durationMinutes * 60_000);
      result.push({ index: k, start, end });
      if (result.length >= MAX_PER_RUN) break;
    }
  }

  return result;
}
