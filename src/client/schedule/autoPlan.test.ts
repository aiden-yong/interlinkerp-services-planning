import { describe, expect, it } from 'vitest';
import type { AutoPlanReport } from '../types';
import { describeAutoPlan } from './autoPlan';
import { employee, payload, shift } from './testData';

const zone = 'Asia/Kuala_Lumpur';
const data = payload({
  roles: [{ id: 'tech', name: 'Technician', color: '#22C55E', archived: false }],
  employees: [employee()],
  shifts: [shift({ id: 'a', role_id: 'tech' }), shift({ id: 'b', role_id: null, start_at: '2026-10-15T01:00:00Z', end_at: '2026-10-15T05:30:00Z' })],
});
const report = (over: Partial<AutoPlanReport> = {}): AutoPlanReport => ({ filled: [], unfilled: [], skipped_published: [], skipped_changed: [], ...over });

describe('describeAutoPlan', () => {
  it('summarises filled and unfilled shifts with names and reasons', () => {
    const out = describeAutoPlan(report({
      filled: [{ shift_id: 'a', employee_ref: 'E1' }],
      unfilled: [{ shift_id: 'b', reason_code: 'NO_ROLE', reason: 'No one on the roster has this role' }, { shift_id: 'gone', reason_code: 'X', reason: 'Changed while Auto Plan ran' }],
    }), data, zone);
    expect(out.heading).toBe('Filled 1 of 3 open shifts');
    expect(out.filled).toEqual(['Wed 14 Oct 09:00–17:00 · Technician → Ana Lim']);
    expect(out.unfilled).toEqual(['Thu 15 Oct 09:00–13:30 · No role · No one on the roster has this role', 'Shift · Changed while Auto Plan ran']);
  });

  it('adds notes only for non-zero skips', () => {
    expect(describeAutoPlan(report(), data, zone).notes).toEqual([]);
    expect(describeAutoPlan(report({ skipped_published: ['a', 'b'], skipped_changed: ['c'] }), data, zone).notes).toEqual([
      '2 published open shifts were left for employees to claim.', '1 shift changed while Auto Plan ran and was skipped.',
    ]);
  });
});
