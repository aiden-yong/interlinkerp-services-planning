import { describe, expect, it } from 'vitest';
import { presetRange, reportUrl } from './reportQuery';

describe('report periods', () => {
  it('this week runs Monday to Sunday', () => {
    expect(presetRange('this-week', '2026-10-14')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('last month across a year end', () => {
    expect(presetRange('last-month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('this month covers the whole calendar month', () => {
    expect(presetRange('this-month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('report URLs', () => {
  it('builds the CSV URL without empty filters', () => {
    expect(reportUrl('planned-hours', { from: '2026-10-12', to: '2026-10-18', group: 'role', roleId: '', departmentId: undefined }, 'csv'))
      .toBe('/api/reports/planned-hours?from=2026-10-12&to=2026-10-18&group=role&format=csv');
  });

  it('sends the zone, filters and the published-only flag', () => {
    expect(reportUrl('open-shifts', { from: 'a', to: 'b', roleId: 'r1', publishedOnly: true, timezone: 'Asia/Tokyo' }, 'json'))
      .toBe('/api/reports/open-shifts?from=a&to=b&role_id=r1&published_only=true&timezone=Asia%2FTokyo&format=json');
  });
});
