import { describe, expect, it } from 'vitest';
import { formatTime, isoToWall, todayIn, wallToIso } from './tz';

describe('time zones', () => {
  it('converts wall time to UTC and back', () => {
    expect(wallToIso('2026-10-14', '09:00', 'Asia/Kuala_Lumpur')).toBe('2026-10-14T01:00:00Z');
    expect(isoToWall('2026-10-14T01:00:00Z', 'Asia/Kuala_Lumpur')).toEqual({ date: '2026-10-14', time: '09:00' });
    expect(formatTime('2026-10-14T16:30:00Z', 'Asia/Kuala_Lumpur')).toBe('00:30');
    expect(todayIn('Asia/Kuala_Lumpur', new Date('2026-10-13T17:00:00Z'))).toBe('2026-10-14');
  });

  it('handles both sides of a daylight-saving change', () => {
    expect(wallToIso('2026-11-01', '12:00', 'America/New_York')).toBe('2026-11-01T17:00:00Z');
    expect(wallToIso('2026-10-31', '12:00', 'America/New_York')).toBe('2026-10-31T16:00:00Z');
  });
});
