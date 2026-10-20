'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import { FormError } from '../fields';
import { Modal, useFeedback } from '../feedback';
import { errorText } from '../settings/common';

interface Preference { kind: string; label: string; audience: 'employee' | 'managers'; email: boolean }

/** Backlog item 29: choose which notices also arrive by email. Notices always appear under the bell. */
export function EmailSettings({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const [saved, setSaved] = useState<Preference[] | null>(null);
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ preferences: Preference[] }>('GET', '/api/my/notification-preferences').then(
      ({ preferences }) => {
        setSaved(preferences);
        setChoice(Object.fromEntries(preferences.map((p) => [p.kind, p.email])));
      },
      (error: unknown) => setProblem(errorText(error)),
    );
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!saved || busy) return;
    const changed = Object.fromEntries(saved.filter((p) => choice[p.kind] !== p.email).map((p) => [p.kind, choice[p.kind]!]));
    if (Object.keys(changed).length === 0) return onClose();
    setBusy(true);
    try {
      await api('PATCH', '/api/my/notification-preferences', { email: changed });
      toast('Email settings saved.', undefined, 4000);
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const group = (audience: Preference['audience'], legend: string) => {
    const items = saved?.filter((p) => p.audience === audience) ?? [];
    if (items.length === 0) return null;
    return (
      <fieldset>
        <legend>{legend}</legend>
        {items.map((p) => (
          <label key={p.kind} className="check">
            <input type="checkbox" checked={choice[p.kind] ?? true} onChange={(e) => setChoice({ ...choice, [p.kind]: e.target.checked })} />
            {p.label}
          </label>
        ))}
      </fieldset>
    );
  };

  return (
    <Modal title="Email settings" onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted">Every notice appears under the bell. Untick the ones you do not also want by email.</p>
        {!saved && !problem && <p className="empty">Loading…</p>}
        {group('employee', 'About my shifts')}
        {group('managers', 'As a Planning Manager')}
        <FormError message={problem} />
        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !saved}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
