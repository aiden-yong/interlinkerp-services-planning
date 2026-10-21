import { describe, expect, it } from 'vitest';
import type { Template } from '../types';
import { applyTemplate, templatesFor } from './templates';
import type { ShiftForm } from './shiftForm';

function template(overrides: Partial<Template> = {}): Template {
  return { id: 't1', name: 'Night shift', role_id: null, start_time: '09:00', duration_minutes: 480, break_minutes: 30, ...overrides };
}

function form(overrides: Partial<ShiftForm> = {}): ShiftForm {
  return {
    employee_ref: '', role_id: '', start_date: '2026-10-14', start_time: '', end_date: '', end_time: '',
    break_minutes: '0', allocated_percent: '100', note: '',
    repeat: '', repeat_interval: '1', repeat_ends: 'never', repeat_until: '', repeat_count: '',
    ...overrides,
  };
}

describe('templatesFor', () => {
  it("offers templates for the employee's roles and role-less ones", () => {
    const roleA = template({ id: 'a', role_id: 'A' });
    const roleless = template({ id: 'none', role_id: null });
    const roleB = template({ id: 'b', role_id: 'B' });
    const all = [roleA, roleless, roleB];

    expect(templatesFor(all, ['A'])).toEqual([roleA, roleless]);
    expect(templatesFor(all, [])).toEqual(all);
  });
});

describe('applyTemplate', () => {
  it('sets the end to start + duration + break (FR-TPL-02)', () => {
    const t = template({ start_time: '22:00', duration_minutes: 480, break_minutes: 30 });
    const f = form({ start_date: '2026-10-14' });
    const result = applyTemplate(f, t, 'Asia/Kuala_Lumpur');
    expect(result.start_time).toBe('22:00');
    expect(result.end_date).toBe('2026-10-15');
    expect(result.end_time).toBe('06:30');
  });
});
