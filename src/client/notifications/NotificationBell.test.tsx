import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

const rejections: unknown[] = [];
const onRejection = (reason: unknown) => rejections.push(reason);
const realLocation = window.location;
const assign = vi.fn();

beforeEach(() => {
  rejections.length = 0;
  assign.mockClear();
  process.on('unhandledRejection', onRejection);
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  process.off('unhandledRejection', onRejection);
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

const tick = () => new Promise((r) => setTimeout(r, 20));

const payload = (unread: number) => ({
  notifications: [{ id: 7, kind: 'shift_assigned', title: 'You have a new shift', body: 'Wed 14 Oct, 09:00–17:00', link: 'https://planning.example.com/my?week=2026-10-12', shift_id: null, created_at: '2026-10-13T02:00:00Z', read_at: null }],
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
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    await tick();
    expect(screen.queryByText('You have a new shift')).toBeNull();
    expect(screen.queryByText('Nothing yet.')).toBeNull();
    expect(rejections).toEqual([]);
  });

  it('marks an unread item read then navigates to its link', async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? { marked: 1 } : payload(1)), { status: init?.method === 'POST' ? 201 : 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(screen.getByText('You have a new shift'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/my?week=2026-10-12'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect([post[0], JSON.parse(String(post[1]!.body))]).toEqual(['/api/notification-reads', { ids: [7] }]);
  });

  it('still navigates when marking read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('', { status: 500 }) : new Response(JSON.stringify(payload(1)), { status: 200 })));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(screen.getByText('You have a new shift'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/my?week=2026-10-12'));
    await tick();
    expect(rejections).toEqual([]);
  });

  it('closes on Escape and returns focus to the bell', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload(1)), { status: 200 })));
    render(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fireEvent.click(bell);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it('closes on an outside click but not an inside one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload(1)), { status: 200 })));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.pointerDown(screen.getByText('You have a new shift'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('caps the badge at 99+', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload(150)), { status: 200 })));
    render(<NotificationBell />);
    await screen.findByRole('button', { name: 'Notifications, 150 unread' });
    expect(document.querySelector('.bell-count')?.textContent).toBe('99+');
  });

  it('loads older notices page by page, then hides the button (backlog item 27)', async () => {
    const item = (id: number) => ({ ...payload(0).notifications[0], id, title: `Notice ${id}`, read_at: '2026-10-13T03:00:00Z' });
    const first = Array.from({ length: 50 }, (_, i) => item(200 - i));
    const second = [item(150), item(149)];
    const fetchMock = vi.fn(async (path: string) =>
      new Response(JSON.stringify({ notifications: path.includes('before=151') ? second : first, unread_count: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(screen.getByText('Notice 149')).toBeTruthy());
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain('/api/notifications?before=151');
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });
});
