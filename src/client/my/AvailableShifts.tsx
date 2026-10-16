'use client';

import { useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { OpenShiftsPayload } from '../types';
import { problemText, shiftLabel } from './openShifts';
import './openShifts.css';

/** FR-OPN-01..03: open shifts I can claim and the shifts colleagues want covered. */
export function AvailableShifts({ data, onChanged }: { data: OpenShiftsPayload | null; onChanged: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || (data.open.length === 0 && data.up_for_switch.length === 0)) return null;

  async function act(id: string, path: string, done: string) {
    if (busy) return;
    setBusy(id);
    try {
      await api('POST', path, { shift_id: id });
      toast(done);
    } catch (error) {
      toast(problemText(error), undefined, 6000);
    } finally {
      setBusy(null);
      try {
        await onChanged();
      } catch {
        // The result is already shown; a failed refresh must not hide it.
      }
    }
  }

  return (
    <section className="available" aria-labelledby="available-heading">
      <h2 id="available-heading">Available shifts</h2>
      <ul>
        {data.open.map((s) => (
          <li key={s.id}>
            <span className="when">{shiftLabel(s, data.timezone)}<span className="muted"> · open shift</span></span>
            <button type="button" disabled={busy !== null} aria-label={`Claim shift ${shiftLabel(s, data.timezone)}`} onClick={() => void act(s.id, '/api/shift-claims', 'Shift claimed.')}>Claim</button>
          </li>
        ))}
        {data.up_for_switch.map((s) => (
          <li key={s.id}>
            <span className="when">{shiftLabel(s, data.timezone)}<span className="muted"> · {s.owner_name} needs cover</span></span>
            <button type="button" disabled={busy !== null} aria-label={`Take shift ${shiftLabel(s, data.timezone)} from ${s.owner_name}`} onClick={() => void act(s.id, '/api/switch-takeovers', 'Shift taken over.')}>Take</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
