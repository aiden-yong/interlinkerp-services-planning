import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('escapes names', () => {
    const { container } = board(payload({ employees: [employee({ name: '<img src=x onerror=alert(1)>' })] }));
    expect(container.querySelector('img')).toBeNull();
  });
});
