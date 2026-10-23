'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import { FormError } from '../fields';

type State = { kind: 'loading' } | { kind: 'off' } | { kind: 'on'; url: string | null };

/** "Add to your calendar": a private subscription link to the employee's published shifts. */
export function CalendarFeed() {
  const { confirm, toast } = useFeedback();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    api<{ enabled: boolean }>('GET', '/api/my/calendar-feed')
      .then((r) => current && setState(r.enabled ? { kind: 'on', url: null } : { kind: 'off' }))
      .catch((e: Error) => {
        if (current) {
          setProblem(e.message);
          setState({ kind: 'off' });
        }
      });
    return () => {
      current = false;
    };
  }, []);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await work();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const create = () => run(async () => {
    const r = await api<{ enabled: true; url: string }>('POST', '/api/my/calendar-feed');
    setState({ kind: 'on', url: r.url });
  });
  const reset = () => run(async () => {
    if (!(await confirm('Reset your calendar link?', ['The old link will stop working.'], 'Reset'))) return;
    const r = await api<{ enabled: true; url: string }>('POST', '/api/my/calendar-feed');
    setState({ kind: 'on', url: r.url });
  });
  const turnOff = () => run(async () => {
    await api('DELETE', '/api/my/calendar-feed');
    setState({ kind: 'off' });
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied.', undefined, 3000);
    } catch {
      field.current?.focus();
      field.current?.select();
      toast('Press Ctrl+C to copy the link.', undefined, 4000);
    }
  }

  if (state.kind === 'loading') return <FormError message={problem} />;
  return (
    <section className="calendar-feed" aria-labelledby="calendar-feed-title">
      <h2 id="calendar-feed-title">Add to your calendar</h2>
      {state.kind === 'off' && <div className="actions"><button type="button" className="primary" disabled={busy} onClick={create}>Get calendar link</button></div>}
      {state.kind === 'on' && (
        <>
          {state.url ? (
            <>
              <label>Calendar link
                <input ref={field} readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
              </label>
              <p className="muted">Paste this link into Google Calendar, Outlook or Apple Calendar as a subscription. Anyone with the link can see your published shifts.</p>
            </>
          ) : <p>Your calendar link is on.</p>}
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            {state.url && <button type="button" onClick={() => void copy(state.url!)}>Copy</button>}
            <button type="button" disabled={busy} onClick={reset}>Reset link</button>
            <button type="button" className="danger" disabled={busy} onClick={turnOff}>Turn off</button>
          </div>
        </>
      )}
      <FormError message={problem} />
    </section>
  );
}
