import { DateTime } from 'luxon';
import type { ShiftRecord } from '../repo/shifts';

export interface Message {
  title: string;
  body: string;
  link: string;
}

export interface RenderContext {
  /** Every shift the notice mentions, deleted ones included. */
  shifts: Map<string, ShiftRecord>;
  /** employee_ref -> display name */
  names: Map<string, string>;
  /** The recipient's time zone. */
  zone: string;
  publicUrl: string;
}

export { scrubAddresses } from '../support/scrub';

export function shiftIdsOf(payload: Record<string, unknown>): string[] {
  if (Array.isArray(payload.shift_ids)) return payload.shift_ids.filter((id): id is string => typeof id === 'string');
  return typeof payload.shift_id === 'string' ? [payload.shift_id] : [];
}

/**
 * "Wed 14 Oct, 09:00–17:00" in `zone`; the end date is shown only when it falls on another day.
 * The locale is pinned to English so emails and tests never depend on the server's default language.
 */
export function formatSpan(start: Date, end: Date, zone: string): string {
  const s = DateTime.fromJSDate(start, { zone }).setLocale('en');
  const e = DateTime.fromJSDate(end, { zone }).setLocale('en');
  const day = s.toFormat('ccc d LLL');
  return s.hasSame(e, 'day') ? `${day}, ${s.toFormat('HH:mm')}–${e.toFormat('HH:mm')}` : `${day}, ${s.toFormat('HH:mm')} – ${e.toFormat('ccc d LLL, HH:mm')}`;
}

/** One place for every notice's wording (FR-NTF-01..03). Throws on an unknown kind or a missing shift; the sweep retries. */
export function render(kind: string, payload: Record<string, unknown>, ctx: RenderContext): Message {
  const span = (id: string) => {
    const shift = ctx.shifts.get(id);
    if (!shift) throw new Error(`Shift ${id} not found`);
    return formatSpan(shift.start, shift.end, ctx.zone);
  };
  const name = (ref: unknown) => (typeof ref === 'string' && ctx.names.get(ref)) || 'Someone';
  const ids = shiftIdsOf(payload);
  if (ids.length === 0 && (kind === 'schedule_published' || kind === 'open_shifts_available')) throw new Error(`Notice ${kind} lists no shifts`);
  const first = () => span(ids[0] ?? '');
  const my = `${ctx.publicUrl}/my`;
  const board = `${ctx.publicUrl}/schedule`;
  switch (kind) {
    case 'schedule_published':
      return { title: ids.length === 1 ? 'Your shift was published' : `Your ${ids.length} shifts were published`, body: ids.map(span).join('\n'), link: my };
    case 'shift_assigned':
      return { title: 'You have a new shift', body: first(), link: my };
    case 'shift_unassigned':
      return { title: 'A shift is no longer yours', body: first(), link: my };
    case 'shift_changed':
      return { title: 'One of your shifts changed', body: `${first()}. Changed: ${(Array.isArray(payload.changed) ? payload.changed : []).join(', ')}.`, link: my };
    case 'shift_deleted': {
      const start = new Date(String(payload.start_at));
      const end = new Date(String(payload.end_at));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('Notice shift_deleted has no valid start_at and end_at');
      return { title: 'A shift was cancelled', body: formatSpan(start, end, ctx.zone), link: my };
    }
    case 'switch_taken':
      return { title: 'Your shift was taken', body: `${name(payload.taker_ref)} took your shift on ${first()}.`, link: my };
    case 'switch_cancelled':
      return { title: 'Your switch request was cancelled', body: `Shifts can no longer be put up for switch, so your request for ${first()} was cancelled. The shift is still yours.`, link: my };
    case 'open_shifts_available':
      return { title: ids.length === 1 ? 'An open shift you can take' : `${ids.length} open shifts you can take`, body: ids.map(span).join('\n'), link: my };
    case 'shift_claimed':
      return { title: 'Open shift claimed', body: `${name(payload.employee_ref)} claimed the open shift on ${first()}.`, link: board };
    case 'shift_switched':
      return { title: 'Shift switched', body: `${name(payload.to_ref)} took over ${name(payload.from_ref)}'s shift on ${first()}.`, link: board };
    case 'shift_given_up':
      return { title: 'Shift given up', body: `${name(payload.employee_ref)} gave up the shift on ${first()}. It is now an open shift.`, link: board };
    default:
      throw new Error(`Unknown notification kind ${kind}`);
  }
}
