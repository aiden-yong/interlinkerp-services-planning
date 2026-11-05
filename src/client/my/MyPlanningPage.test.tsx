import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { Me } from '../types';
import { MyPlanningPage } from './MyPlanningPage';

const me: Me = { name: 'Ana Lim', email: 'ana@example.com', gateway_role: 'user', employee_ref: 'E1', roster_status: 'found', is_manager: false, timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur' };
const role = { id: 'r1', name: 'Technician', color: '#0F766E', archived: false };
const mine = { id: 'm1', role_id: 'r1', start_at: '2026-11-05T01:00:00Z', end_at: '2026-11-05T09:00:00Z', break_minutes: 60, allocated_hours: 7, note: 'Bring the ladder', switch_requested: false };
const open = { id: 'o1', role_id: 'r1', start_at: '2026-11-06T01:00:00Z', end_at: '2026-11-06T05:00:00Z', break_minutes: 0, allocated_hours: 4, note: null, switch_requested: false };

function server() {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const url = new URL(path, 'http://x');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const body = path.startsWith('/api/my/shifts')
      ? { timezone: me.timezone, from, to, roles: [role], shifts: from! <= '2026-11-05' && to! >= '2026-11-05' ? [mine] : [] }
      : path.startsWith('/api/my/open-shifts')
        ? { timezone: me.timezone, from, to, give_up: { mode: 'switch', window_days: 2 }, roles: [role], open: from! <= '2026-11-06' && to! >= '2026-11-06' ? [open] : [], up_for_switch: [] }
        : path.startsWith('/api/my/calendar-feed') ? { enabled: false } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const show = () => render(<FeedbackProvider><MyPlanningPage me={me} /></FeedbackProvider>);
const view = (name: string) => screen.getByRole('radio', { name });

describe('MyPlanningPage calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T00:00:00Z') }); // 08:00 on Thursday locally, before the day's shift
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens on the week with my shift and the open one, told apart', async () => {
    server();
    show();
    expect(await screen.findByRole('button', { name: /^My shift Thu 5 Nov 09:00-17:00/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Open shift Fri 6 Nov 09:00-13:00/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('2 Nov 2026');
    expect((view('Week') as HTMLInputElement).checked).toBe(true);
  });

  it('switches between Day, Week, Month and Year', async () => {
    server();
    show();
    await screen.findByRole('button', { name: /^My shift/ });
    fireEvent.click(view('Day'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Thu 5 Nov 2026');
    fireEvent.click(view('Month'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nov 2026');
    expect(await screen.findByRole('button', { name: /^My shift Thu 5 Nov/ })).toBeTruthy();
    fireEvent.click(view('Year'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('2026');
    expect(screen.getByRole('region', { name: 'February' })).toBeTruthy();
    expect(await screen.findAllByRole('button', { name: /Thu 5 November, 7\.0 hours/ })).not.toHaveLength(0);
  });

  it('loads a year in pieces the server accepts', async () => {
    const calls = server();
    show();
    await screen.findByRole('button', { name: /^My shift/ });
    calls.length = 0;
    fireEvent.click(view('Year'));
    await waitFor(() => expect(calls.filter((c) => c.includes('/api/my/shifts')).length).toBe(6));
    for (const call of calls.filter((c) => c.includes('/api/my/shifts'))) {
      const url = new URL(call.replace('GET ', ''), 'http://x');
      expect((Date.parse(url.searchParams.get('to')!) - Date.parse(url.searchParams.get('from')!)) / 86_400_000 + 1).toBeLessThanOrEqual(62);
    }
  });

  it('a date in Month opens that day, and a month name in Year opens that month', async () => {
    server();
    show();
    await screen.findByRole('button', { name: /^My shift/ });
    fireEvent.click(view('Month'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Sat 14 in the day view' })[0]!);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sat 14 Nov 2026');
    fireEvent.click(view('Year'));
    fireEvent.click(screen.getByRole('button', { name: 'March' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mar 2026');
  });

  it('opens a shift to see its details', async () => {
    server();
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^My shift/ }));
    const dialog = screen.getByRole('dialog', { name: 'My shift' });
    expect(within(dialog).getByText('Bring the ladder')).toBeTruthy();
    expect(within(dialog).getByText('7.0 h (60 min break)')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Ask for cover for shift/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('claims an open shift from its details, then closes them', async () => {
    const calls = server();
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Open shift/ }));
    const dialog = screen.getByRole('dialog', { name: 'Open shift' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Claim shift/ }));
    await waitFor(() => expect(calls).toContain('POST /api/shift-claims'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('hides available shifts when that toggle is off', async () => {
    server();
    show();
    await screen.findByRole('button', { name: /^Open shift/ });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Available shifts' }));
    expect(screen.queryByRole('button', { name: /^Open shift/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^My shift/ })).toBeTruthy();
  });

  it('takes the keys Google Calendar uses, but not while typing or with a dialog open', async () => {
    server();
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^My shift/ }));
    fireEvent.keyDown(window, { key: 'm' });
    expect((view('Week') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    fireEvent.keyDown(window, { key: 'm' });
    expect((view('Month') as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dec 2026');
    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nov 2026');
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'My shifts' }), { key: 'y' });
    expect((view('Month') as HTMLInputElement).checked).toBe(true);
    await act(async () => {});
  });

  it('remembers the view for next time', async () => {
    server();
    show();
    await screen.findByRole('button', { name: /^My shift/ });
    fireEvent.click(view('Month'));
    cleanup();
    show();
    expect((view('Month') as HTMLInputElement).checked).toBe(true);
    await screen.findByRole('button', { name: /^My shift/ });
  });

  it('says so when a period has nothing in it', async () => {
    server();
    show();
    await screen.findByRole('button', { name: /^My shift/ });
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByText('No shifts to show in this week.')).toBeTruthy();
  });
});
