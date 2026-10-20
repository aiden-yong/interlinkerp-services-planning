import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { Shift } from '../types';
import { ShiftDialog } from './ShiftDialog';
import { shiftToForm } from './shiftForm';
import { employee, payload, shift } from './testData';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dialog(s: Shift) {
  const data = payload({ employees: [employee()], shifts: [s] });
  const onClose = vi.fn();
  const onSaved = vi.fn(async () => {});
  render(
    <FeedbackProvider>
      <ShiftDialog data={data} shift={s} initial={shiftToForm(s, data.period.timezone)} onClose={onClose} onSaved={onSaved} />
    </FeedbackProvider>,
  );
  return { onClose, onSaved };
}

describe('ShiftDialog', () => {
  it('publishes one draft shift after confirming (FR-PUB-01)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ published: 1, employees_notified: 1 }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { onClose, onSaved } = dialog(shift());

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const question = await screen.findByRole('dialog', { name: 'Publish this shift?' });
    fireEvent.click(question.querySelector<HTMLButtonElement>('button.primary')!);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([path, init.method, JSON.parse(String(init.body))]).toEqual(['/api/publications', 'POST', { shift_ids: ['s1'] }]);
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Shift published.')).toBeTruthy();
  });

  it('publishes nothing when the manager cancels', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    dialog(shift());
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const question = await screen.findByRole('dialog', { name: 'Publish this shift?' });
    fireEvent.click(Array.from(question.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Publish this shift?' })).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers Publish only for a draft', () => {
    dialog(shift({ state: 'published', published_at: '2026-10-13T00:00:00Z' }));
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('says which time zone the times are in', () => {
    dialog(shift());
    expect(screen.getByText('Times are in Asia/Kuala_Lumpur.')).toBeTruthy();
  });

  it('asks the scope and sends it when saving an edited series shift (note changed, not the pattern)', async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      new Response(JSON.stringify({ shift: shift() }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const seriesShift = shift({ recurrence: { id: 'r1', interval: 1, unit: 'week', ends: 'never', until_date: null, count: null, index: 0, detached: false } });
    dialog(seriesShift);

    fireEvent.change(screen.getByLabelText('Note for the employee'), { target: { value: 'Updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const question = await screen.findByRole('dialog', { name: 'Change a repeated shift' });
    expect(question.querySelector('button')!.textContent).not.toBe(undefined);
    fireEvent.click(Array.from(question.querySelectorAll('button')).find((b) => b.textContent === 'All')!);

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse(String(patch[1]!.body));
    expect(body.scope).toBe('all');
    expect(body.note).toBe('Updated note');
  });
});
