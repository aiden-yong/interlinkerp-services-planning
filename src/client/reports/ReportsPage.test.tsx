import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { Me } from '../types';
import { ReportsPage } from './ReportsPage';

const me: Me = {
  name: 'Manager', email: 'm@example.test', gateway_role: 'admin', employee_ref: null, roster_status: 'not_found',
  is_manager: true, timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur',
};
const period = { from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Kuala_Lumpur', from_at: '', to_at: '' };
const hoursCell = { draft_hours: 1, published_hours: 7, total_hours: 8, shifts: 1 };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReportsPage', () => {
  it('switches from Planned hours to Utilisation without drawing the old data as the new shape', async () => {
    let release: (r: Response) => void = () => {};
    const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/roles')) return respond({ roles: [] });
      if (url.startsWith('/api/employees')) return respond({ employees: [] });
      if (url.startsWith('/api/reports/planned-hours')) {
        return respond({ period, group: 'employee', rows: [{ key: 'E1', label: 'Ana', left: false, ...hoursCell }], totals: hoursCell });
      }
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FeedbackProvider><ReportsPage me={me} /></FeedbackProvider>);
    await screen.findByText('Ana');

    fireEvent.click(screen.getByLabelText('Utilisation'));
    expect(screen.queryByText('Ana')).toBeNull();
    release(respond({ period, rows: [{ employee_ref: 'E1', name: 'Bo', left: false, flexible: false, allocated_hours: 9, available_hours: 8, utilisation_percent: 112.5, over_allocated_days: ['2026-10-14'] }] }));
    await screen.findByText('Bo');
    expect(screen.getByText(/Over-allocated:/)).toBeTruthy();
    expect(screen.getByText('112.5%')).toBeTruthy();
  });

  it('hides the table and disables the download when the custom range is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/reports')
      ? { period, group: 'employee', rows: [{ key: 'E1', label: 'Ana', left: false, ...hoursCell }], totals: hoursCell }
      : { roles: [], employees: [] }), { status: 200 })));
    render(<FeedbackProvider><ReportsPage me={me} /></FeedbackProvider>);
    await screen.findByText('Ana');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2999-01-01' } });
    await waitFor(() => expect(screen.queryByText('Ana')).toBeNull());
    expect(screen.getByRole('alert').textContent).toMatch(/Choose a start date/);
  });
});
