'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import type { Role, Template } from '../types';
import { describeError, useBusy, useLoad } from './common';
import { FieldError, FormError, invalid } from '../fields';

const FIELDS = ['name', 'role_id', 'start_time', 'duration_minutes', 'break_minutes'];

/** Like describeError, but a taken name (409) belongs on the name input. */
function describeTemplateError(error: unknown): { message: string; fields: Record<string, string> } {
  if (error instanceof ApiError && error.code === 'TEMPLATE_NAME_TAKEN') return { message: '', fields: { name: error.message } };
  return describeError(error, FIELDS);
}

function RoleSelect({ id, value, roles, onChange, invalidProps }: { id: string; value: string; roles: Role[]; onChange: (v: string) => void; invalidProps: ReturnType<typeof invalid> }) {
  return (
    <select {...invalidProps} id={id} aria-label="Template role" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No role</option>
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
}

function TemplateRow({ template, allRoles, onDone }: { template: Template; allRoles: Role[]; onDone: () => Promise<void> }) {
  const roles = allRoles.filter((r) => !r.archived || r.id === template.role_id);
  const [name, setName] = useState(template.name);
  const [roleId, setRoleId] = useState(template.role_id ?? '');
  const [startTime, setStartTime] = useState(template.start_time);
  const [durationMinutes, setDurationMinutes] = useState(String(template.duration_minutes));
  const [breakMinutes, setBreakMinutes] = useState(String(template.break_minutes));
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();

  const save = () => run(async () => {
    try {
      await api('PATCH', `/api/shift-templates/${template.id}`, {
        name, role_id: roleId || null, start_time: startTime, duration_minutes: Number(durationMinutes || 0), break_minutes: Number(breakMinutes || 0),
      });
      setProblem('');
      setFe({});
      await onDone();
    } catch (e) {
      const d = describeTemplateError(e);
      setFe(d.fields);
      setProblem(d.message);
    }
  });

  const remove = () => run(async () => {
    try {
      await api('DELETE', `/api/shift-templates/${template.id}`);
      await onDone();
    } catch (e) {
      const d = describeTemplateError(e);
      setFe(d.fields);
      setProblem(d.message);
    }
  });

  return (
    <tr>
      <td>
        <input {...invalid(fe.name, `template-${template.id}-name-error`)} aria-label="Template name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <FieldError id={`template-${template.id}-name-error`} message={fe.name} as="div" />
        <FieldError id={`template-${template.id}-problem-error`} message={problem} as="div" />
      </td>
      <td>
        <RoleSelect id={`template-${template.id}-role`} value={roleId} roles={roles} onChange={setRoleId} invalidProps={invalid(fe.role_id, `template-${template.id}-role-error`)} />
        <FieldError id={`template-${template.id}-role-error`} message={fe.role_id} as="div" />
      </td>
      <td>
        <input {...invalid(fe.start_time, `template-${template.id}-start_time-error`)} aria-label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <FieldError id={`template-${template.id}-start_time-error`} message={fe.start_time} as="div" />
      </td>
      <td>
        <input {...invalid(fe.duration_minutes, `template-${template.id}-duration_minutes-error`)} aria-label="Duration (minutes)" type="number" min={1} max={10080} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
        <FieldError id={`template-${template.id}-duration_minutes-error`} message={fe.duration_minutes} as="div" />
      </td>
      <td>
        <input {...invalid(fe.break_minutes, `template-${template.id}-break_minutes-error`)} aria-label="Break (minutes)" type="number" min={0} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
        <FieldError id={`template-${template.id}-break_minutes-error`} message={fe.break_minutes} as="div" />
      </td>
      <td className="row-actions">
        <button type="button" disabled={busy} onClick={save}>Save</button>
        <button type="button" disabled={busy} onClick={remove}>Delete</button>
      </td>
    </tr>
  );
}

export function TemplatesTab() {
  const { data, error, reload } = useLoad(() => Promise.all([
    api<{ templates: Template[] }>('GET', '/api/shift-templates'),
    api<{ roles: Role[] }>('GET', '/api/roles?include_archived=true'),
  ]), []);
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState('480');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await api('POST', '/api/shift-templates', {
          name, role_id: roleId || null, start_time: startTime, duration_minutes: Number(durationMinutes || 0), break_minutes: Number(breakMinutes || 0),
        });
        setName('');
        setRoleId('');
        setStartTime('09:00');
        setDurationMinutes('480');
        setBreakMinutes('0');
        setProblem('');
        setFe({});
        await reload();
      } catch (e) {
        const d = describeTemplateError(e);
        setProblem(d.message);
        setFe(d.fields);
      }
    });
  };

  if (error) return <p role="alert" className="form-error">{error}</p>;
  if (!data) return <p className="empty">Loading…</p>;
  const [{ templates }, { roles }] = data;
  const newTemplateRoles = roles.filter((r) => !r.archived);

  return (
    <>
      <form className="panel-head" onSubmit={add}>
        <label>New template<input {...invalid(fe.name, 'new-template-name-error')} required maxLength={80} placeholder="Night shift" value={name} onChange={(e) => setName(e.target.value)} />
          <FieldError id="new-template-name-error" message={fe.name} /></label>
        <label>Role
          <RoleSelect id="new-template-role" value={roleId} roles={newTemplateRoles} onChange={setRoleId} invalidProps={invalid(fe.role_id, 'new-template-role-error')} />
          <FieldError id="new-template-role-error" message={fe.role_id} />
        </label>
        <label>Start time<input {...invalid(fe.start_time, 'new-template-start_time-error')} type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <FieldError id="new-template-start_time-error" message={fe.start_time} /></label>
        <label>Duration (minutes)<input {...invalid(fe.duration_minutes, 'new-template-duration_minutes-error')} type="number" min={1} max={10080} required value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
          <FieldError id="new-template-duration_minutes-error" message={fe.duration_minutes} /></label>
        <label>Break (minutes)<input {...invalid(fe.break_minutes, 'new-template-break_minutes-error')} type="number" min={0} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
          <FieldError id="new-template-break_minutes-error" message={fe.break_minutes} /></label>
        <button className="primary" disabled={busy}>Add template</button>
      </form>
      <FormError message={problem} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Start</th><th>Duration (min)</th><th>Break (min)</th><th /></tr></thead>
          <tbody>
            {templates.map((t) => <TemplateRow key={t.id} template={t} allRoles={roles} onDone={reload} />)}
            {templates.length === 0 && <tr><td colSpan={6} className="muted">No templates yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
