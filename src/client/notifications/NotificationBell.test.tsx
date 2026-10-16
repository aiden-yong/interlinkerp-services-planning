import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const payload = (unread: number) => ({
  notifications: [{ id: 7, kind: 'shift_assigned', title: 'You have a new shift', body: 'Wed 14 Oct, 09:00–17:00', link: 'https://x/my', shift_id: null, created_at: '2026-10-13T02:00:00Z', read_at: null }],
  unread_count: unread,
});

describe('NotificationBell', () => {
  it('shows the unread count and marks everything read', async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? { marked: 1 } : payload(fetchMock.mock.calls.length > 1 ? 0 : 1)), { status: init?.method === 'POST' ? 201 : 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fireEvent.click(bell);
    expect(screen.getByText('You have a new shift')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect([post[0], JSON.parse(String(post[1]!.body))]).toEqual(['/api/notification-reads', { all: true }]);
  });

  it('stays quiet when the inbox cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    render(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
  });
});
