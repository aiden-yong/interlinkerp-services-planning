'use client';

import type { CSSProperties } from 'react';
import { Modal } from '../feedback';
import { formatTime } from '../schedule/tz';
import type { GiveUp, Role } from '../types';
import { useTakeShift } from './AvailableShifts';
import type { CalendarEvent } from './calendar';
import { GiveUpButton } from './GiveUpButton';
import { shiftLabel } from './openShifts';

const HEADING = { mine: 'My shift', open: 'Open shift', switch: 'Cover wanted' } as const;

/** What opens when a shift on the calendar is clicked: its details and whatever can be done with it. */
export function ShiftDetail({ event, role, zone, giveUp, onClose, onChanged }: {
  event: CalendarEvent;
  role: Role | undefined;
  zone: string;
  giveUp: GiveUp | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { shift, kind } = event;
  const finished = async () => {
    await onChanged();
    onClose();
  };
  const { busy, claim, takeOver } = useTakeShift(finished);
  const label = shiftLabel(shift, zone);
  const date = label.split(' ').slice(0, 3).join(' '); // "Sat 7 Nov"

  return (
    <Modal title={HEADING[kind]} onClose={onClose}>
      <div className="shift-detail">
        <p className="shift-detail-role" style={role ? ({ '--role-color': role.color } as CSSProperties) : undefined}>
          <i aria-hidden="true" />{role?.name ?? 'No role'}
          {kind === 'mine' && shift.switch_requested && <span className="badge badge-warn">Up for switch</span>}
        </p>
        <dl>
          <dt>When</dt>
          <dd>{date}, {formatTime(shift.start_at, zone)}–{formatTime(shift.end_at, zone)}</dd>
          <dt>Hours</dt>
          <dd>{shift.allocated_hours.toFixed(1)} h{shift.break_minutes ? ` (${shift.break_minutes} min break)` : ''}</dd>
          {event.ownerName && <><dt>Colleague</dt><dd>{event.ownerName}</dd></>}
          {shift.note && <><dt>Note</dt><dd>{shift.note}</dd></>}
        </dl>
        <p className="muted">Times are shown in {zone}.</p>
      </div>
      <div className="actions">
        <button type="button" onClick={onClose}>Close</button>
        {kind === 'mine' && giveUp && <GiveUpButton shift={shift} giveUp={giveUp} zone={zone} onChanged={finished} />}
        {kind === 'open' && <button type="button" className="primary" disabled={busy !== null} aria-label={`Claim shift ${label}`} onClick={() => void claim(shift.id)}>Claim</button>}
        {kind === 'switch' && <button type="button" className="primary" disabled={busy !== null} aria-label={`Take shift ${label} from ${event.ownerName}`} onClick={() => void takeOver(shift.id)}>Take</button>}
      </div>
    </Modal>
  );
}
