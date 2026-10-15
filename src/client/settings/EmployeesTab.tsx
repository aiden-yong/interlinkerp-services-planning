'use client';

import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { Modal, useFeedback } from '../feedback';
import type { EmployeeProfile, Role, Weekday, WorkingHoursMap } from '../types';
import { describeError, useBusy, useLoad } from './common';
import { formatRanges, readWorkingHours, WEEKDAYS, weeklyHours } from './workingHoursInput';

const FIELDS = ['role_ids', 'default_role_id', 'timezone', 'working_hours'];

function Editor({ employee, roles, onClose, onSaved }: { employee: EmployeeProfile; roles: Role[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [roleIds, setRoleIds] = useState<string[]>(employee.role_ids);
  const [defaultRoleId, setDefaultRoleId] = useState(employee.default_role_id ?? '');
  const [timezone, setTimezone] = useState(employee.timezone ?? '');
  const [flexible, setFlexible] = useState(employee.working_hours === null);
  const [hours, setHours] = useState<Record<Weekday, string>>(() =>
    Object.fromEntries(WEEKDAYS.map(([d]) => [d, formatRanges(employee.working_hours?.[d] ?? [])])) as Record<Weekday, string>);
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();

  // Active roles, plus archived ones the employee already holds (they can be kept or removed, not newly assigned).
  const offered = roles.filter((r) => !r.archived || employee.role_ids.includes(r.id));
  const chosen = offered.filter((r) => roleIds.includes(r.id));

  const toggleRole = (id: string, on: boolean) => {
    setRoleIds(on ? [...roleIds, id] : roleIds.filter((r) => r !== id));
    if (!on && defaultRoleId === id) setDefaultRoleId('');
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      let workingHours: WorkingHoursMap | null = null;
      if (!flexible) {
        try {
          workingHours = readWorkingHours(hours);
        } catch (e) {
          setFe({ working_hours: (e as Error).message });
          setProblem('');
          return;
        }
      }
      try {
        await api('PATCH', `/api/employees/${encodeURIComponent(employee.employee_ref)}`, {
          role_ids: roleIds,
          default_role_id: defaultRoleId || null,
          timezone: timezone.trim() || null,
          working_hours: workingHours,
        });
        onClose();
        toast('Planning profile saved.', undefined, 3000);
        await onSaved();
      } catch (e) {
        const d = describeError(e, FIELDS);
        setProblem(d.message);
        setFe(d.fields);
      }
    });
  };

  return (
    <Modal title={employee.name} onClose={onClose}>
      <form onSubmit={save}>
        <fieldset>
          <legend>Roles</legend>
          {offered.map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={roleIds.includes(r.id)} onChange={(e) => toggleRole(r.id, e.target.checked)} />
              {r.name}{r.archived ? ' (archived)' : ''}
            </label>
          ))}
          {offered.length === 0 && <p className="muted">Create roles first.</p>}
          {fe.role_ids && <p className="field-error">{fe.role_ids}</p>}
        </fieldset>
        <div className="form-grid">
          <label>Default role
            <select value={defaultRoleId} onChange={(e) => setDefaultRoleId(e.target.value)}>
              <option value="">None</option>
              {chosen.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {fe.default_role_id && <span className="field-error">{fe.default_role_id}</span>}
          </label>
          <label>Time zone (blank = organisation)<input value={timezone} placeholder={employee.effective_timezone} onChange={(e) => setTimezone(e.target.value)} />
            {fe.timezone && <span className="field-error">{fe.timezone}</span>}</label>
          <label className="wide check"><input type="checkbox" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} /> Flexible hours (no fixed working hours)</label>
          {!flexible && WEEKDAYS.map(([day, label]) => (
            <label key={day}>{label}<input placeholder="09:00-13:00, 14:00-18:00" value={hours[day]} onChange={(e) => setHours({ ...hours, [day]: e.target.value })} /></label>
          ))}
          {!flexible && fe.working_hours && <p className="wide field-error">{fe.working_hours}</p>}
        </div>
        {problem && <p className="form-error">{problem}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

export function EmployeesTab() {
  const { data, error, reload } = useLoad(() => Promise.all([
    api<{ employees: EmployeeProfile[] }>('GET', '/api/employees'),
    api<{ roles: Role[] }>('GET', '/api/roles?include_archived=true'),
  ]), []);
  const [editing, setEditing] = useState<EmployeeProfile | null>(null);
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="empty">Loading…</p>;
  const [{ employees }, { roles }] = data;
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  return (
    <>
      <p className="muted">Employees come from the InterlinkERP roster. Here you set how each one can be planned.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Roles</th><th>Working hours</th><th>Time zone</th><th /></tr></thead>
          <tbody>
            {employees.map((e) => {
              const weekly = weeklyHours(e.working_hours);
              return (
                <tr key={e.employee_ref}>
                  <td>{e.name}<div className="muted">{e.department_name ?? ''}</div></td>
                  <td>{e.role_ids.map((id) => `${roleName.get(id) ?? id}${id === e.default_role_id ? ' (default)' : ''}`).join(', ') || '—'}</td>
                  <td>{weekly === null ? 'Flexible' : `${weekly.toFixed(1)} h / week`}</td>
                  <td>{e.effective_timezone}{!e.timezone && <span className="muted"> (organisation)</span>}</td>
                  <td><button type="button" onClick={() => setEditing(e)}>Edit</button></td>
                </tr>
              );
            })}
            {employees.length === 0 && <tr><td colSpan={5} className="muted">No employees yet. The roster may still be loading.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <Editor employee={editing} roles={roles} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}
