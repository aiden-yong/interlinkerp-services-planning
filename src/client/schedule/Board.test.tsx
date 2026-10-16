import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './Board';
import { periodFor } from './period';
import { buildRows, NO_FILTERS } from './rows';
import { employee, payload, shift } from './testData';
import type { SchedulePayload } from '../types';

function board(data: SchedulePayload, onOpen = vi.fn()) {
  return render(<Board data={data} rows={buildRows(data, 'employee', NO_FILTERS)} period={periodFor('week', '2026-10-14')} onOpen={onOpen} />);
}

describe('Board', () => {
  it('marks drafts, published shifts and conflicts (FR-SCH-07, FR-SCH-09)', () => {
    const { container } = board(payload({
      employees: [employee()],
      shifts: [
        shift({ id: 'd' }),
        shift({ id: 'p', state: 'published', start_at: '2026-10-15T01:00:00Z', end_at: '2026-10-15T09:00:00Z', conflicts: [{ rule: 'overlap', message: 'Overlaps other shifts; allocation reaches 200%.' }] }),
      ],
    }));
    const draft = container.querySelector('[data-shift-id="d"]')!;
    const published = container.querySelector('[data-shift-id="p"]')!;
    expect(draft.classList.contains('draft')).toBe(true);
    expect(published.classList.contains('published')).toBe(true);
    expect(published.classList.contains('conflict')).toBe(true);
    expect(published.getAttribute('title')).toContain('allocation reaches 200%');
    expect(draft.getAttribute('tabindex')).toBe('0');
  });

  it('shows working time, time off and hours against availability (FR-SCH-07, FR-SCH-08)', () => {
    const { container } = board(payload({
      employees: [employee({
        flexible: false, allocated_hours: 15, available_hours: 24, over_allocated_days: ['2026-10-16', '2026-10-17'],
        working_intervals: [{ start_at: '2026-10-12T01:00:00Z', end_at: '2026-10-12T05:00:00Z' }],
        unavailable: [{ start_at: '2026-10-15T16:00:00Z', end_at: '2026-10-16T16:00:00Z', kind: 'time_off', label: 'Annual leave' }],
      })],
    }));
    const row = container.querySelector('[data-row-ref="E1"]')!;
    expect(row.classList.contains('has-hours')).toBe(true);
    expect(row.querySelectorAll('.band.work')).toHaveLength(1);
    expect(row.querySelector('.band.away')!.getAttribute('title')).toBe('Annual leave');
    expect(row.querySelector('.hours')!.textContent).toContain('15.0 / 24.0 h');
    expect(row.querySelector('.over')!.getAttribute('title')).toContain('2026-10-16');
  });

  it('opens a shift from the keyboard (NFR-07)', () => {
    const onOpen = vi.fn();
    const { container } = board(payload({ employees: [employee()], shifts: [shift()] }), onOpen);
    container.querySelector<HTMLElement>('[data-shift-id="s1"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('labels a shift in a colour that stays readable on its role colour, time first', () => {
    const role = { id: 'r1', name: 'Technician', color: '#FACC15', archived: false };
    const { container } = board(payload({ roles: [role], employees: [employee()], shifts: [shift({ role_id: 'r1', state: 'published' })] }));
    const bar = container.querySelector<HTMLElement>('[data-shift-id="s1"]')!;
    expect(bar.style.getPropertyValue('--role-ink')).toBe('#000000');
    expect(bar.querySelector('.time')!.textContent).toBe('09:00–17:00');
    expect(bar.querySelector('.role')!.textContent).toBe('Technician');
    expect(bar.style.getPropertyValue('--lane')).toBe('0');
  });

  it('marks a conflict with an icon as well as the outline', () => {
    const { container } = board(payload({ employees: [employee()], shifts: [shift({ conflicts: [{ rule: 'overlap', message: 'Overlaps.' }] })] }));
    expect(container.querySelector('[data-shift-id="s1"] svg.icon')).not.toBeNull();
  });

  it('heads each day with its weekday and date as separate parts', () => {
    const { container } = board(payload());
    const head = container.querySelectorAll('.row.head .track.cols > div');
    expect(head).toHaveLength(7);
    expect(head[2].querySelector('.weekday')!.textContent).toBe('Wed');
    expect(head[2].querySelector('.date')!.textContent).toBe('14');
  });

  describe('on the current day', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-14T04:00:00Z')); // Wed 12:00 in Kuala Lumpur
    });
    afterEach(() => vi.useRealTimers());

    it("marks today's column and the current time", () => {
      const { container } = board(payload());
      const today = container.querySelector('.row.head [aria-current="date"]')!;
      expect(today.querySelector('.date')!.textContent).toBe('14');
      const root = container.querySelector<HTMLElement>('.board')!;
      expect(root.classList.contains('has-now')).toBe(true);
      expect(parseFloat(root.style.getPropertyValue('--now'))).toBeCloseTo((2.5 / 7) * 100, 3);
    });
  });

  it('escapes names', () => {
    const { container } = board(payload({ employees: [employee({ name: '<img src=x onerror=alert(1)>' })] }));
    expect(container.querySelector('img')).toBeNull();
  });

  it('marks shifts that are up for switch (FR-OPN-03)', () => {
    const { container } = board(payload({ employees: [employee()], shifts: [shift({ id: 'u', state: 'published', switch_requested: true })] }));
    const bar = container.querySelector('[data-shift-id="u"]')!;
    expect(bar.textContent).toContain('⇄');
    expect(bar.getAttribute('aria-label')).toContain('up for switch');
    expect(bar.getAttribute('title')).toContain('up for switch');
  });

  it('shows no switch marker on an ordinary shift', () => {
    const { container } = board(payload({ employees: [employee()], shifts: [shift({ id: 'n', state: 'published' })] }));
    const bar = container.querySelector('[data-shift-id="n"]')!;
    expect(bar.textContent).not.toContain('⇄');
    expect(bar.getAttribute('aria-label')).not.toContain('up for switch');
  });
});
