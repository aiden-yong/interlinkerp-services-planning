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
    const fetchMock = vi.fn(async (path: string) => (path === '/api/shift-templates'
      ? new Response(JSON.stringify({ templates: [] }), { status: 200 })
      : new Response(JSON.stringify({ published: 1, employees_notified: 1 }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { onClose, onSaved } = dialog(shift());

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const question = await screen.findByRole('dialog', { name: 'Publish this shift?' });
    fireEvent.click(question.querySelector<HTMLButtonElement>('button.primary')!);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const publishCall = fetchMock.mock.calls.find(([path]) => path === '/api/publications')! as unknown as [string, RequestInit];
    const [path, init] = publishCall;
    expect([path, init.method, JSON.parse(String(init.body))]).toEqual(['/api/publications', 'POST', { shift_ids: ['s1'] }]);
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Shift published.')).toBeTruthy();
  });

  it('publishes nothing when the manager cancels', async () => {
    const fetchMock = vi.fn(async (path: string) => (path === '/api/shift-templates'
      ? new Response(JSON.stringify({ templates: [] }), { status: 200 })
      : new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);
    dialog(shift());
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const question = await screen.findByRole('dialog', { name: 'Publish this shift?' });
    fireEvent.click(Array.from(question.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Publish this shift?' })).toBeNull());
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/publications')).toBe(false);
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
    const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => (path === '/api/shift-templates'
      ? new Response(JSON.stringify({ templates: [] }), { status: 200 })
      : new Response(JSON.stringify({ shift: shift() }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const seriesShift = shift({ recurrence: { id: 'r1', interval: 1, unit: 'week', ends: 'never', until_date: null, count: null, index: 0, detached: false } });
    dialog(seriesShift);

    fireEvent.change(screen.getByLabelText('Note for the employee'), { target: { value: 'Updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const question = await screen.findByRole('dialog', { name: 'Change a repeated shift' });
    expect(Array.from(question.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Cancel', 'This shift', 'This and following', 'All']);
    fireEvent.click(Array.from(question.querySelectorAll('button')).find((b) => b.textContent === 'All')!);

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse(String(patch[1]!.body));
    expect(body.scope).toBe('all');
    expect(body.note).toBe('Updated note');
  });

  it('never offers "Does not repeat" for an existing series shift, since nothing can act on it', () => {
    const seriesShift = shift({ recurrence: { id: 'r1', interval: 1, unit: 'week', ends: 'never', until_date: null, count: null, index: 0, detached: false } });
    dialog(seriesShift);
    expect(screen.queryByRole('option', { name: /does not repeat/i })).toBeNull();
  });

  it('offers "Does not repeat" for a brand-new shift', () => {
    const data = payload({ employees: [employee()] });
    render(
      <FeedbackProvider>
        <ShiftDialog data={data} shift={null} initial={{ ...shiftToForm(shift(), data.period.timezone), repeat: '' }} onClose={() => {}} onSaved={async () => {}} />
      </FeedbackProvider>,
    );
    expect(screen.getByRole('option', { name: /does not repeat/i })).toBeTruthy();
  });

  it('applies a chosen template to the start time, end time and break', async () => {
    const fetchMock = vi.fn(async (path: string) => (path === '/api/shift-templates'
      ? new Response(JSON.stringify({ templates: [{ id: 't1', name: 'Night shift', role_id: null, start_time: '22:00', duration_minutes: 480, break_minutes: 30 }] }), { status: 200 })
      : new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);
    dialog(shift());

    const select = await screen.findByLabelText('Template');
    fireEvent.change(select, { target: { value: 't1' } });

    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('22:00');
    expect((screen.getByLabelText('Break (minutes)') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('End time') as HTMLInputElement).value).toBe('06:30');
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-10-15');
  });

  it('saves the current shift as a template without closing the dialog', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => (path === '/api/shift-templates'
      ? new Response(JSON.stringify(init?.method === 'POST' ? { template: { id: 't2' } } : { templates: [] }), { status: init?.method === 'POST' ? 201 : 200 })
      : new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);
    const { onClose, onSaved } = dialog(shift());

    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    const nameInput = screen.getByLabelText('Template name');
    fireEvent.change(nameInput, { target: { value: 'My template' } });
    fireEvent.click(nameInput.closest('form')!.querySelectorAll('button.primary')[0] as HTMLButtonElement);

    await screen.findByText('Saved as template.');
    const post = fetchMock.mock.calls.find(([p, i]) => p === '/api/shift-templates' && (i as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ name: 'My template', from_shift_id: 's1' });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('splits a shift at a chosen time and closes the dialog', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/shift-templates') return new Response(JSON.stringify({ templates: [] }), { status: 200 });
      if (path === '/api/shift-splits') return new Response(JSON.stringify({ shifts: [shift(), shift({ id: 's2' })] }), { status: 201 });
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onClose, onSaved } = dialog(shift());

    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    fireEvent.change(screen.getByLabelText('Split at'), { target: { value: '13:00' } }); // the shift runs 09:00-17:00 local
    fireEvent.click(screen.getByRole('button', { name: 'Split here' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([p, i]) => p === '/api/shift-splits' && (i as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ shift_id: 's1', version: 1, at: '2026-10-14T05:00:00Z' });
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Shift split into two.')).toBeTruthy();
  });

  it('splits an overnight shift on the next day when the time is earlier than its start', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/shift-templates') return new Response(JSON.stringify({ templates: [] }), { status: 200 });
      if (path === '/api/shift-splits') return new Response(JSON.stringify({ shifts: [shift(), shift({ id: 's2' })] }), { status: 201 });
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    // 22:00 on 14 Oct to 06:00 on 15 Oct, Asia/Kuala_Lumpur (+08:00)
    const { onSaved } = dialog(shift({ start_at: '2026-10-14T14:00:00Z', end_at: '2026-10-14T22:00:00Z' }));

    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    fireEvent.change(screen.getByLabelText('Split at'), { target: { value: '02:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Split here' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([p, i]) => p === '/api/shift-splits' && (i as RequestInit)?.method === 'POST')!;
    // 02:00 on 15 Oct local, not 02:00 on 14 Oct (which would be before the shift starts)
    expect(JSON.parse(String((post[1] as RequestInit).body)).at).toBe('2026-10-14T18:00:00Z');
  });
});
