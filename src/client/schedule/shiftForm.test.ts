import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { FIELD_FOR, formToBody, saveShift, shiftToForm } from './shiftForm';
import { shift } from './testData';

const zone = 'Asia/Kuala_Lumpur';

vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>();
  return { ...actual, api: vi.fn() };
});
const { api } = await import('../api');

describe('shift form', () => {
  it('round-trips a shift through the form in the organisation time zone', () => {
    const form = shiftToForm(shift({ note: 'Bring keys', break_minutes: 30, allocated_percent: 50 }), zone);
    expect(form).toMatchObject({ employee_ref: 'E1', start_date: '2026-10-14', start_time: '09:00', end_date: '2026-10-14', end_time: '17:00', break_minutes: '30', allocated_percent: '50', note: 'Bring keys' });
    expect(formToBody(form, zone)).toEqual({
      employee_ref: 'E1', role_id: null, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z', break_minutes: 30, allocated_percent: 50, note: 'Bring keys',
    });
  });

  it('treats an empty employee as an open shift and an empty note as none', () => {
    const body = formToBody({ ...shiftToForm(shift(), zone), employee_ref: '', note: '  ' }, zone);
    expect([body.employee_ref, body.note]).toEqual([null, null]);
  });

  it('maps API field errors onto inputs', () => {
    expect([FIELD_FOR.start_at, FIELD_FOR.end_at, FIELD_FOR.break_minutes]).toEqual(['start_time', 'end_time', 'break_minutes']);
  });

  it('asks before saving over a conflict and resends with acknowledgement (FR-SHF-09)', async () => {
    const conflict = new ApiError(409, 'SHIFT_CONFLICT', 'Breaks a rule.', { conflicts: [{ rule: 'overlap', message: 'Overlaps.' }] }, 'c');
    vi.mocked(api).mockRejectedValueOnce(conflict).mockResolvedValueOnce({ shift: shift() });
    const confirm = vi.fn(async () => true);

    expect(await saveShift('POST', '/api/shifts', { a: 1 }, confirm)).toMatchObject({ id: 's1' });
    expect(confirm).toHaveBeenCalledWith('This shift breaks a planning rule', ['Overlaps.'], 'Save anyway');
    expect(vi.mocked(api).mock.calls[1][2]).toEqual({ a: 1, acknowledge_conflicts: true });

    vi.mocked(api).mockRejectedValueOnce(conflict);
    expect(await saveShift('POST', '/api/shifts', { a: 1 }, async () => false)).toBeNull();
  });

  it('resends without asking when every conflict is already known, and asks when one is new', async () => {
    const conflict = (...messages: string[]) => new ApiError(409, 'SHIFT_CONFLICT', 'x', { conflicts: messages.map((message) => ({ rule: 'r', message })) }, 'c');
    const confirm = vi.fn(async () => false);
    vi.mocked(api).mockReset();
    vi.mocked(api).mockRejectedValueOnce(conflict('Overlaps.')).mockResolvedValueOnce({ shift: shift() });
    expect(await saveShift('PATCH', '/api/shifts/s1', { a: 1 }, confirm, ['Overlaps.'])).toMatchObject({ id: 's1' });
    expect(confirm).not.toHaveBeenCalled();
    expect(vi.mocked(api).mock.calls[1][2]).toEqual({ a: 1, acknowledge_conflicts: true });

    vi.mocked(api).mockReset();
    vi.mocked(api).mockRejectedValueOnce(conflict('Overlaps.', 'Too long.'));
    expect(await saveShift('PATCH', '/api/shifts/s1', { a: 1 }, confirm, ['Overlaps.'])).toBeNull();
    expect(confirm).toHaveBeenCalledWith('This shift breaks a planning rule', ['Overlaps.', 'Too long.'], 'Save anyway');
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });
});
