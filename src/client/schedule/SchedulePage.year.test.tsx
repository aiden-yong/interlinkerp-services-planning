import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { Me } from '../types';
import { SchedulePage } from './SchedulePage';
import { payload } from './testData';

const me: Me = {
  name: 'Manager', email: 'm@example.test', gateway_role: 'admin', employee_ref: null, roster_status: 'not_found',
  is_manager: true, timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur',
};
const cell = { draft_hours: 0, published_hours: 0, total_hours: 0, shifts: 0 };

describe('SchedulePage Year scale', () => {
  const urls: URL[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T04:00:00Z'));
    urls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input, 'http://planning.test');
      urls.push(url);
      const body = url.pathname === '/api/reports/planned-hours'
        ? { period: {}, group: 'employee', totals: cell, rows: [{ key: 'E1', label: 'Ana Lim', left: false, ...cell, months: [{ month: '2026-03', ...cell, published_hours: 120, total_hours: 120 }] }] }
        : url.pathname === '/api/reports/utilisation'
          ? { period: {}, rows: [{ employee_ref: 'E1', name: 'Ana Lim', left: false, flexible: false, allocated_hours: 0, available_hours: null, utilisation_percent: null, over_allocated_days: [], months: [{ month: '2026-03', allocated_hours: 120, available_hours: 100, over_allocated: true }] }] }
          : url.pathname === '/api/employees' ? { employees: [] } : payload({ roles: [{ id: 'r1', name: 'Barista', color: '#000000', archived: false }] });
      return new Response(JSON.stringify(body), { status: 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('shows hours by month from the report endpoints, hides editing actions, and opens a clicked month in Month scale', async () => {
    render(<FeedbackProvider><SchedulePage me={me} /></FeedbackProvider>);
    await screen.findByRole('button', { name: 'Auto Plan' });
    fireEvent.click(screen.getByRole('radio', { name: 'Year' }));
    const march = await screen.findByRole('button', { name: 'Ana Lim, March 2026: 120.0 hours, over-allocated' });
    expect(within(march).getByText('Over-allocated')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('2026');
    for (const name of ['Auto Plan', 'Add shift', 'Copy previous week', 'Publish']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect((screen.getByRole('option', { name: 'By role' }) as HTMLOptionElement).disabled).toBe(true);
    const planned = urls.find((u) => u.pathname === '/api/reports/planned-hours')!;
    expect(Object.fromEntries(planned.searchParams)).toMatchObject({ from: '2026-01-01', to: '2026-12-31', group: 'employee', bucket: 'month', timezone: 'Asia/Kuala_Lumpur' });
    expect(urls.find((u) => u.pathname === '/api/reports/utilisation')!.searchParams.get('bucket')).toBe('month');

    fireEvent.click(march);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mar 2026'));
    expect(screen.getByRole('button', { name: 'Auto Plan' })).toBeTruthy();
  });

  it('sends the role filter to planned hours but not to utilisation, so over-allocation warnings stay (D20)', async () => {
    render(<FeedbackProvider><SchedulePage me={me} /></FeedbackProvider>);
    await screen.findByRole('button', { name: 'Auto Plan' });
    fireEvent.click(screen.getByRole('radio', { name: 'Year' }));
    await screen.findByRole('button', { name: /Ana Lim, March 2026/ });
    const roleSelect = screen.getByRole('combobox', { name: 'Filter by role' }) as HTMLSelectElement;
    const roleId = Array.from(roleSelect.options).find((o) => o.value)!.value;
    urls.length = 0;
    fireEvent.change(roleSelect, { target: { value: roleId } });
    await waitFor(() => expect(urls.some((u) => u.pathname === '/api/reports/utilisation')).toBe(true));
    expect(urls.find((u) => u.pathname === '/api/reports/planned-hours')!.searchParams.get('role_id')).toBe(roleId);
    expect(urls.find((u) => u.pathname === '/api/reports/utilisation')!.searchParams.has('role_id')).toBe(false);
  });
});
