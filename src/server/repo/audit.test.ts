import { describe, expect, it } from 'vitest';
import { diffShift } from './audit';
import type { ShiftRecord } from './shifts';

const base: ShiftRecord = {
  id: '00000000-0000-4000-8000-000000000001', employeeRef: 'E1', roleId: null,
  start: new Date('2026-10-20T01:00:00Z'), end: new Date('2026-10-20T09:00:00Z'), breakMinutes: 30, percent: 100, note: null,
  state: 'draft', publishedAt: null, ackBy: null, ackAt: null, version: 1, createdBy: 'm@x.com', deletedAt: null, switchRequestedAt: null,
  recurrenceId: null, recurrenceIndex: null, recurrenceDetached: false, copiedFrom: null, remindedAt: null,
};

describe('diffShift (DR-04)', () => {
  it('returns nothing when no audited field changed', () => {
    expect(diffShift(base, { ...base, version: 2, state: 'published', start: new Date(base.start) })).toEqual({});
  });

  it('returns only the changed fields as [old, new], with instants as ISO strings', () => {
    const after: ShiftRecord = { ...base, employeeRef: null, start: new Date('2026-10-20T02:00:00Z'), breakMinutes: 0, note: 'Bring keys', version: 2 };
    expect(diffShift(base, after)).toEqual({
      employee_ref: ['E1', null],
      start_at: ['2026-10-20T01:00:00Z', '2026-10-20T02:00:00Z'],
      break_minutes: [30, 0],
      note: [null, 'Bring keys'],
    });
  });

  it('covers role, end and allocation', () => {
    const after: ShiftRecord = { ...base, roleId: 'r1', end: new Date('2026-10-20T10:00:00Z'), percent: 50 };
    expect(diffShift(base, after)).toEqual({
      role_id: [null, 'r1'], end_at: ['2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'], allocated_percent: [100, 50],
    });
  });

  it('tracks whether a conflict warning was accepted, not when', () => {
    const accepted: ShiftRecord = { ...base, ackBy: 'm@x.com', ackAt: new Date('2026-10-13T02:00:00Z') };
    expect(diffShift(base, accepted)).toEqual({ conflict_acknowledged: [false, true] });
    expect(diffShift(accepted, base)).toEqual({ conflict_acknowledged: [true, false] });
    expect(diffShift(accepted, { ...accepted, ackBy: 'n@x.com', ackAt: new Date('2026-10-14T02:00:00Z') })).toEqual({});
  });
});
