'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { Modal, useFeedback } from '../feedback';
import type { SchedulePayload, Shift } from '../types';
import { FIELD_FOR, formToBody, saveShift, type ShiftForm } from './shiftForm';

interface Props {
  data: SchedulePayload;
  shift: Shift | null;
  initial: ShiftForm;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ShiftDialog({ data, shift, initial, onClose, onSaved }: Props) {
  const { confirm, toast } = useFeedback();
  const [form, setForm] = useState<ShiftForm>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ShiftForm, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const zone = data.period.timezone;
  const roles = data.roles.filter((r) => !r.archived || r.id === initial.role_id);
  const set = (patch: Partial<ShiftForm>) => setForm((f) => ({ ...f, ...patch }));

  function changeEmployee(ref: string) {
    // FR-SHF-01 AC2: a new shift takes the employee's default role.
    set(shift ? { employee_ref: ref } : { employee_ref: ref, role_id: data.employees.find((e) => e.employee_ref === ref)?.default_role_id ?? '' });
  }

  async function done(text?: string) {
    onClose();
    await onSaved();
    if (text) toast(text, undefined, 4000);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    const body = { ...formToBody(form, zone), ...(shift ? { version: shift.version, ...(shift.conflict_acknowledged ? { acknowledge_conflicts: true } : {}) } : {}) };
    try {
      const saved = await saveShift(shift ? 'PATCH' : 'POST', shift ? `/api/shifts/${shift.id}` : '/api/shifts', body, confirm);
      if (saved) await done(shift ? 'Shift saved.' : 'Shift created as a draft.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR' && error.details && typeof error.details === 'object') {
        const next: Partial<Record<keyof ShiftForm, string>> = {};
        for (const [field, text] of Object.entries(error.details as Record<string, string>)) {
          if (FIELD_FOR[field]) next[FIELD_FOR[field]] = text;
          else setMessage(text);
        }
        setErrors(next);
      } else {
        setMessage((error as Error).message);
      }
    }
  }

  async function remove() {
    if (!shift) return;
    const lines = shift.state === 'published' ? ['The employee will be told unless you undo within 10 seconds.'] : [];
    if (!(await confirm('Delete this shift?', lines, 'Delete'))) return;
    try {
      await api('DELETE', `/api/shifts/${shift.id}`);
      await done();
      toast('Shift deleted.', {
        label: 'Undo',
        run: async () => {
          try {
            await api('POST', '/api/shift-restorations', { shift_id: shift.id });
            await onSaved();
          } catch (error) {
            toast((error as Error).message, undefined, 5000);
          }
        },
      });
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function duplicate() {
    if (!shift) return;
    try {
      const copy = await saveShift('POST', '/api/shifts', { duplicate_of: shift.id }, confirm);
      if (copy) await done('Shift duplicated to the next day as a draft.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  const field = (name: keyof ShiftForm) => errors[name] && <span className="field-error">{errors[name]}</span>;

  return (
    <Modal title={shift ? 'Edit shift' : 'New shift'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {shift && shift.conflicts.length > 0 && <ul className="form-error">{shift.conflicts.map((c) => <li key={c.message}>{c.message}</li>)}</ul>}
        <div className="form-grid">
          <label className="wide">Employee
            <select value={form.employee_ref} onChange={(e) => changeEmployee(e.target.value)}>
              <option value="">Open shift (nobody yet)</option>
              {data.employees.filter((e) => e.on_roster || e.employee_ref === initial.employee_ref).map((e) => <option key={e.employee_ref} value={e.employee_ref}>{e.name}</option>)}
            </select>{field('employee_ref')}
          </label>
          <label className="wide">Role
            <select value={form.role_id} onChange={(e) => set({ role_id: e.target.value })}>
              <option value="">No role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>{field('role_id')}
          </label>
          <label>Start date<input type="date" required value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
          <label>Start time<input type="time" required value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} />{field('start_time')}</label>
          <label>End date<input type="date" required value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} /></label>
          <label>End time<input type="time" required value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />{field('end_time')}</label>
          <label>Break (minutes)<input type="number" min={0} max={1440} step={5} value={form.break_minutes} onChange={(e) => set({ break_minutes: e.target.value })} />{field('break_minutes')}</label>
          <label>Allocated %<input type="number" min={1} max={100} value={form.allocated_percent} onChange={(e) => set({ allocated_percent: e.target.value })} />{field('allocated_percent')}</label>
          <label className="wide">Note for the employee<textarea rows={2} maxLength={2000} value={form.note} onChange={(e) => set({ note: e.target.value })} />{field('note')}</label>
        </div>
        {message && <p className="form-error">{message}</p>}
        <div className="actions">
          {shift && <><button type="button" className="danger" onClick={remove}>Delete</button><button type="button" onClick={duplicate}>Duplicate</button><span className="spacer" /></>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
