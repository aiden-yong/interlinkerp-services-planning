'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HistoryEntry } from '../types';
import { describeEntry } from './history';

interface Props {
  shiftId: string;
  zone: string;
  roles: { id: string; name: string }[];
  names: Map<string, string>;
}

/** A collapsible History section; it loads the first time it is opened. */
export function ShiftHistory({ shiftId, zone, roles, names }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || entries !== null) return;
    let current = true;
    api<{ entries: HistoryEntry[] }>('GET', `/api/shifts/${shiftId}/history`)
      .then((r) => current && setEntries(r.entries))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [open, entries, shiftId]);

  return (
    <details className="shift-history" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>History</summary>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!error && entries === null && open && <p className="muted">Loading…</p>}
      {entries?.length === 0 && <p className="muted">No history yet.</p>}
      {entries && entries.length > 0 && (
        <ul>
          {entries.map((e, i) => {
            const d = describeEntry(e, zone, roles, names);
            return <li key={i}><span className="muted">{d.when}</span> {d.text}</li>;
          })}
        </ul>
      )}
    </details>
  );
}
