export interface Me {
  name: string | null;
  email: string | null;
  gateway_role: string | null;
  employee_ref: string | null;
  /** 'failed' means the employee roster could not be reached when Planning last asked. */
  roster_status: 'found' | 'not_found' | 'failed';
  is_manager: boolean;
  timezone: string;
  /** Local development only: show the identity picker (backlog item 32). */
  dev_identity?: boolean;
  organisation_timezone: string;
}

export interface Role { id: string; name: string; color: string; archived: boolean }
export interface Conflict { rule: 'overlap' | 'unavailable' | 'role'; message: string }

export interface Shift {
  id: string;
  employee_ref: string | null;
  role_id: string | null;
  start_at: string;
  end_at: string;
  break_minutes: number;
  allocated_percent: number;
  allocated_hours: number;
  note: string | null;
  state: 'draft' | 'published';
  published_at: string | null;
  version: number;
  conflicts: Conflict[];
  conflict_acknowledged: boolean;
  switch_requested: boolean;
}

export interface TimeSpan { start_at: string; end_at: string }
export interface Unavailable extends TimeSpan { kind: 'time_off' | 'holiday'; label: string }

export interface ScheduleEmployee {
  employee_ref: string;
  name: string;
  photo_url: string | null;
  department_id: string | null;
  department_name: string | null;
  status: string;
  on_roster: boolean;
  role_ids: string[];
  default_role_id: string | null;
  timezone: string;
  flexible: boolean;
  allocated_hours: number;
  available_hours: number | null;
  over_allocated_days: string[];
  working_intervals: TimeSpan[];
  unavailable: Unavailable[];
}

export interface SchedulePayload {
  period: { from: string; to: string; timezone: string; from_at: string; to_at: string };
  directory_stale: boolean;
  roles: Role[];
  employees: ScheduleEmployee[];
  shifts: Shift[];
}

export interface MyShift { id: string; role_id: string | null; start_at: string; end_at: string; break_minutes: number; allocated_hours: number; note: string | null; switch_requested: boolean }
export interface MyShiftsPayload { timezone: string; from: string; to: string; roles: Role[]; shifts: MyShift[] }

export interface GiveUp { mode: 'switch' | 'unassign'; window_days: number }
export interface SwitchableShift extends MyShift { owner_name: string }
export interface OpenShiftsPayload { timezone: string; from: string; to: string; give_up: GiveUp; roles: Role[]; open: MyShift[]; up_for_switch: SwitchableShift[] }

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WorkingHoursMap = Record<Weekday, [string, string][]>;

export interface EmployeeProfile {
  employee_ref: string;
  name: string;
  photo_url: string | null;
  department_id: string | null;
  department_name: string | null;
  status: string;
  role_ids: string[];
  default_role_id: string | null;
  timezone: string | null;
  effective_timezone: string;
  working_hours: WorkingHoursMap | null;
}

export interface Settings { country_code: string | null; region_code: string | null; timezone: string; give_up_mode: 'switch' | 'unassign'; unassign_window_days: number }
export interface TimeOff { id: string; employee_ref: string; start_at: string; end_at: string; reason: string }
export interface Holiday { id: string; date: string; name: string; source: 'manual' | 'provider'; hidden: boolean; edited: boolean }
export interface ManagerGrant { email: string; granted_by: string; granted_at: string }

export interface NotificationItem { id: number; kind: string; title: string; body: string; link: string; shift_id: string | null; created_at: string; read_at: string | null }
export interface NotificationsPayload { notifications: NotificationItem[]; unread_count: number }
