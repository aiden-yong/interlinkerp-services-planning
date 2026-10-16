import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { OpenShiftsPayload } from '../types';
import { AvailableShifts } from './AvailableShifts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data: OpenShiftsPayload = {
  timezone: 'Asia/Kuala_Lumpur', from: '2026-10-12', to: '2026-10-18', give_up: { mode: 'switch', window_days: 2 }, roles: [],
  open: [{ id: 'o1', role_id: null, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z', break_minutes: 0, allocated_hours: 8, note: null, switch_requested: false }],
  up_for_switch: [],
};
const claim = { name: 'Claim shift Wed 14 Oct 09:00-17:00' };

describe('AvailableShifts', () => {
  it('claims an open shift and reloads', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ shift: data.open[0] }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => {});
    render(<FeedbackProvider><AvailableShifts data={data} onChanged={onChanged} /></FeedbackProvider>);
    fireEvent.click(screen.getByRole('button', claim));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([path, init.method, JSON.parse(String(init.body))]).toEqual(['/api/shift-claims', 'POST', { shift_id: 'o1' }]);
    expect(await screen.findByText('Shift claimed.')).toBeTruthy();
  });

  it('explains a refused claim through the toast and still reloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'SHIFT_TAKEN', message: 'Someone else took this shift first.', details: null } }), { status: 409 })));
    const onChanged = vi.fn(async () => {});
    render(<FeedbackProvider><AvailableShifts data={data} onChanged={onChanged} /></FeedbackProvider>);
    fireEvent.click(screen.getByRole('button', claim));
    const message = await screen.findByText('Someone else took this shift first.');
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('does not throw when the reload fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    const onChanged = vi.fn(async () => { throw new Error('reload failed'); });
    render(<FeedbackProvider><AvailableShifts data={data} onChanged={onChanged} /></FeedbackProvider>);
    fireEvent.click(screen.getByRole('button', claim));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText('Shift claimed.')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', claim) as HTMLButtonElement).disabled).toBe(false));
  });

  it('takes over a colleague shift', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => {});
    const withSwitch = { ...data, open: [], up_for_switch: [{ ...data.open[0], id: 'u1', owner_ref: 'E2', owner_name: 'Sam' }] };
    render(<FeedbackProvider><AvailableShifts data={withSwitch} onChanged={onChanged} /></FeedbackProvider>);
    expect(screen.getByRole('list')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take shift Wed 14 Oct 09:00-17:00 from Sam' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/switch-takeovers');
  });

  it('renders nothing for empty lists or no data', () => {
    const empty = { ...data, open: [], up_for_switch: [] };
    const { container, rerender } = render(<FeedbackProvider><AvailableShifts data={empty} onChanged={async () => {}} /></FeedbackProvider>);
    expect(container.querySelector('section')).toBeNull();
    rerender(<FeedbackProvider><AvailableShifts data={null} onChanged={async () => {}} /></FeedbackProvider>);
    expect(container.querySelector('section')).toBeNull();
  });
});
