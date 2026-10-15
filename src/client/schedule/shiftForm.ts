import { api, ApiError } from '../api';
import type { Conflict, Shift } from '../types';
import { isoToWall, wallToIso } from './tz';

export interface ShiftForm {
  employee_ref: string;
  role_id: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  break_minutes: string;
  allocated_percent: string;
  note: string;
}

/** API error field -> form input. */
export const FIELD_FOR: Record<string, keyof ShiftForm> = {
  employee_ref: 'employee_ref', role_id: 'role_id', start_at: 'start_time', end_at: 'end_time',
  break_minutes: 'break_minutes', allocated_percent: 'allocated_percent', note: 'note',
};

type FormSource = Pick<Shift, 'employee_ref' | 'role_id' | 'start_at' | 'end_at' | 'break_minutes' | 'allocated_percent' | 'note'>;

export function shiftToForm(s: FormSource, zone: string): ShiftForm {
  const start = isoToWall(s.start_at, zone);
  const end = isoToWall(s.end_at, zone);
  return {
    employee_ref: s.employee_ref ?? '', role_id: s.role_id ?? '',
    start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time,
    break_minutes: String(s.break_minutes), allocated_percent: String(s.allocated_percent), note: s.note ?? '',
  };
}

export function formToBody(f: ShiftForm, zone: string): Record<string, unknown> {
  return {
    employee_ref: f.employee_ref || null,
    role_id: f.role_id || null,
    start_at: wallToIso(f.start_date, f.start_time, zone),
    end_at: wallToIso(f.end_date, f.end_time, zone),
    break_minutes: Number(f.break_minutes || 0),
    allocated_percent: Number(f.allocated_percent || 100),
    note: f.note.trim() || null,
  };
}

export const STALE_MESSAGE = 'Someone else changed that shift. The schedule has been reloaded.';

type Confirm = (title: string, lines: string[], label: string) => Promise<boolean>;

/** Saves; on SHIFT_CONFLICT asks and resends with acknowledge_conflicts (FR-SHF-09). null = the manager cancelled. */
export async function saveShift(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>, confirm: Confirm, known: string[] = []): Promise<Shift | null> {
  try {
    return (await api<{ shift: Shift }>(method, path, body)).shift;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'SHIFT_CONFLICT') throw error;
    const lines = ((error.details as { conflicts?: Conflict[] } | null)?.conflicts ?? []).map((c) => c.message);
    // Conflicts the manager already accepted on this shift do not need a second prompt.
    const allKnown = lines.length > 0 && lines.every((m) => known.includes(m));
    if (!allKnown && !(await confirm('This shift breaks a planning rule', lines, 'Save anyway'))) return null;
    return (await api<{ shift: Shift }>(method, path, { ...body, acknowledge_conflicts: true })).shift;
  }
}
