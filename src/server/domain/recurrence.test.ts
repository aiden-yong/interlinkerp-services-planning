import { describe, expect, it } from 'vitest';
import { MAX_PER_RUN, occurrences, type RepeatRule } from './recurrence';

const base: RepeatRule = {
  interval: 1,
  unit: 'day',
  ends: 'never',
  untilDate: null,
  count: null,
  timezone: 'Asia/Kuala_Lumpur',
  firstStartLocal: '2026-01-01T09:00',
  durationMinutes: 60,
  lastIndex: null,
};

describe('occurrences', () => {
  it('repeats every 2 days', () => {
    const rule: RepeatRule = { ...base, interval: 2, unit: 'day', ends: 'never' };
    const result = occurrences(rule, 0, new Date('2026-01-08T00:00:00Z'));
    expect(result.map((o) => o.index)).toEqual([0, 1, 2, 3]);
    expect(result.map((o) => o.start.toISOString())).toEqual([
      '2026-01-01T01:00:00.000Z',
      '2026-01-03T01:00:00.000Z',
      '2026-01-05T01:00:00.000Z',
      '2026-01-07T01:00:00.000Z',
    ]);
  });

  it('repeats weekly up to an inclusive end date', () => {
    const rule: RepeatRule = { ...base, interval: 1, unit: 'week', ends: 'on', untilDate: '2026-01-15' };
    const result = occurrences(rule, 0, new Date('2027-01-01T00:00:00Z'));
    expect(result).toHaveLength(3);
    expect(result.map((o) => o.start.toISOString())).toEqual([
      '2026-01-01T01:00:00.000Z',
      '2026-01-08T01:00:00.000Z',
      '2026-01-15T01:00:00.000Z',
    ]);
  });

  it('stops after a number of shifts, counting skipped months out', () => {
    const rule: RepeatRule = {
      ...base,
      interval: 1,
      unit: 'month',
      ends: 'after',
      count: 3,
      firstStartLocal: '2026-01-31T09:00',
    };
    const result = occurrences(rule, 0, new Date('2027-01-01T00:00:00Z'));
    expect(result.map((o) => o.index)).toEqual([0, 2, 4]);
    expect(result.map((o) => o.start.toISOString())).toEqual([
      '2026-01-31T01:00:00.000Z',
      '2026-03-31T01:00:00.000Z',
      '2026-05-31T01:00:00.000Z',
    ]);
  });

  it('keeps 09:00 across a DST change', () => {
    const rule: RepeatRule = {
      ...base,
      interval: 1,
      unit: 'week',
      ends: 'never',
      timezone: 'Europe/London',
      firstStartLocal: '2026-03-22T09:00',
    };
    const result = occurrences(rule, 0, new Date('2026-04-01T00:00:00Z'));
    expect(result.map((o) => o.start.toISOString())).toEqual([
      '2026-03-22T09:00:00.000Z',
      '2026-03-29T08:00:00.000Z',
    ]);
  });

  it('starts from a later index and respects lastIndex', () => {
    const rule: RepeatRule = { ...base, interval: 1, unit: 'day', ends: 'never', lastIndex: 3 };
    const result = occurrences(rule, 2, new Date('2027-01-01T00:00:00Z'));
    expect(result.map((o) => o.index)).toEqual([2, 3]);
  });

  it('caps one run at 1,000', () => {
    const rule: RepeatRule = { ...base, interval: 1, unit: 'day', ends: 'never' };
    const tenYearsLater = new Date('2036-01-01T00:00:00Z');
    const result = occurrences(rule, 0, tenYearsLater);
    expect(result).toHaveLength(MAX_PER_RUN);
  });

  it('returns an empty list when fromIndex is past an exhausted count budget', () => {
    const rule: RepeatRule = { ...base, interval: 1, unit: 'day', ends: 'after', count: 10 };
    const result = occurrences(rule, 50, new Date('2027-01-01T00:00:00Z'));
    expect(result).toEqual([]);
  });

  it('uses the duration in real time', () => {
    const rule: RepeatRule = {
      ...base,
      interval: 1,
      unit: 'week',
      ends: 'never',
      timezone: 'Europe/London',
      firstStartLocal: '2026-03-22T09:00',
      durationMinutes: 480,
    };
    const result = occurrences(rule, 0, new Date('2026-04-01T00:00:00Z'));
    for (const occ of result) {
      expect(occ.end.getTime() - occ.start.getTime()).toBe(8 * 60 * 60 * 1000);
    }
  });
});
