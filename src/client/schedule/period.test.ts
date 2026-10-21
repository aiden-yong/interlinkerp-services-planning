import { describe, expect, it } from 'vitest';
import { dayLabel, periodFor, periodLabel, step } from './period';

describe('periods', () => {
  it('starts weeks on Monday', () => {
    expect(periodFor('week', '2026-10-14')).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect(periodFor('week', '2026-10-18').from).toBe('2026-10-12');
    expect(periodFor('week', '2026-10-14').days).toHaveLength(7);
  });

  it('covers whole months and single days', () => {
    expect(periodFor('month', '2026-02-10')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodFor('day', '2026-10-14').days).toEqual(['2026-10-14']);
  });

  it('steps by scale', () => {
    expect([step('day', '2026-10-14', 1), step('week', '2026-10-14', -1), step('month', '2026-01-31', 1)]).toEqual(['2026-10-15', '2026-10-07', '2026-02-01']);
  });

  it('labels days and periods', () => {
    expect([dayLabel('2026-10-14', 'week'), dayLabel('2026-10-14', 'month')]).toEqual(['Wed 14', '14']);
    expect(periodLabel(periodFor('week', '2026-10-14'))).toBe('12 Oct 2026 – 18 Oct 2026');
    expect(periodLabel(periodFor('month', '2026-10-14'))).toBe('Oct 2026');
  });

  it('year runs 1 Jan to 31 Dec and steps a year', () => {
    expect(periodFor('year', '2026-10-14')).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expect(step('year', '2026-10-14', 1)).toBe('2027-01-01');
    expect(step('year', '2026-10-14', -1)).toBe('2025-01-01');
    expect(periodLabel(periodFor('year', '2026-10-14'))).toBe('2026');
  });
});
