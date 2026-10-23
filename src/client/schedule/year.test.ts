import { describe, expect, it } from 'vitest';
import type { PlannedHoursRow, UtilisationRow } from '../types';
import { NO_FILTERS } from './rows';
import { yearRows } from './year';

const cell = { draft_hours: 0, published_hours: 0, total_hours: 0, shifts: 0 };
const planned = (key: string, months: { month: string; draft_hours?: number; published_hours?: number; shifts?: number }[]): PlannedHoursRow => ({
  key, label: key, left: false, ...cell, months: months.map((m) => ({ ...cell, ...m, total_hours: (m.draft_hours ?? 0) + (m.published_hours ?? 0) })),
});
const util = (ref: string, name: string, over: string[] = []): UtilisationRow => ({
  employee_ref: ref, name, left: false, flexible: false, allocated_hours: 0, available_hours: null, utilisation_percent: null, over_allocated_days: [],
  months: over.map((month) => ({ month, allocated_hours: 0, available_hours: 0, over_allocated: true })),
});

describe('yearRows', () => {
  it('fills twelve months per employee, zero when no hours', () => {
    const rows = yearRows([planned('E1', [{ month: '2026-03', published_hours: 8 }])], [util('E1', 'Ana'), util('E2', 'Ben')], NO_FILTERS, 'employee', {}, 2026);
    expect(rows.map((r) => r.key)).toEqual(['open', 'E1', 'E2']);
    const ana = rows[1];
    expect(ana.months).toHaveLength(12);
    expect(ana.months[0]).toEqual({ month: '2026-01', draft: 0, published: 0, over: false });
    expect(ana.months[2]).toMatchObject({ month: '2026-03', published: 8 });
    expect(rows[2].months.every((m) => m.draft === 0 && m.published === 0)).toBe(true);
  });

  it('marks over-allocated months', () => {
    const rows = yearRows([], [util('E1', 'Ana', ['2026-05'])], NO_FILTERS, 'employee', {}, 2026);
    expect(rows[1].months.map((m) => m.over)).toEqual([false, false, false, false, true, false, false, false, false, false, false, false]);
  });

  it('applies the state filter to hours', () => {
    const p = [planned('E1', [{ month: '2026-03', draft_hours: 4, published_hours: 8 }])];
    const u = [util('E1', 'Ana')];
    expect(yearRows(p, u, { ...NO_FILTERS, state: 'draft' }, 'employee', {}, 2026)[1].months[2]).toMatchObject({ draft: 4, published: 0 });
    expect(yearRows(p, u, { ...NO_FILTERS, state: 'published' }, 'employee', {}, 2026)[1].months[2]).toMatchObject({ draft: 0, published: 8 });
    expect(yearRows(p, u, { ...NO_FILTERS, state: 'open' }, 'employee', {}, 2026).map((r) => r.key)).toEqual(['open']);
  });

  it('counts open shifts per month on the open row', () => {
    const rows = yearRows([planned('open', [{ month: '2026-02', draft_hours: 8, shifts: 3 }])], [util('E1', 'Ana')], NO_FILTERS, 'employee', {}, 2026);
    expect(rows[0]).toMatchObject({ key: 'open', kind: 'open' });
    expect(rows[0].months[1]).toMatchObject({ month: '2026-02', draft: 8, openCount: 3 });
    expect(rows[0].months[0].openCount).toBe(0);
  });

  it('groups by department, alphabetical with No department last, and applies name and department filters', () => {
    const departments = { E1: { id: 'd2', name: 'Sales' }, E2: { id: 'd1', name: 'Kitchen' }, E3: { id: null, name: null } };
    const u = [util('E1', 'Ana'), util('E2', 'Ben'), util('E3', 'Cy')];
    const rows = yearRows([planned('E2', [{ month: '2026-01', published_hours: 5 }])], u, NO_FILTERS, 'department', departments, 2026);
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual(['open:Open shifts', 'header:Kitchen', 'employee:Ben', 'header:Sales', 'employee:Ana', 'header:No department', 'employee:Cy']);
    expect(rows[2].months[0].published).toBe(5);
    expect(yearRows([], u, { ...NO_FILTERS, departmentId: 'd1' }, 'department', departments, 2026).map((r) => r.label)).toEqual(['Open shifts', 'Kitchen', 'Ben']);
    expect(yearRows([], u, { ...NO_FILTERS, name: 'an' }, 'employee', departments, 2026).map((r) => r.label)).toEqual(['Open shifts', 'Ana']);
  });
});
