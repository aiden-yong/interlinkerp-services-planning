'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { Settings } from '../types';
import { describeError, useBusy, useLoad } from './common';

const FIELDS = ['country_code', 'region_code', 'timezone'];

export function GeneralTab() {
  const { toast } = useFeedback();
  const { data, error } = useLoad(() => api<{ settings: Settings }>('GET', '/api/settings'), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    void run(async () => {
      try {
        await api('PATCH', '/api/settings', {
          country_code: form.country_code?.trim().toUpperCase() || null,
          region_code: form.region_code?.trim().toUpperCase() || null,
          timezone: form.timezone.trim(),
        });
        setProblem('');
        setFe({});
        toast('Settings saved.', undefined, 3000);
      } catch (e) {
        const d = describeError(e, FIELDS);
        setProblem(d.message);
        setFe(d.fields);
      }
    });
  };

  if (error) return <p className="form-error">{error}</p>;
  if (!form) return <p className="empty">Loading…</p>;
  return (
    <form className="form-grid narrow" onSubmit={save}>
      <label>Country (ISO code)<input maxLength={2} placeholder="MY" value={form.country_code ?? ''} onChange={(e) => setForm({ ...form, country_code: e.target.value })} />
        {fe.country_code && <span className="field-error">{fe.country_code}</span>}</label>
      <label>State / region code<input maxLength={10} placeholder="MY-10" value={form.region_code ?? ''} onChange={(e) => setForm({ ...form, region_code: e.target.value })} />
        {fe.region_code && <span className="field-error">{fe.region_code}</span>}</label>
      <label className="wide">Organisation time zone<input list="zones" required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
        {fe.timezone && <span className="field-error">{fe.timezone}</span>}</label>
      <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
      <p className="wide muted">The country and region decide which public holidays are loaded. Employees without their own time zone use this one.</p>
      {problem && <p className="wide form-error">{problem}</p>}
      <div className="wide actions"><button className="primary" disabled={busy}>Save</button></div>
    </form>
  );
}
