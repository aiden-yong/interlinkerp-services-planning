import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { GiveUp, MyShift } from '../types';
import { GiveUpButton } from './GiveUpButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const future = new Date(Date.now() + 5 * 86_400_000);
const startAt = future.toISOString();
const endAt = new Date(future.getTime() + 8 * 3_600_000).toISOString();
const mine = (switchRequested = false): MyShift => ({ id: 'm1', role_id: null, start_at: startAt, end_at: endAt, break_minutes: 0, allocated_hours: 8, note: null, switch_requested: switchRequested });
const sw: GiveUp = { mode: 'switch', window_days: 2 };

function setup(shift: MyShift, giveUp: GiveUp) {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const onChanged = vi.fn(async () => {});
  render(<FeedbackProvider><GiveUpButton shift={shift} giveUp={giveUp} zone="UTC" onChanged={onChanged} /></FeedbackProvider>);
  return { fetchMock, onChanged };
}

describe('GiveUpButton', () => {
  it('asks to confirm, then requests cover', async () => {
    const { fetchMock, onChanged } = setup(mine(), sw);
    fireEvent.click(screen.getByRole('button', { name: /^Ask for cover for shift .*\d\d:\d\d-\d\d:\d\d$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for cover' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([path, init.method, JSON.parse(String(init.body))]).toEqual(['/api/switch-requests', 'POST', { shift_id: 'm1' }]);
    expect(await screen.findByText('Shift is up for switch.')).toBeTruthy();
  });

  it('does nothing when the confirmation is declined', async () => {
    const { fetchMock, onChanged } = setup(mine(), sw);
    fireEvent.click(screen.getByRole('button', { name: /^Ask for cover/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('withdraws a switch request with DELETE', async () => {
    const { fetchMock, onChanged } = setup(mine(true), sw);
    fireEvent.click(screen.getByRole('button', { name: /^Withdraw switch request/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([path, init.method]).toEqual(['/api/switch-requests/m1', 'DELETE']);
  });

  it('gives a shift up in Unassign mode', async () => {
    const { fetchMock, onChanged } = setup(mine(), { mode: 'unassign', window_days: 2 });
    fireEvent.click(screen.getByRole('button', { name: /^Give up shift/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Give up' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([path, init.method, JSON.parse(String(init.body))]).toEqual(['/api/unassignments', 'POST', { shift_id: 'm1' }]);
  });

  it('renders nothing inside the Unassign window', () => {
    const soon = { ...mine(), start_at: new Date(Date.now() + 86_400_000).toISOString() };
    setup(soon, { mode: 'unassign', window_days: 2 });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the toast for a failed request and still reloads', async () => {
    const { onChanged } = setup(mine(), sw);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'TOO_LATE', message: 'Too late to switch.', details: null } }), { status: 409 })));
    fireEvent.click(screen.getByRole('button', { name: /^Ask for cover/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for cover' }));
    expect(await screen.findByText('Too late to switch.')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('is disabled while the request is in flight', async () => {
    const { onChanged } = setup(mine(), sw);
    let finish!: () => void;
    onChanged.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pageButton = () => screen.getByRole('button', { name: /^Ask for cover for shift/ }) as HTMLButtonElement;
    fireEvent.click(pageButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for cover' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(pageButton().disabled).toBe(true);
    finish();
    await waitFor(() => expect(pageButton().disabled).toBe(false));
  });

  it('explains why Unassign is unavailable inside the window, but says nothing for started shifts', () => {
    const soon = { ...mine(), start_at: new Date(Date.now() + 86_400_000).toISOString() };
    setup(soon, { mode: 'unassign', window_days: 2 });
    expect(screen.getByText('Can only be given up more than 2 days ahead.')).toBeTruthy();
    cleanup();
    setup({ ...mine(), start_at: new Date(Date.now() - 3_600_000).toISOString() }, { mode: 'unassign', window_days: 2 });
    expect(screen.queryByText(/Already started/)).toBeNull();
  });
});
