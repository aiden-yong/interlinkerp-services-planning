import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const body = () => new Response(JSON.stringify(payload({ employees: [employee()], shifts: [shift()] })), { status: 200 });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const actions = ['Add shift', 'Publish', 'Copy previous week', 'Auto Plan'];

describe('SchedulePage actions while a period loads', () => {
  it('disables the actions that need the schedule until the new period has loaded', async () => {
    let release: (r: Response) => void = () => {};
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => (++calls === 1 ? Promise.resolve(body()) : new Promise<Response>((resolve) => { release = resolve; }))));
    render(<FeedbackProvider><SchedulePage me={me} /></FeedbackProvider>);
    await waitFor(() => expect(button('Add shift').disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    for (const name of actions) expect(button(name).disabled).toBe(true);

    release(body());
    await waitFor(() => expect(button('Add shift').disabled).toBe(false));
    for (const name of actions) expect(button(name).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
    expect(await screen.findByRole('dialog', { name: 'New shift' })).toBeTruthy();
  });
});
