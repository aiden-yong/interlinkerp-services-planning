'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useFeedback } from '../feedback';
import { todayIn } from '../schedule/tz';
import type { Holiday, Me } from '../types';
import { describeError, useBusy, useLoad } from './common';

const FIELDS = ['date', 'name'];

function HolidayRow({ holiday, busy, act }: { holiday: Holiday; busy: boolean; act: (h: Holiday, action: 'rename' | 'toggle' | 'delete', name?: string) => void }) {
  const [name, setName] = useState(holiday.name);
  return (
    <tr className={holiday.hidden ? 'muted' : undefined}>
      <td>{holiday.date}</td>
      <td><input aria-label="Holiday name" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td>{holiday.source === 'manual' ? 'Added by hand' : 'Provider'}{holiday.hidden ? ' · hidden' : ''}</td>
      <td className="row-actions">
        <button type="button" disabled={busy} onClick={() => act(holiday, 'rename', name)}>Save name</button>
        <button type="button" disabled={busy} onClick={() => act(holiday, 'toggle')}>{holiday.hidden ? 'Show' : 'Hide'}</button>
        {holiday.source === 'manual' && <button type="button" className="danger" disabled={busy} onClick={() => act(holiday, 'delete')}>Delete</button>}
      </td>
    </tr>
  );
}

export function HolidaysTab({ me }: { me: Me }) {
  const { confirm, toast } = useFeedback();
  const [year, setYear] = useState(() => Number(todayIn(me.organisation_timezone).slice(0, 4)));
  const { data, error, reload } = useLoad(() => api<{ holidays: Holiday[] }>('GET', `/api/holidays?year=${year}`), [year]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();

  const attempt = (work: () => Promise<unknown>) => run(async () => {
    try {
      await work();
      setProblem('');
      setFe({});
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HOLIDAY_PROVIDER_NOT_CONFIGURED') {
        setProblem('No public holiday provider is connected yet. Add holidays by hand for now.');
        setFe({});
      } else {
        const d = describeError(e, FIELDS);
        setProblem(d.message);
        setFe(d.fields);
      }
    }
  });

  const add = (event: FormEvent) => {
    event.preventDefault();
    void attempt(async () => {
      await api('POST', '/api/holidays', { date, name });
      setDate('');
      setName('');
    });
  };
  const sync = () => attempt(async () => {
    const result = await api<{ added: number; updated: number }>('POST', '/api/holiday-syncs', { year });
    toast(`Loaded holidays: ${result.added} added, ${result.updated} updated.`, undefined, 4000);
  });
  const act = async (h: Holiday, action: 'rename' | 'toggle' | 'delete', newName?: string) => {
    if (action === 'delete' && !(await confirm('Delete this holiday?', [], 'Delete'))) return;
    await attempt(() => action === 'rename' ? api('PATCH', `/api/holidays/${h.id}`, { name: newName })
      : action === 'toggle' ? api('PATCH', `/api/holidays/${h.id}`, { hidden: !h.hidden })
        : api('DELETE', `/api/holidays/${h.id}`));
  };

  return (
    <>
      <div className="panel-head">
        <label>Year<input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }} /></label>
        <button type="button" disabled={busy} onClick={sync}>Load public holidays</button>
        <span className="spacer" />
        <form className="inline" onSubmit={add}>
          <label>Date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />{fe.date && <span className="field-error">{fe.date}</span>}</label>
          <label>Name<input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />{fe.name && <span className="field-error">{fe.name}</span>}</label>
          <button className="primary" disabled={busy}>Add holiday</button>
        </form>
      </div>
      {(problem || error) && <p className="form-error">{problem || error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>Source</th><th /></tr></thead>
          <tbody>
            {data?.holidays.map((h) => <HolidayRow key={`${h.id}:${h.name}:${h.hidden}`} holiday={h} busy={busy} act={act} />)}
            {data && data.holidays.length === 0 && <tr><td colSpan={4} className="muted">No holidays for this year.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted">Hidden holidays are ignored by planning and stay hidden after a reload from the provider.</p>
    </>
  );
}
