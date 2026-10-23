import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { AutoPlanReport, Me } from '../types';
import { AutoPlanResult } from './AutoPlanResult';
import { SchedulePage } from './SchedulePage';
import { employee, payload, shift } from './testData';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const reason = { reason_code: 'NO_ROLE', reason: 'No one on the roster has this role' };
const twins = payload({ shifts: [shift({ id: 'x', employee_ref: null }), shift({ id: 'y', employee_ref: null })] });
const report: AutoPlanReport = { filled: [], unfilled: [{ shift_id: 'x', ...reason }, { shift_id: 'y', ...reason }], skipped_published: [], skipped_changed: [] };

describe('AutoPlanResult', () => {
  it('shows both identical-looking rows without duplicate-key warnings', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AutoPlanResult report={report} data={twins} zone="Asia/Kuala_Lumpur" onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Filled 0 of 2 open shifts' });
    expect(within(dialog).getAllByText(/No one on the roster has this role/)).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('SchedulePage Auto Plan', () => {
  const me: Me = {
    name: 'Manager', email: 'm@example.test', gateway_role: 'admin', employee_ref: null, roster_status: 'not_found',
    is_manager: true, timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur',
  };

  it('opens the result after the run and returns focus to the Auto Plan button on Close', async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response(JSON.stringify(report), { status: 201 }) : new Response(JSON.stringify({ ...twins, employees: [employee()] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FeedbackProvider><SchedulePage me={me} /></FeedbackProvider>);
    await screen.findByRole('region', { name: 'Schedule' });
    fireEvent.click(screen.getByRole('button', { name: 'Auto Plan' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Fill the draft open shifts in this period?' })).getByRole('button', { name: 'Auto Plan' }));
    const result = await screen.findByRole('dialog', { name: 'Filled 0 of 2 open shifts' });
    await waitFor(() => expect(document.activeElement).toBe(within(result).getByRole('button', { name: 'Close' })));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(String(post[0])).toBe('/api/auto-plans');
    expect(Object.keys(JSON.parse(String((post[1] as RequestInit).body))).sort()).toEqual(['from', 'timezone', 'to']);
    fireEvent.click(within(result).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const button = screen.getByRole('button', { name: 'Auto Plan' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
