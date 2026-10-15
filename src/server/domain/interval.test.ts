import { describe, expect, it } from 'vitest';
import { Interval } from './interval';

describe('Interval', () => {
  it('must end after it starts', () => {
    expect(() => Interval.of('2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')).toThrow(RangeError);
  });

  it('treats touching intervals as not overlapping', () => {
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T10:00:00Z').overlaps(Interval.of('2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z'))).toBe(false);
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T10:01:00Z').overlaps(Interval.of('2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z'))).toBe(true);
  });

  it('intersects', () => {
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T12:00:00Z').intersect(Interval.of('2026-10-13T10:30:00Z', '2026-10-13T20:00:00Z'))?.hours).toBe(1.5);
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z').intersect(Interval.of('2026-10-13T09:00:00Z', '2026-10-13T10:00:00Z'))).toBeNull();
  });
});
