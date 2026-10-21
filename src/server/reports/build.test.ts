import { describe, expect, it } from 'vitest';
import { parseWorkingHours } from '../domain/workingHours';
import { localMidnight } from '../support/time';
import { openShifts, plannedHours, utilisation, type ReportData, type ReportShift } from './build';
import type { ReportEmployee } from './hours';

const ZONE = 'Asia/Kuala_Lumpur';
const period = (from: string, to: string) => ({ from: localMidnight(from, ZONE), to: localMidnight(to, ZONE), viewZone: ZONE });

const employee = (ref: string, over: Partial<ReportEmployee> = {}): ReportEmployee => ({
  ref, name: ref, onRoster: true, departmentId: null, departmentName: null, zone: ZONE, workingHours: null, roleIds: [], defaultRoleId: null, away: [], ...over,
});

let n = 0;
const shift = (employeeRef: string | null, start: string, hours: number, over: Partial<ReportShift> = {}): ReportShift => {
  const s = new Date(`${start}:00+08:00`);
  return { id: `s${++n}`, employeeRef, roleId: null, start: s, end: new Date(s.getTime() + hours * 3_600_000), breakMinutes: 0, percent: 100, state: 'draft', ...over };
};

const data = (over: Partial<ReportData>): ReportData => ({
  period: period('2026-10-12', '2026-10-19'), orgZone: ZONE, shifts: [], employees: [],
  roles: [{ id: 'A', name: 'Barista' }, { id: 'B', name: 'Cook' }], ...over,
});

describe('plannedHours', () => {
  it('groups draft and published hours by role, with open shifts inside their role', () => {
    const d = data({
      employees: [employee('E1')],
      shifts: [
        shift('E1', '2026-10-12T09:00', 8, { roleId: 'A' }),
        shift('E1', '2026-10-13T09:00', 4, { roleId: 'A', state: 'published' }),
        shift(null, '2026-10-13T09:00', 2, { roleId: 'A' }),
        shift(null, '2026-10-14T09:00', 3),
      ],
    });
    const { rows, totals } = plannedHours(d, 'role', 'none');
    expect(rows).toEqual([
      { key: 'A', label: 'Barista', left: false, draft_hours: 10, published_hours: 4, total_hours: 14, shifts: 3 },
      { key: 'none', label: 'No role', left: false, draft_hours: 3, published_hours: 0, total_hours: 3, shifts: 1 },
    ]);
    expect(totals).toEqual({ draft_hours: 13, published_hours: 4, total_hours: 17, shifts: 4 });
  });

  it('puts employees without a department under No department', () => {
    const d = data({
      employees: [employee('E1', { departmentId: 'D1', departmentName: 'Front' }), employee('E2')],
      shifts: [shift('E1', '2026-10-12T09:00', 1), shift('E2', '2026-10-12T09:00', 2)],
    });
    expect(plannedHours(d, 'department', 'none').rows.map((r) => [r.key, r.label, r.total_hours])).toEqual([['D1', 'Front', 1], ['none', 'No department', 2]]);
  });

  it('lists open shifts first and marks employees who left', () => {
    const d = data({
      employees: [employee('E1', { name: 'Zed' }), employee('E2', { name: 'Ann', onRoster: false })],
      shifts: [shift('E1', '2026-10-12T09:00', 1), shift('E2', '2026-10-12T09:00', 1), shift(null, '2026-10-12T09:00', 1)],
    });
    expect(plannedHours(d, 'employee', 'none').rows.map((r) => [r.key, r.label, r.left])).toEqual([['open', 'Open shifts', false], ['E2', 'Ann', true], ['E1', 'Zed', false]]);
  });

  it('buckets by month', () => {
    const d = data({
      period: period('2026-10-30', '2026-11-03'),
      employees: [employee('E1')],
      shifts: [shift('E1', '2026-10-31T09:00', 2), shift('E1', '2026-11-01T09:00', 3, { state: 'published' })],
    });
    const [row] = plannedHours(d, 'employee', 'month').rows;
    expect(row.months).toEqual([
      { month: '2026-10', draft_hours: 2, published_hours: 0, total_hours: 2, shifts: 1 },
      { month: '2026-11', draft_hours: 0, published_hours: 3, total_hours: 3, shifts: 1 },
    ]);
  });
});

describe('plannedHours margins', () => {
  it('makes no row for shifts wholly outside the period', () => {
    const d = data({
      employees: [employee('E1', { departmentId: 'D1', departmentName: 'Front' })],
      shifts: [shift('E1', '2026-10-09T09:00', 4, { roleId: 'A' }), shift(null, '2026-10-09T09:00', 4, { roleId: 'B' })],
    });
    expect(plannedHours(d, 'role', 'none').rows).toEqual([]);
    expect(plannedHours(d, 'department', 'none').rows).toEqual([]);
  });
});

describe('utilisation', () => {
  const weekdays = parseWorkingHours({ mon: [['09:00', '17:00']], tue: [['09:00', '17:00']] });

  it('lists flexible employees with no utilisation and never over-allocated', () => {
    const d = data({ employees: [employee('E1')], shifts: [shift('E1', '2026-10-12T09:00', 12)] });
    expect(utilisation(d, 'none')).toEqual([
      { employee_ref: 'E1', name: 'E1', left: false, flexible: true, allocated_hours: 12, available_hours: null, utilisation_percent: null, over_allocated_days: [] },
    ]);
  });

  it('shows a dash and over-allocation for 0 available hours', () => {
    const d = data({ employees: [employee('E1', { workingHours: weekdays })], shifts: [shift('E1', '2026-10-12T09:00', 4)] });
    expect(utilisation(d, 'none')[0]).toMatchObject({ allocated_hours: 4, available_hours: 16, utilisation_percent: 25, over_allocated_days: [] });
    const none = data({ employees: [employee('E1', { workingHours: parseWorkingHours({}) })], shifts: [shift('E1', '2026-10-17T09:00', 4)] });
    expect(utilisation(none, 'none')[0]).toMatchObject({ allocated_hours: 4, available_hours: 0, utilisation_percent: null, over_allocated_days: ['2026-10-17'] });
  });

  it('sorts over-allocated employees first, then by utilisation', () => {
    const d = data({
      employees: ['A', 'B', 'C', 'D'].map((ref) => employee(ref, { workingHours: weekdays })),
      shifts: [shift('A', '2026-10-12T09:00', 2), shift('B', '2026-10-12T09:00', 8), shift('C', '2026-10-12T09:00', 6), shift('C', '2026-10-12T15:00', 6)],
    });
    expect(utilisation(d, 'none').map((r) => r.employee_ref)).toEqual(['C', 'B', 'A', 'D']);
  });

  it('buckets by month', () => {
    const d = data({ period: period('2026-10-26', '2026-11-03'), employees: [employee('E1', { workingHours: weekdays })], shifts: [shift('E1', '2026-10-26T09:00', 4)] });
    const [row] = utilisation(d, 'month');
    expect(row.months?.map((m) => m.month)).toEqual(['2026-10', '2026-11']);
    expect(row.months?.[0]).toMatchObject({ allocated_hours: 4, over_allocated: false });
  });
});

describe('openShifts', () => {
  const d = data({
    employees: [employee('E1')],
    shifts: [
      shift(null, '2026-10-13T09:00', 4, { roleId: 'A', state: 'published' }),
      shift(null, '2026-10-13T13:00', 4, { roleId: 'A' }),
      shift('E1', '2026-10-13T09:00', 4, { roleId: 'A', state: 'published' }),
      shift(null, '2026-10-14T09:00', 4),
    ],
  });

  it('counts open over total per role per day, and only published when asked', () => {
    const all = openShifts(d, false);
    expect(all.days).toHaveLength(7);
    expect(all.rows.find((r) => r.role_id === 'A')!.cells['2026-10-13']).toEqual({ open: 2, total: 3 });
    expect(all.rows.find((r) => r.role_id === null)).toMatchObject({ label: 'No role', cells: { '2026-10-14': { open: 1, total: 1 } } });
    expect(all.totals['2026-10-13']).toEqual({ open: 2, total: 3 });
    expect(all.rows.map((r) => r.label)).toEqual(['Barista', 'No role']);
    const published = openShifts(d, true);
    expect(published.rows.map((r) => r.role_id)).toEqual(['A']);
    expect(published.rows[0].cells['2026-10-13']).toEqual({ open: 1, total: 2 });
  });
});
