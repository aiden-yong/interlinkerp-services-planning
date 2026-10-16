import type { ScheduleEmployee, SchedulePayload, Shift } from '../types';

export const employee = (over: Partial<ScheduleEmployee> = {}): ScheduleEmployee => ({
  employee_ref: 'E1', name: 'Ana Lim', photo_url: null, department_id: null, department_name: null, status: 'Active', on_roster: true,
  role_ids: [], default_role_id: null, timezone: 'Asia/Kuala_Lumpur', flexible: true, allocated_hours: 0, available_hours: null,
  over_allocated_days: [], working_intervals: [], unavailable: [], ...over,
});

export const shift = (over: Partial<Shift> = {}): Shift => ({
  id: 's1', employee_ref: 'E1', role_id: null, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z', break_minutes: 0,
  allocated_percent: 100, allocated_hours: 8, note: null, state: 'draft', published_at: null, version: 1, conflicts: [], conflict_acknowledged: false, switch_requested: false, ...over,
});

export const payload = (over: Partial<SchedulePayload> = {}): SchedulePayload => ({
  period: { from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Kuala_Lumpur', from_at: '2026-10-11T16:00:00Z', to_at: '2026-10-18T16:00:00Z' },
  directory_stale: false, roles: [], employees: [], shifts: [], ...over,
});
