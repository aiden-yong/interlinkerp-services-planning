'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useFeedback } from '../feedback';
import type { ManagerGrant } from '../types';
import { describeError, errorText, useBusy, useLoad } from './common';
import { FieldError, FormError, invalid } from '../fields';

export function ManagersTab() {
  const { confirm, toast } = useFeedback();
  const { data, error, reload } = useLoad(() => api<{ managers: ManagerGrant[]; note: string }>('GET', '/api/managers'), []);
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');
  const [emailError, setEmailError] = useState('');
  const { busy, run } = useBusy();

  const grant = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const address = email.trim().toLowerCase();
      const already = data?.managers.some((m) => m.email === address) ?? false;
      try {
        await api('POST', '/api/managers', { email });
        setEmail('');
        setProblem('');
        setEmailError('');
        if (already) toast(`${address} already has manager access.`, undefined, 4000);
        await reload();
      } catch (e) {
        const d = describeError(e, ['email']);
        setEmailError(d.fields.email ?? '');
        setProblem(d.message); // includes 503 ROSTER_UNAVAILABLE
      }
    });
  };

  const revoke = (address: string) => void run(async () => {
    if (!(await confirm(`Revoke manager access for ${address}?`, [], 'Revoke'))) return;
    const path = `/api/managers/${encodeURIComponent(address)}`;
    try {
      try {
        await api('DELETE', path);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'LAST_MANAGER')) throw e;
        // FR-ACC-03 AC3: warn the last listed manager before they remove themselves.
        if (!(await confirm('You are the last listed Planning Manager', [e.message], 'Remove me anyway'))) return;
        await api('DELETE', `${path}?confirm=true`);
      }
      setProblem('');
      await reload();
    } catch (e) {
      setProblem(errorText(e));
    }
  });

  return (
    <>
      {data && <p className="muted">{data.note}</p>}
      <form className="panel-head" onSubmit={grant}>
        <label>Email of someone on the roster<input {...invalid(emailError, 'manager-email-error')} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <FieldError id="manager-email-error" message={emailError} /></label>
        <button className="primary" disabled={busy}>Grant manager access</button>
      </form>
      <FormError message={problem || error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Granted by</th><th>Since</th><th /></tr></thead>
          <tbody>
            {data?.managers.map((m) => (
              <tr key={m.email}>
                <td>{m.email}</td><td>{m.granted_by}</td><td>{m.granted_at.slice(0, 10)}</td>
                <td><button type="button" className="danger" disabled={busy} onClick={() => revoke(m.email)}>Revoke</button></td>
              </tr>
            ))}
            {data && data.managers.length === 0 && <tr><td colSpan={4} className="muted">Nobody is listed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
