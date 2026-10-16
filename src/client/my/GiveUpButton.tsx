'use client';

import { useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { GiveUp, MyShift } from '../types';
import { giveUpAction, problemText, shiftLabel } from './openShifts';
import './openShifts.css';

const TEXT = {
  switch: { label: 'Ask for cover', aria: 'Ask for cover for shift', title: 'Put this shift up for switch?', lines: ['It stays yours until a colleague takes it.'], done: 'Shift is up for switch.' },
  'cancel-switch': { label: 'Withdraw', aria: 'Withdraw switch request for shift', title: 'Withdraw your switch request?', lines: ['The shift stays yours.'], done: 'Switch request withdrawn.' },
  unassign: { label: 'Give up', aria: 'Give up shift', title: 'Give up this shift?', lines: ['It becomes an open shift that colleagues can claim.'], done: 'Shift given up.' },
} as const;

/** FR-OPN-03/04: the one give-up control a shift of mine gets under the active mode. */
export function GiveUpButton({ shift, giveUp, zone, onChanged }: { shift: MyShift; giveUp: GiveUp; zone: string; onChanged: () => Promise<void> }) {
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const action = giveUpAction(shift, giveUp, new Date());
  if (action.kind === 'none') return null;
  const kind = action.kind;
  const text = TEXT[kind];

  async function run() {
    if (busy || !(await confirm(text.title, [...text.lines], text.label))) return;
    setBusy(true);
    try {
      if (kind === 'cancel-switch') await api('DELETE', `/api/switch-requests/${shift.id}`);
      else await api('POST', kind === 'switch' ? '/api/switch-requests' : '/api/unassignments', { shift_id: shift.id });
      toast(text.done);
    } catch (error) {
      toast(problemText(error), undefined, 6000);
    } finally {
      setBusy(false);
      try {
        await onChanged();
      } catch {
        // The result is already shown; a failed refresh must not hide it.
      }
    }
  }

  return (
    <button type="button" className="give-up" disabled={busy} aria-label={`${text.aria} ${shiftLabel(shift, zone)}`} onClick={() => void run()}>
      {text.label}
    </button>
  );
}
