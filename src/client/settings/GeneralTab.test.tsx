import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { Settings } from '../types';
import { GeneralTab } from './GeneralTab';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  country_code: 'MY', region_code: null, timezone: 'Asia/Kuala_Lumpur', give_up_mode: 'switch', unassign_window_days: 2, recurrence_horizon_months: 6, ...over,
});

function setup(initial: Settings, patchStatus = 200, patchBody?: unknown) {
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? new Response(JSON.stringify(patchBody ?? { settings: { ...initial, ...JSON.parse(String(init.body)) } }), { status: patchStatus })
      : new Response(JSON.stringify({ settings: initial }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<FeedbackProvider><GeneralTab /></FeedbackProvider>);
  const patches = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
  return { fetchMock, patches };
}

const pickUnassign = async () => fireEvent.click(await screen.findByRole('radio', { name: /^Unassign/ }));

describe('GeneralTab give-up mode', () => {
  it('hides the window input in Switch mode and shows it, limited to 0..60, in Unassign mode', async () => {
    setup(settings());
    await screen.findByRole('radiogroup', { name: 'Give-up mode' });
    expect(screen.queryByLabelText('Unassign window (days)')).toBeNull();
    await pickUnassign();
    const input = (await screen.findByLabelText('Unassign window (days)')) as HTMLInputElement;
    expect([input.type, input.min, input.max]).toEqual(['number', '0', '60']);
  });

  it('does not ask or send anything when the mode is not changed to Unassign', async () => {
    const { patches } = setup(settings({ give_up_mode: 'unassign', unassign_window_days: 5 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(String((patches()[0]![1] as RequestInit).body))).toMatchObject({ give_up_mode: 'unassign', unassign_window_days: 5 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends nothing when the switch to Unassign is declined (BR-07)', async () => {
    const { patches } = setup(settings());
    await pickUnassign();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Pending switch requests will be cancelled and their owners told.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patches()).toHaveLength(0);
  });

  it('saves the mode and window when the switch to Unassign is accepted', async () => {
    const { patches } = setup(settings());
    await pickUnassign();
    fireEvent.change(await screen.findByLabelText('Unassign window (days)'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Unassign' }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(String((patches()[0]![1] as RequestInit).body))).toEqual({
      country_code: 'MY', region_code: null, timezone: 'Asia/Kuala_Lumpur', give_up_mode: 'unassign', unassign_window_days: 7, recurrence_horizon_months: 6,
    });
    expect(await screen.findByText('Settings saved.')).toBeTruthy();
  });

  it('shows a 422 on the window field', async () => {
    const { patches } = setup(settings({ give_up_mode: 'unassign' }), 422, { error: { code: 'VALIDATION', message: 'Invalid settings', details: { unassign_window_days: 'Must be 0 to 60.' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be 0 to 60.')).toBeTruthy();
    expect(patches()).toHaveLength(1);
  });

  it('does not ask again after a saved Switch to Unassign change', async () => {
    const { patches } = setup(settings());
    await pickUnassign();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Unassign' }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    await screen.findByText('Settings saved.');
    fireEvent.change(screen.getByLabelText('Unassign window (days)'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(JSON.parse(String((patches()[1]![1] as RequestInit).body)).unassign_window_days).toBe(9);
  });

  it.each([['', /Required/], ['2.5', /whole number/], ['61', /0 to 60/]])('rejects the window %j without a request', async (value, message) => {
    const { patches } = setup(settings({ give_up_mode: 'unassign' }));
    const input = (await screen.findByLabelText('Unassign window (days)')) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    expect(input.value).toBe(value); // an emptied field stays empty so it can be retyped
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(patches()).toHaveLength(0);
  });

  it('names the mode control once', async () => {
    setup(settings());
    await screen.findByRole('radiogroup', { name: 'Give-up mode' });
    expect(screen.queryAllByRole('group', { name: 'Give-up mode' })).toHaveLength(0);
  });
});

describe('GeneralTab recurrence horizon', () => {
  it('loads the saved horizon and limits it to 1..24', async () => {
    setup(settings({ recurrence_horizon_months: 3 }));
    const input = (await screen.findByLabelText('Recurrence horizon (months)')) as HTMLInputElement;
    expect([input.value, input.type, input.min, input.max]).toEqual(['3', 'number', '1', '24']);
  });

  it.each([['', /Required/], ['2.5', /whole number/], ['25', /1 to 24/], ['0', /1 to 24/]])('rejects the horizon %j without a request', async (value, message) => {
    const { patches } = setup(settings());
    const input = (await screen.findByLabelText('Recurrence horizon (months)')) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(patches()).toHaveLength(0);
  });

  it('saves a changed horizon', async () => {
    const { patches } = setup(settings());
    const input = (await screen.findByLabelText('Recurrence horizon (months)')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(String((patches()[0]![1] as RequestInit).body)).recurrence_horizon_months).toBe(12);
    expect(await screen.findByText('Settings saved.')).toBeTruthy();
  });
});
