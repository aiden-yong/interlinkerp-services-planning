'use client';

import { type FormEvent, useState } from 'react';
import { api, query } from '../api';
import { Modal, useFeedback } from '../feedback';
import { addDays, periodFor } from '../schedule/period';
import { isoToWall, todayIn, wallToIso } from '../schedule/tz';
import type { EmployeeProfile, Me, TimeOff } from '../types';
import { describeError, errorText, useBusy, useLoad } from './common';
import { FieldError, FormError, invalid } from '../fields';

const FIELDS = ['employee_ref', 'start_at', 'end_at', 'reason'];

interface Draft { record: TimeOff | null; employee_ref: string; start_date: string; start_time: string; end_date: string; end_time: string; reason: string }

export function TimeOffTab({ me }: { me: Me }) {
  const zone = me.organisation_timezone;
  const { confirm } = useFeedback();
  const month = periodFor('month', todayIn(zone));
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(addDays(month.to, 31));
  const { data, error, reload } = useLoad(() => Promise.all([
    api<{ unavailabilities: TimeOff[] }>('GET', `/api/unavailabilities${query({ from, to })}`),
    api<{ employees: EmployeeProfile[] }>('GET', '/api/employees'),
  ]), [from, to]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();

  const when = (iso: string) => {
    const w = isoToWall(iso, zone);
    return `${w.date} ${w.time}`;
  };
  const open = (record: TimeOff | null) => {
    const start = record ? isoToWall(record.start_at, zone) : { date: todayIn(zone), time: '00:00' };
    const end = record ? isoToWall(record.end_at, zone) : { date: addDays(todayIn(zone), 1), time: '00:00' };
    setProblem('');
    setFe({});
    setDraft({ record, employee_ref: record?.employee_ref ?? '', start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time, reason: record?.reason ?? '' });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    void run(async () => {
      try {
        const body = { start_at: wallToIso(draft.start_date, draft.start_time, zone), end_at: wallToIso(draft.end_date, draft.end_time, zone), reason: draft.reason };
        if (draft.record) await api('PATCH', `/api/unavailabilities/${draft.record.id}`, body);
        else await api('POST', '/api/unavailabilities', { ...body, employee_ref: draft.employee_ref });
        setDraft(null);
        await reload();
      } catch (e) {
        const d = describeError(e, FIELDS);
        setProblem(d.message);
        setFe(d.fields);
      }
    });
  };

  const remove = (record: TimeOff) => void run(async () => {
    if (!(await confirm('Delete this time off?', [], 'Delete'))) return;
    try {
      await api('DELETE', `/api/unavailabilities/${record.id}`);
      setProblem('');
      await reload();
    } catch (e) {
      setProblem(errorText(e));
    }
  });

  const [timeOff, employees] = data ? [data[0].unavailabilities, data[1].employees] : [[], []];
  const nameOf = new Map(employees.map((e) => [e.employee_ref, e.name]));

  return (
    <>
      <div className="panel-head">
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => open(null)}>Record time off</button>
      </div>
      {(error || problem) && !draft && <p role="alert" className="form-error">{problem || error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>From</th><th>To</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {timeOff.map((u) => (
              <tr key={u.id}>
                <td>{nameOf.get(u.employee_ref) ?? u.employee_ref}</td><td>{when(u.start_at)}</td><td>{when(u.end_at)}</td><td>{u.reason}</td>
                <td className="row-actions"><button type="button" onClick={() => open(u)}>Edit</button><button type="button" className="danger" disabled={busy} onClick={() => remove(u)}>Delete</button></td>
              </tr>
            ))}
            {data && timeOff.length === 0 && <tr><td colSpan={5} className="muted">No time off in this range.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted">Times are in {zone}.</p>
      {draft && (
        <Modal title={draft.record ? 'Edit time off' : 'Record time off'} onClose={() => setDraft(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="wide">Employee
              <select {...invalid(fe.employee_ref, 'time-off-employee_ref-error')} required disabled={!!draft.record} value={draft.employee_ref} onChange={(e) => setDraft({ ...draft, employee_ref: e.target.value })}>
                <option value="">Choose…</option>
                {employees.map((e) => <option key={e.employee_ref} value={e.employee_ref}>{e.name}</option>)}
              </select>
              <FieldError id="time-off-employee_ref-error" message={fe.employee_ref} />
            </label>
            <label>From date<input type="date" required value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} /></label>
            <label>From time<input {...invalid(fe.start_at, 'time-off-start_at-error')} type="time" required value={draft.start_time} onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} />
              <FieldError id="time-off-start_at-error" message={fe.start_at} /></label>
            <label>To date<input type="date" required value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} /></label>
            <label>To time<input {...invalid(fe.end_at, 'time-off-end_at-error')} type="time" required value={draft.end_time} onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} />
              <FieldError id="time-off-end_at-error" message={fe.end_at} /></label>
            <label className="wide">Reason<input {...invalid(fe.reason, 'time-off-reason-error')} maxLength={200} placeholder="Annual leave" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
              <FieldError id="time-off-reason-error" message={fe.reason} /></label>
            <FormError message={problem} className="wide" />
            <div className="wide actions"><button type="button" onClick={() => setDraft(null)}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
