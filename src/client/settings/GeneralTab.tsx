'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import { Segmented } from '../Segmented';
import type { Settings } from '../types';
import { describeError, useBusy, useLoad } from './common';
import { FieldError, FormError, invalid } from '../fields';

const FIELDS = ['country_code', 'region_code', 'timezone', 'give_up_mode', 'unassign_window_days', 'recurrence_horizon_months', 'reminder_lead_minutes'];
const LEAD_OPTIONS = [[0, 'Off'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [720, '12 hours'], [1440, '24 hours']] as const;
const MODES = [{ value: 'switch', label: 'Switch' }, { value: 'unassign', label: 'Unassign' }] as const;

export function GeneralTab() {
  const { toast, confirm } = useFeedback();
  const { data, error } = useLoad(() => api<{ settings: Settings }>('GET', '/api/settings'), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null); // the baseline the BR-07 confirm compares against
  const [windowText, setWindowText] = useState('');
  const [horizonText, setHorizonText] = useState('');
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  useEffect(() => {
    if (data) {
      setForm(data.settings);
      setSaved(data.settings);
      setWindowText(String(data.settings.unassign_window_days));
      setHorizonText(String(data.settings.recurrence_horizon_months));
    }
  }, [data]);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const unassign = form.give_up_mode === 'unassign';
    const days = windowText.trim() === '' ? NaN : Number(windowText);
    if (unassign && !(Number.isInteger(days) && days >= 0 && days <= 60)) {
      setFe({ unassign_window_days: windowText.trim() === '' ? 'Required. Enter a whole number of days from 0 to 60.' : 'Use a whole number of days from 0 to 60.' });
      return;
    }
    const horizonMonths = horizonText.trim() === '' ? NaN : Number(horizonText);
    if (!(Number.isInteger(horizonMonths) && horizonMonths >= 1 && horizonMonths <= 24)) {
      setFe({ recurrence_horizon_months: horizonText.trim() === '' ? 'Required. Enter a whole number of months from 1 to 24.' : 'Use a whole number of months from 1 to 24.' });
      return;
    }
    void run(async () => {
      // Moving from Switch to Unassign cancels pending switch requests (BR-07), so ask first.
      if (saved?.give_up_mode === 'switch' && unassign
        && !(await confirm('Switch to Unassign?', ['Pending switch requests will be cancelled and their owners told.'], 'Switch to Unassign'))) return;
      try {
        const result = await api<{ settings: Settings }>('PATCH', '/api/settings', {
          country_code: form.country_code?.trim().toUpperCase() || null,
          region_code: form.region_code?.trim().toUpperCase() || null,
          timezone: form.timezone.trim(),
          give_up_mode: form.give_up_mode,
          unassign_window_days: unassign ? days : form.unassign_window_days,
          recurrence_horizon_months: horizonMonths,
          reminder_lead_minutes: form.reminder_lead_minutes,
        });
        setSaved(result.settings);
        setForm(result.settings);
        setWindowText(String(result.settings.unassign_window_days));
        setHorizonText(String(result.settings.recurrence_horizon_months));
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

  if (error) return <p role="alert" className="form-error">{error}</p>;
  if (!form) return <p className="empty">Loading…</p>;
  return (
    <form className="form-grid narrow" noValidate onSubmit={save}>
      <label>Country (ISO code)<input {...invalid(fe.country_code, 'general-country_code-error')} maxLength={2} placeholder="MY" value={form.country_code ?? ''} onChange={(e) => setForm({ ...form, country_code: e.target.value })} />
        <FieldError id="general-country_code-error" message={fe.country_code} /></label>
      <label>State / region code<input {...invalid(fe.region_code, 'general-region_code-error')} maxLength={10} placeholder="MY-10" value={form.region_code ?? ''} onChange={(e) => setForm({ ...form, region_code: e.target.value })} />
        <FieldError id="general-region_code-error" message={fe.region_code} /></label>
      <label className="wide">Organisation time zone<input {...invalid(fe.timezone, 'general-timezone-error')} list="zones" required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
        <FieldError id="general-timezone-error" message={fe.timezone} /></label>
      <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
      <fieldset className="wide">
        <legend aria-hidden="true">Give-up mode</legend>
        <Segmented label="Give-up mode" value={form.give_up_mode} segments={MODES} onChange={(give_up_mode) => setForm({ ...form, give_up_mode })} />
        <span className="muted">{form.give_up_mode === 'switch'
          ? 'Switch: the shift stays theirs until a colleague takes it.'
          : 'Unassign: it becomes an open shift.'}</span>
        <FieldError id="general-give_up_mode-error" message={fe.give_up_mode} />
      </fieldset>
      {form.give_up_mode === 'unassign' && (
        <label>Unassign window (days)<input {...invalid(fe.unassign_window_days, 'general-unassign_window_days-error')} type="number" min={0} max={60} step={1} value={windowText} onChange={(e) => setWindowText(e.target.value)} />
          <FieldError id="general-unassign_window_days-error" message={fe.unassign_window_days} /></label>
      )}
      <label className="wide">Recurrence horizon (months)<input {...invalid(fe.recurrence_horizon_months, 'general-recurrence_horizon_months-error')} type="number" min={1} max={24} step={1} value={horizonText} onChange={(e) => setHorizonText(e.target.value)} />
        <FieldError id="general-recurrence_horizon_months-error" message={fe.recurrence_horizon_months} /></label>
      <p className="wide muted">How far ahead repeated shifts are generated before the schedule needs to extend them again.</p>
      <label className="wide">Remind employees before their shifts
        <select {...invalid(fe.reminder_lead_minutes, 'general-reminder_lead_minutes-error')} value={form.reminder_lead_minutes} onChange={(e) => setForm({ ...form, reminder_lead_minutes: Number(e.target.value) })}>
          {LEAD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <FieldError id="general-reminder_lead_minutes-error" message={fe.reminder_lead_minutes} /></label>
      <p className="wide muted">Employees get an email and an in-app notice this long before a published shift starts. Off sends none.</p>
      <p className="wide muted">The country and region decide which public holidays are loaded. Employees without their own time zone use this one.</p>
      <FormError message={problem} className="wide" />
      <div className="wide actions"><button className="primary" disabled={busy}>Save</button></div>
    </form>
  );
}
