import { describe, expect, it } from 'vitest';
import { unreadLabel, timeAgo, withoutZone } from './inbox';

describe('timeAgo', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it('shortens the age', () => {
    expect([0, 5, 59, 60, 23 * 60, 24 * 60, 6 * 24 * 60].map((m) => timeAgo(ago(m), now))).toEqual(['now', '5m', '59m', '1h', '23h', '1d', '6d']);
  });

  it('switches to the date after a week', () => {
    expect(timeAgo(ago(8 * 24 * 60), now)).toMatch(/^\d{1,2} Oct$/);
  });
});

describe('withoutZone', () => {
  it('removes the zone from every line', () => {
    expect(withoutZone('Mon 9 Nov, 09:00–18:00 GMT+8\nTue 10 Nov, 09:00–18:00 GMT+8')).toBe('Mon 9 Nov, 09:00–18:00\nTue 10 Nov, 09:00–18:00');
  });

  it('removes it mid-sentence and handles half-hour zones and UTC', () => {
    expect(withoutZone('Siti claimed the open shift on Tue 10 Nov, 08:00–13:00 GMT+8.')).toBe('Siti claimed the open shift on Tue 10 Nov, 08:00–13:00.');
    expect(withoutZone('Mon 9 Nov, 09:00–18:00 GMT+5:30')).toBe('Mon 9 Nov, 09:00–18:00');
    expect(withoutZone('Mon 9 Nov, 09:00–18:00 UTC')).toBe('Mon 9 Nov, 09:00–18:00');
  });

  it('leaves ordinary text alone', () => {
    expect(withoutZone('You have a new shift')).toBe('You have a new shift');
  });
});

describe('unreadLabel', () => {
  it('caps the badge at 99+', () => {
    expect([unreadLabel(1), unreadLabel(99), unreadLabel(100)]).toEqual(['1', '99', '99+']);
  });
});
