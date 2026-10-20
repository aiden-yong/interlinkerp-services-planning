'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import type { Role } from '../types';
import { describeError, useBusy, useLoad } from './common';
import { FieldError, FormError, invalid } from '../fields';

const FIELDS = ['name', 'color'];

/** Like describeError, but a taken name (409) belongs on the name input. */
function describeRoleError(error: unknown): { message: string; fields: Record<string, string> } {
  if (error instanceof ApiError && error.code === 'ROLE_NAME_TAKEN') return { message: '', fields: { name: error.message } };
  return describeError(error, FIELDS);
}

function RoleRow({ role, onDone }: { role: Role; onDone: () => Promise<void> }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color.toLowerCase());
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const patch = (body: Record<string, unknown>) => run(async () => {
    try {
      await api('PATCH', `/api/roles/${role.id}`, body);
      await onDone();
    } catch (e) {
      const d = describeRoleError(e);
      setFe(d.fields);
      setProblem(d.message);
    }
  });
  return (
    <tr>
      <td>
        <input {...invalid(fe.name, `role-${role.id}-name-error`)} aria-label="Role name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <FieldError id={`role-${role.id}-name-error`} message={fe.name} as="div" />
        <FieldError id={`role-${role.id}-problem-error`} message={problem} as="div" />
      </td>
      <td><input {...invalid(fe.color, `role-${role.id}-color-error`)} type="color" aria-label="Role colour" value={color} onChange={(e) => setColor(e.target.value)} /><FieldError id={`role-${role.id}-color-error`} message={fe.color} as="div" /></td>
      <td>{role.archived ? <span className="muted">Archived</span> : 'Active'}</td>
      <td className="row-actions">
        <button type="button" disabled={busy} onClick={() => patch({ name, color })}>Save</button>
        <button type="button" disabled={busy} onClick={() => patch({ archived: !role.archived })}>{role.archived ? 'Restore' : 'Archive'}</button>
      </td>
    </tr>
  );
}

export function RolesTab() {
  const { data, error, reload } = useLoad(() => api<{ roles: Role[] }>('GET', '/api/roles?include_archived=true'), []);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await api('POST', '/api/roles', { name, color });
        setName('');
        setProblem('');
        setFe({});
        await reload();
      } catch (e) {
        const d = describeRoleError(e);
        setProblem(d.message);
        setFe(d.fields);
      }
    });
  };

  return (
    <>
      <form className="panel-head" onSubmit={add}>
        <label>New role<input {...invalid(fe.name, 'new-role-name-error')} required maxLength={80} placeholder="Technician" value={name} onChange={(e) => setName(e.target.value)} />
          <FieldError id="new-role-name-error" message={fe.name} /></label>
        <label>Colour<input {...invalid(fe.color, 'new-role-color-error')} type="color" value={color} onChange={(e) => setColor(e.target.value)} /><FieldError id="new-role-color-error" message={fe.color} /></label>
        <button className="primary" disabled={busy}>Add role</button>
      </form>
      <FormError message={problem || error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Colour</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data?.roles.map((r) => <RoleRow key={`${r.id}:${r.name}:${r.color}:${r.archived}`} role={r} onDone={reload} />)}
            {data && data.roles.length === 0 && <tr><td colSpan={4} className="muted">No roles yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
