'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { Modal, useFeedback } from '../feedback';
import type { SchedulePayload, Shift } from '../types';
import { FIELD_FOR, formToBody, saveShift, SCOPE_OPTIONS, STALE_MESSAGE, type ShiftForm } from './shiftForm';
import { FieldError, FormError, invalid } from '../fields';

interface Props {
  data: SchedulePayload;
  shift: Shift | null;
  initial: ShiftForm;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ShiftDialog({ data, shift, initial, onClose, onSaved }: Props) {
  const { confirm, choose, toast } = useFeedback();
  const [form, setForm] = useState<ShiftForm>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ShiftForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const zone = data.period.timezone;
  const roles = data.roles.filter((r) => !r.archived || r.id === initial.role_id);
  const set = (patch: Partial<ShiftForm>) => setForm((f) => ({ ...f, ...patch }));

  function changeEmployee(ref: string) {
    // FR-SHF-01 AC2: a new shift takes the employee's default role.
    set(shift ? { employee_ref: ref } : { employee_ref: ref, role_id: data.employees.find((e) => e.employee_ref === ref)?.default_role_id ?? '' });
  }

  async function done(text?: string, action?: { label: string; run: () => Promise<void> }) {
    onClose();
    if (text) toast(text, action, action ? undefined : 4000);
    await onSaved();
  }

  async function guarded(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STALE_SHIFT') {
        onClose();
        await onSaved();
        toast(STALE_MESSAGE, undefined, 6000);
      } else {
        setMessage((error as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    const missing: Partial<Record<keyof ShiftForm, string>> = {};
    for (const name of ['start_date', 'start_time', 'end_date', 'end_time'] as const) if (!form[name]) missing[name] = 'Required.';
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }
    await guarded(async () => {
      try {
        const body: Record<string, unknown> = { ...formToBody(form, zone), ...(shift ? { version: shift.version } : {}) };
        const patternChanged = shift !== null && (
          form.repeat !== initial.repeat || form.repeat_interval !== initial.repeat_interval ||
          form.repeat_ends !== initial.repeat_ends || form.repeat_until !== initial.repeat_until || form.repeat_count !== initial.repeat_count
        );
        if (shift !== null && !patternChanged) delete body.repeat;
        if (shift !== null && shift.recurrence !== null) {
          const offered = patternChanged ? SCOPE_OPTIONS.filter((o) => o.value !== 'this') : SCOPE_OPTIONS;
          const scope = await choose('Change a repeated shift', [], offered);
          if (scope === null) return;
          body.scope = scope;
        }
        const saved = await saveShift(shift ? 'PATCH' : 'POST', shift ? `/api/shifts/${shift.id}` : '/api/shifts', body, confirm, shift?.conflicts.map((c) => c.message));
        if (saved) await done(shift ? 'Shift saved.' : 'Shift created as a draft.');
      } catch (error) {
        if (error instanceof RangeError) {
          setErrors({ start_date: 'Enter a valid date and time.', end_date: 'Enter a valid date and time.' });
        } else if (error instanceof ApiError && error.code === 'VALIDATION_ERROR' && error.details && typeof error.details === 'object') {
          const next: Partial<Record<keyof ShiftForm, string>> = {};
          for (const [field, text] of Object.entries(error.details as Record<string, string>)) {
            if (FIELD_FOR[field]) next[FIELD_FOR[field]] = text;
            else setMessage(text);
          }
          setErrors(next);
        } else {
          throw error;
        }
      }
    });
  }

  async function remove() {
    if (!shift) return;
    await guarded(async () => {
      if (shift.recurrence !== null) {
        const scope = await choose('Delete a repeated shift', [], SCOPE_OPTIONS);
        if (scope === null) return;
        if (scope === 'this') {
          await api('DELETE', `/api/shifts/${shift.id}`);
          await done('Shift deleted.', {
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
          return;
        }
        const result = await api<{ deleted: number }>('DELETE', `/api/shifts/${shift.id}?scope=${scope}`);
        await done(`Deleted ${result.deleted} shifts.`);
        return;
      }
      const lines = shift.state === 'published' ? ['The employee will be told unless you undo within 10 seconds.'] : [];
      if (!(await confirm('Delete this shift?', lines, 'Delete'))) return;
      await api('DELETE', `/api/shifts/${shift.id}`);
      await done('Shift deleted.', {
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
    });
  }

  async function duplicate() {
    if (!shift) return;
    await guarded(async () => {
      const copy = await saveShift('POST', '/api/shifts', { duplicate_of: shift.id }, confirm);
      if (copy) await done('Shift duplicated to the next day as a draft.');
    });
  }

  async function publish() {
    if (!shift) return;
    await guarded(async () => {
      const lines = [
        ...(shift.employee_ref ? ['The employee will be told about this shift.'] : ['This open shift will become visible.']),
        ...(JSON.stringify(form) !== JSON.stringify(initial) ? ['Changes you have not saved will be discarded.'] : []),
      ];
      if (!(await confirm('Publish this shift?', lines, 'Publish'))) return;
      await api('POST', '/api/publications', { shift_ids: [shift.id] });
      await done('Shift published.');
    });
  }

  const field = (name: keyof ShiftForm) => <FieldError id={`shift-${name}-error`} message={errors[name]} />;
  const aria = (name: keyof ShiftForm) => invalid(errors[name], `shift-${name}-error`);

  return (
    <Modal title={shift ? 'Edit shift' : 'New shift'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {shift && shift.conflicts.length > 0 && <ul className="form-error">{shift.conflicts.map((c) => <li key={c.message}>{c.message}</li>)}</ul>}
        <div className="form-grid">
          <label className="wide">Employee
            <select {...aria('employee_ref')} value={form.employee_ref} onChange={(e) => changeEmployee(e.target.value)}>
              <option value="">Open shift (nobody yet)</option>
              {data.employees.filter((e) => e.on_roster || e.employee_ref === initial.employee_ref).map((e) => <option key={e.employee_ref} value={e.employee_ref}>{e.name}</option>)}
            </select>{field('employee_ref')}
          </label>
          <label className="wide">Role
            <select {...aria('role_id')} value={form.role_id} onChange={(e) => set({ role_id: e.target.value })}>
              <option value="">No role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>{field('role_id')}
          </label>
          <label>Start date<input type="date" required value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
          <label>Start time<input {...aria('start_time')} type="time" required value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} />{field('start_time')}</label>
          <label>End date<input type="date" required value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} /></label>
          <label>End time<input {...aria('end_time')} type="time" required value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />{field('end_time')}</label>
          <label>Break (minutes)<input {...aria('break_minutes')} type="number" min={0} max={1440} step={5} value={form.break_minutes} onChange={(e) => set({ break_minutes: e.target.value })} />{field('break_minutes')}</label>
          <label>Allocated %<input {...aria('allocated_percent')} type="number" min={1} max={100} value={form.allocated_percent} onChange={(e) => set({ allocated_percent: e.target.value })} />{field('allocated_percent')}</label>
          <label className="wide">Note for the employee<textarea {...aria('note')} rows={2} maxLength={2000} value={form.note} onChange={(e) => set({ note: e.target.value })} />{field('note')}</label>
        </div>
        {(!shift || shift.recurrence !== null) && (
          <fieldset className="form-grid">
            <legend>Repeat</legend>
            <label>Repeat
              <select value={form.repeat} onChange={(e) => set({ repeat: e.target.value as ShiftForm['repeat'] })}>
                <option value="">Does not repeat</option>
                <option value="day">Days</option>
                <option value="week">Weeks</option>
                <option value="month">Months</option>
              </select>
            </label>
            {form.repeat !== '' && (
              <>
                <label>Every
                  <input type="number" min={1} max={99} value={form.repeat_interval} onChange={(e) => set({ repeat_interval: e.target.value })} />
                </label>
                <label>Ends
                  <select value={form.repeat_ends} onChange={(e) => set({ repeat_ends: e.target.value as ShiftForm['repeat_ends'] })}>
                    <option value="never">Never</option>
                    <option value="on">On date</option>
                    <option value="after">After N shifts</option>
                  </select>
                </label>
                {form.repeat_ends === 'on' && (
                  <label>Until<input type="date" value={form.repeat_until} onChange={(e) => set({ repeat_until: e.target.value })} /></label>
                )}
                {form.repeat_ends === 'after' && (
                  <label>Shifts<input type="number" min={1} value={form.repeat_count} onChange={(e) => set({ repeat_count: e.target.value })} /></label>
                )}
              </>
            )}
          </fieldset>
        )}
        <p className="muted">Times are in {zone}.</p>
        <FormError message={message} />
        <div className="actions">
          {shift && <><button type="button" className="danger" disabled={busy} onClick={remove}>Delete</button><button type="button" disabled={busy} onClick={duplicate}>Duplicate</button>
            {shift.state === 'draft' && <button type="button" disabled={busy} onClick={publish}>Publish</button>}<span className="spacer" /></>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
