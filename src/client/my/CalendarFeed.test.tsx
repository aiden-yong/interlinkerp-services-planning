import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import { CalendarFeed } from './CalendarFeed';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(enabled: boolean) {
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ enabled: true, url: 'https://x.test/feed/abc' }), { status: 201 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ enabled }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<FeedbackProvider><CalendarFeed /></FeedbackProvider>);
  const calls = (method: string) => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === method);
  return { calls };
}

describe('CalendarFeed', () => {
  it('gets a link, shows it and resets it after a confirm', async () => {
    const { calls } = setup(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Get calendar link' }));
    const field = (await screen.findByLabelText('Calendar link')) as HTMLInputElement;
    expect([field.value, field.readOnly]).toEqual(['https://x.test/feed/abc', true]);
    expect(screen.getByText(/Paste this link into Google Calendar/)).toBeTruthy();
    expect(calls('POST')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset link' }));
    expect(await screen.findByText('The old link will stop working.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('POST')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(2));
  });

  it('says the link is on when its URL is not known, and turns it off', async () => {
    const { calls } = setup(true);
    expect(await screen.findByText('Your calendar link is on.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'Get calendar link' })).toBeTruthy();
  });
});
