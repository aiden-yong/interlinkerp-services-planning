import { describe, expect, it } from 'vitest';
import { localMidnight } from '../support/time';
import { DAYS, parseWorkingHours, workingIntervals, WorkingHoursError } from './workingHours';

const day: [string, string][] = [['09:00', '13:00'], ['14:00', '18:00']];
const weekdays = () => parseWorkingHours({ mon: day, tue: day, wed: day, thu: day, fri: day });
const total = (list: { hours: number }[]) => list.reduce((sum, i) => sum + i.hours, 0);
const KL = 'Asia/Kuala_Lumpur';

describe('workingIntervals', () => {
  it('produces a Kuala Lumpur week', () => {
    const from = localMidnight('2026-10-12', KL); // a Monday
    const list = workingIntervals(weekdays(), from, from + 7 * 86_400_000, KL);
    expect(list).toHaveLength(10);
    expect(new Date(list[0].start).toISOString()).toBe('2026-10-12T01:00:00.000Z');
    expect(total(list)).toBe(40);
  });

  it('clips to the range', () => {
    const list = workingIntervals(weekdays(), Date.parse('2026-10-12T11:00:00+08:00'), Date.parse('2026-10-12T16:00:00+08:00'), KL);
    expect(total(list)).toBe(4);
  });

  it('gives a 25-hour day when daylight saving ends', () => {
    const ny = 'America/New_York';
    const list = workingIntervals(parseWorkingHours({ sun: [['00:00', '24:00']] }), localMidnight('2026-11-01', ny), localMidnight('2026-11-02', ny), ny);
    expect(list).toHaveLength(1);
    expect(list[0].hours).toBe(25);
  });
});

describe('parseWorkingHours', () => {
  it('returns all seven days with ranges sorted', () => {
    const hours = parseWorkingHours({ wed: [['14:00', '18:00'], ['08:00', '12:00']] });
    expect(Object.keys(hours)).toEqual(DAYS);
    expect(hours.wed).toEqual([['08:00', '12:00'], ['14:00', '18:00']]);
    expect(hours.mon).toEqual([]);
  });

  it.each([
    [{ fun: [] }, 'Unknown weekday "fun"'],
    [{ mon: 'nine to five' }, 'mon: give a list'],
    [{ mon: [['9:00', '13:00']] }, 'mon: each range'],
    [{ mon: [['13:00', '09:00']] }, 'must end after it starts'],
    [{ mon: [['09:00', '13:00'], ['12:00', '14:00']] }, 'mon: ranges overlap'],
    [{ mon: [['09:00', '25:00']] }, 'mon: each range'],
    ['not an object', 'Give an object keyed by weekday'],
  ])('rejects %j', (data, message) => {
    expect(() => parseWorkingHours(data)).toThrow(WorkingHoursError);
    expect(() => parseWorkingHours(data)).toThrow(message);
  });
});
