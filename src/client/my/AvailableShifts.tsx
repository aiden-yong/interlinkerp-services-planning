'use client';

import { useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { OpenShiftsPayload } from '../types';
import { problemText, shiftLabel } from './openShifts';
import './openShifts.css';

/** Claiming an open shift and taking over a colleague's, shared by the list and the calendar's shift details. */
export function useTakeShift(onChanged: () => Promise<void>) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, path: string, done: string) {
    if (busy) return;
    setBusy(id);
    try {
      await api('POST', path, { shift_id: id });
      toast(done);
    } catch (error) {
      toast(problemText(error), undefined, 6000);
    } finally {
      try {
        await onChanged();
      } catch {
        // The result is already shown; a failed refresh must not hide it.
      }
      setBusy(null);
    }
  }

  return {
    busy,
    claim: (id: string) => act(id, '/api/shift-claims', 'Shift claimed.'),
    takeOver: (id: string) => act(id, '/api/switch-takeovers', 'Shift taken over.'),
  };
}

/** FR-OPN-01..03: open shifts I can claim and the shifts colleagues want covered. */
export function AvailableShifts({ data, onChanged }: { data: OpenShiftsPayload | null; onChanged: () => Promise<void> }) {
  const { busy, claim, takeOver } = useTakeShift(onChanged);
  if (!data || (data.open.length === 0 && data.up_for_switch.length === 0)) return null;

  return (
    <section className="available" aria-labelledby="available-heading">
      <h2 id="available-heading">Available shifts</h2>
      <ul>
        {data.open.map((s) => (
          <li key={s.id}>
            <span className="when">{shiftLabel(s, data.timezone)}<span className="sep"> · </span><span className="muted">open shift</span></span>
            <button type="button" className="sm" disabled={busy !== null} aria-label={`Claim shift ${shiftLabel(s, data.timezone)}`} onClick={() => void claim(s.id)}>Claim</button>
          </li>
        ))}
        {data.up_for_switch.map((s) => (
          <li key={s.id}>
            <span className="when">{shiftLabel(s, data.timezone)}<span className="sep"> · </span><span className="muted">{s.owner_name} needs cover</span></span>
            <button type="button" className="sm" disabled={busy !== null} aria-label={`Take shift ${shiftLabel(s, data.timezone)} from ${s.owner_name}`} onClick={() => void takeOver(s.id)}>Take</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
