import { describe, expect, it } from 'vitest';
import { formatRanges, parseRanges, readWorkingHours, weeklyHours } from './workingHoursInput';

describe('working hours input', () => {
  it('parses comma-separated ranges and pads hours', () => {
    expect(parseRanges('09:00-13:00, 14:00 - 18:00')).toEqual([['09:00', '13:00'], ['14:00', '18:00']]);
    expect(parseRanges('9:00-17:30')).toEqual([['09:00', '17:30']]);
    expect(parseRanges('  ')).toEqual([]);
    expect(() => parseRanges('nine to five')).toThrow('"nine to five" is not a range like 09:00-13:00.');
  });

  it('formats back to text', () => {
    expect(formatRanges([['09:00', '13:00'], ['14:00', '18:00']])).toBe('09:00-13:00, 14:00-18:00');
  });

  it('reads all seven days and names the bad one', () => {
    const empty = { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };
    expect(readWorkingHours({ ...empty, mon: '09:00-17:00' }).mon).toEqual([['09:00', '17:00']]);
    expect(() => readWorkingHours({ ...empty, tue: 'x' })).toThrow('Tuesday:');
  });

  it('totals the week', () => {
    const day: [string, string][] = [['09:00', '13:00'], ['14:00', '18:00']];
    expect(weeklyHours({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] })).toBe(40);
    expect(weeklyHours(null)).toBeNull();
  });
});
