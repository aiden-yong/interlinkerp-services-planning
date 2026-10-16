import { describe, expect, it } from 'vitest';
import type { ShiftRecord } from '../repo/shifts';
import { formatSpan, render, scrubAddresses } from './messages';

const KL = 'Asia/Kuala_Lumpur';
const shift = (id: string, start: string, end: string): ShiftRecord => ({
  id, employeeRef: 'E1', roleId: null, start: new Date(start), end: new Date(end), breakMinutes: 0, percent: 100, note: null, state: 'published',
  publishedAt: null, ackBy: null, ackAt: null, version: 1, createdBy: 'm@example.com', deletedAt: null, switchRequestedAt: null,
});
const ctx = {
  shifts: new Map([['s1', shift('s1', '2026-10-14T01:00:00Z', '2026-10-14T09:00:00Z')], ['s2', shift('s2', '2026-10-15T14:00:00Z', '2026-10-15T22:00:00Z')]]),
  names: new Map([['E1', 'Ana Lim'], ['E2', 'Bo Tan']]),
  zone: KL,
  publicUrl: 'https://planning.example.com',
};

describe('messages', () => {
  it('formats a span in the recipient zone, with the end date only when it differs', () => {
    expect(formatSpan(new Date('2026-10-14T01:00:00Z'), new Date('2026-10-14T09:00:00Z'), KL)).toBe('Wed 14 Oct, 09:00–17:00');
    expect(formatSpan(new Date('2026-10-15T14:00:00Z'), new Date('2026-10-15T22:00:00Z'), KL)).toBe('Thu 15 Oct, 22:00 – Fri 16 Oct, 06:00');
  });

  it('lists every published shift in one notice (FR-PUB-01 AC1)', () => {
    expect(render('schedule_published', { shift_ids: ['s1', 's2'] }, ctx)).toEqual({
      title: 'Your 2 shifts were published',
      body: 'Wed 14 Oct, 09:00–17:00\nThu 15 Oct, 22:00 – Fri 16 Oct, 06:00',
      link: 'https://planning.example.com/my',
    });
  });

  it('names people in manager notices and links managers to the schedule (FR-NTF-03)', () => {
    expect(render('shift_switched', { shift_id: 's1', from_ref: 'E1', to_ref: 'E2' }, ctx)).toEqual({
      title: 'Shift switched', body: "Bo Tan took over Ana Lim's shift on Wed 14 Oct, 09:00–17:00.", link: 'https://planning.example.com/schedule',
    });
  });

  it('renders a cancelled shift from the times saved in the notice (FR-NTF-02)', () => {
    expect(render('shift_deleted', { shift_id: 'gone', start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z' }, ctx).body).toBe('Wed 14 Oct, 09:00–17:00');
  });

  it('refuses unknown kinds and missing shifts', () => {
    expect(() => render('mystery', {}, ctx)).toThrow('Unknown notification kind mystery');
    expect(() => render('shift_assigned', { shift_id: 'nope' }, ctx)).toThrow('Shift nope not found');
  });

  it('removes email addresses from error text before it is saved (DR-02)', () => {
    expect(scrubAddresses('550 5.1.1 <Ana.Lim@example.com>: Recipient address rejected')).toBe('550 5.1.1 <[address]>: Recipient address rejected');
    expect(scrubAddresses('x'.repeat(600))).toHaveLength(500);
  });
});
