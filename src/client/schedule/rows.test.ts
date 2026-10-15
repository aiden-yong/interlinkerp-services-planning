import { describe, expect, it } from 'vitest';
import { buildRows, NO_FILTERS } from './rows';
import { employee, payload, shift } from './testData';

const data = payload({
  roles: [{ id: 'tech', name: 'Technician', color: '#22C55E', archived: false }],
  employees: [employee(), employee({ employee_ref: 'E2', name: 'Bo Tan', department_id: 'D2' })],
  shifts: [shift({ id: 'open', employee_ref: null }), shift({ id: 'a', role_id: 'tech', state: 'published' }), shift({ id: 'b', employee_ref: 'E2' })],
});

describe('buildRows', () => {
  it('puts open shifts first and gives every employee a row', () => {
    const rows = buildRows(data, 'employee', NO_FILTERS);
    expect(rows.map((r) => r.key)).toEqual(['open', 'E1', 'E2']);
    expect(rows[0].shifts.map((s) => s.id)).toEqual(['open']);
  });

  it('keeps every employee row under a state filter (FR-SCH-06 AC1)', () => {
    const rows = buildRows(data, 'employee', { ...NO_FILTERS, state: 'draft' });
    expect(rows.map((r) => r.key)).toEqual(['open', 'E1', 'E2']);
    expect(rows.flatMap((r) => r.shifts.map((s) => s.id))).toEqual(['open', 'b']);
  });

  it('narrows rows by name and department', () => {
    expect(buildRows(data, 'employee', { ...NO_FILTERS, name: 'bo' }).map((r) => r.key)).toEqual(['open', 'E2']);
    expect(buildRows(data, 'employee', { ...NO_FILTERS, departmentId: 'D2' }).map((r) => r.key)).toEqual(['open', 'E2']);
  });

  it('groups by role with "No role" last (FR-SCH-01 AC2)', () => {
    expect(buildRows(data, 'role', NO_FILTERS).map((r) => [r.kind, r.label])).toEqual([
      ['open', 'Open shifts'], ['header', 'Technician'], ['employee', 'Ana Lim'], ['header', 'No role'], ['employee', 'Bo Tan'],
    ]);
  });
});
