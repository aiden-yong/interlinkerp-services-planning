import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { Me } from '../types';
import { SchedulePage } from './SchedulePage';
import { employee, payload, shift } from './testData';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const me: Me = {
  name: 'Manager', email: 'm@example.test', gateway_role: 'admin', employee_ref: null, roster_status: 'not_found',
  is_manager: true, timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur',
};

function setup(publishResponse: Response) {
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === 'POST' ? publishResponse.clone() : new Response(JSON.stringify(payload({ employees: [employee()], shifts: [shift()] })), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<FeedbackProvider><SchedulePage me={me} /></FeedbackProvider>);
  const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
  return { posts };
}

async function publish() {
  await screen.findByRole('region', { name: 'Schedule' });
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish' }));
}

describe('SchedulePage publish with open-shift notices (FR-OPN-04)', () => {
  it('offers an unticked, labelled checkbox and sends notify_open_shifts false by default', async () => {
    const { posts } = setup(new Response(JSON.stringify({ published: 1, open_shift_notices: 0 }), { status: 200 }));
    const box = (await screen.findByLabelText('Tell eligible employees about open shifts')) as HTMLInputElement;
    expect([box.type, box.checked]).toEqual(['checkbox', false]);
    await publish();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String((posts()[0]![1] as RequestInit).body))).toEqual({ shift_ids: ['s1'], notify_open_shifts: false });
    expect(await screen.findByText('Published 1 shift.')).toBeTruthy();
  });

  it('sends notify_open_shifts true when ticked and reports the notices', async () => {
    const { posts } = setup(new Response(JSON.stringify({ published: 1, open_shift_notices: 3 }), { status: 200 }));
    fireEvent.click(await screen.findByLabelText('Tell eligible employees about open shifts'));
    await publish();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String((posts()[0]![1] as RequestInit).body)).notify_open_shifts).toBe(true);
    expect(await screen.findByText('Published 1 shift. 3 employees told about open shifts.')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Tell eligible employees about open shifts') as HTMLInputElement).checked).toBe(false));
  });

  it('keeps the existing error handling when the publish call fails', async () => {
    const { posts } = setup(new Response(JSON.stringify({ error: { code: 'BOOM', message: 'Publishing failed.' } }), { status: 500 }));
    fireEvent.click(await screen.findByLabelText('Tell eligible employees about open shifts'));
    await publish();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(await screen.findByText('Publishing failed.')).toBeTruthy();
    expect((screen.getByLabelText('Tell eligible employees about open shifts') as HTMLInputElement).checked).toBe(true);
  });
});
