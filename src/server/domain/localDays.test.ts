import { describe, expect, it } from 'vitest';
import { Interval } from './interval';
import { splitByLocalDay } from './localDays';

describe('splitByLocalDay', () => {
  it('splits an overnight shift at local midnight', () => {
    const days = splitByLocalDay(Interval.of('2026-10-12T22:00:00+08:00', '2026-10-13T06:00:00+08:00'), 'Asia/Kuala_Lumpur');
    expect([...days.keys()]).toEqual(['2026-10-12', '2026-10-13']);
    expect(days.get('2026-10-12')?.hours).toBe(2);
    expect(days.get('2026-10-13')?.hours).toBe(6);
  });

  it('keeps a same-day shift whole', () => {
    expect([...splitByLocalDay(Interval.of('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00'), 'Asia/Kuala_Lumpur').keys()]).toEqual(['2026-10-12']);
  });

  it('keeps the long daylight-saving day as one piece', () => {
    const days = splitByLocalDay(Interval.of('2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'), 'America/New_York');
    expect([...days.keys()]).toEqual(['2026-11-01']);
    expect(days.get('2026-11-01')?.hours).toBe(25);
  });
});
