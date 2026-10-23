import { describe, expect, it } from 'vitest';
import { type FeedEvent, toICalendar } from './ical';

const event = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  uid: 'abc@planning.test', start: new Date('2026-10-14T01:00:00Z'), end: new Date('2026-10-14T09:00:00Z'), summary: 'Cashier', description: 'Break: 30 min', sequence: 2, ...over,
});

describe('toICalendar', () => {
  it('writes a valid calendar', () => {
    const text = toICalendar([event()], new Date('2026-10-13T02:00:00Z'));
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('DTSTART:20261014T010000Z\r\n');
    expect(text).toContain('DTEND:20261014T090000Z\r\n');
    expect(text).toContain('DTSTAMP:20261013T020000Z\r\n');
    expect(text).toContain('SEQUENCE:2\r\n');
    expect(text).toContain('PRODID:-//InterlinkERP//Planning//EN\r\n');
    expect(text).toContain('X-WR-CALNAME:Work shifts\r\n');
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const tag of ['VCALENDAR', 'VEVENT']) expect(text.match(new RegExp(`BEGIN:${tag}`, 'g'))?.length).toBe(text.match(new RegExp(`END:${tag}`, 'g'))?.length);
  });

  it('escapes text and folds long lines', () => {
    const note = `Bring keys; ids, badge\\ more\nsecond line ${'x'.repeat(200)} é`;
    const text = toICalendar([event({ description: note })], new Date('2026-10-13T02:00:00Z'));
    expect(text.replace(/\r\n /g, '')).toContain('Bring keys\\; ids\\, badge\\\\ more\\nsecond');
    const lines = text.split('\r\n').slice(0, -1);
    for (const line of lines) expect(Buffer.byteLength(line), line).toBeLessThanOrEqual(75);
    const start = lines.findIndex((l) => l.startsWith('DESCRIPTION:'));
    expect(lines[start + 1]!.startsWith(' ')).toBe(true);
    const unfolded = text.replace(/\r\n /g, '');
    expect(unfolded).toContain(`second line ${'x'.repeat(200)} é`);
  });
});
