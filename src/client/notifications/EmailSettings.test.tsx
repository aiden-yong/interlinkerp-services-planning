import { StrictMode } from 'react';
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
  it('keeps what was ticked when a second load answers late, as in development', async () => {
    const answers: ((r: Response) => void)[] = [];
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => (init?.method === 'PATCH'
      ? Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
      : new Promise<Response>((resolve) => answers.push(resolve))));
    vi.stubGlobal('fetch', fetchMock);
    const reply = () => new Response(JSON.stringify({ preferences }), { status: 200, headers: { 'content-type': 'application/json' } });
    const onClose = vi.fn();
    render(<StrictMode><FeedbackProvider><EmailSettings onClose={onClose} /></FeedbackProvider></StrictMode>);
    await waitFor(() => expect(answers).toHaveLength(2)); // Strict Mode runs the effect twice
    answers[1]!(reply()); // the current load answers first
    fireEvent.click(await screen.findByRole('checkbox', { name: 'My shifts are published' }));
    answers[0]!(reply()); // then the abandoned one
    await new Promise((r) => setTimeout(r, 20));
    expect((screen.getByRole('checkbox', { name: 'My shifts are published' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
  });

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
