import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import { EmailSettings } from './EmailSettings';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preferences = [
  { kind: 'schedule_published', label: 'My shifts are published', audience: 'employee', email: true },
  { kind: 'shift_claimed', label: 'An open shift is claimed', audience: 'managers', email: false },
];

describe('EmailSettings (backlog item 29)', () => {
  it('sends only the types that changed, then closes', async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      new Response(JSON.stringify({ preferences }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(<FeedbackProvider><EmailSettings onClose={onClose} /></FeedbackProvider>);
    const published = await screen.findByRole('checkbox', { name: 'My shifts are published' });
    expect((screen.getByRole('checkbox', { name: 'An open shift is claimed' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('group', { name: 'As a Planning Manager' })).toBeTruthy();
    fireEvent.click(published);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect([patch[0], JSON.parse(String(patch[1]!.body))]).toEqual(['/api/my/notification-preferences', { email: { schedule_published: false } }]);
  });
});
