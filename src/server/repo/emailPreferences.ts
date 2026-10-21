import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { emailOptOuts } from '../db/schema';
import type { Recipient } from './notifications';

/** Backlog item 29: every notice type, who receives it, and how the email settings describe it. */
export const NOTICE_TYPES = [
  { kind: 'schedule_published', audience: 'employee', label: 'My shifts are published' },
  { kind: 'shift_assigned', audience: 'employee', label: 'I am given a new shift' },
  { kind: 'shift_changed', audience: 'employee', label: 'One of my shifts changes' },
  { kind: 'shift_deleted', audience: 'employee', label: 'One of my shifts is cancelled' },
  { kind: 'shift_unassigned', audience: 'employee', label: 'A shift stops being mine' },
  { kind: 'switch_taken', audience: 'employee', label: 'A colleague takes a shift I asked cover for' },
  { kind: 'switch_cancelled', audience: 'employee', label: 'My switch request is cancelled' },
  { kind: 'open_shifts_available', audience: 'employee', label: 'Open shifts I can take' },
  { kind: 'shift_reminder', audience: 'employee', label: 'A reminder before each shift' },
  { kind: 'shift_claimed', audience: 'managers', label: 'An open shift is claimed' },
  { kind: 'shift_switched', audience: 'managers', label: 'A shift is switched between employees' },
  { kind: 'shift_given_up', audience: 'managers', label: 'A shift is given up' },
] as const;

export type NoticeType = (typeof NOTICE_TYPES)[number];

/** Where a notice of this type reaches this person (as the inbox addresses it), or null when they never receive it. */
export function addressFor(who: Recipient, type: NoticeType): string | null {
  if (type.audience === 'employee') return who.ref ? `ref:${who.ref}` : null;
  return who.isManager && who.email ? `email:${who.email}` : null;
}

/** The notice types this person receives. */
export const typesFor = (who: Recipient): NoticeType[] => NOTICE_TYPES.filter((t) => addressFor(who, t) !== null);

export class EmailPreferences {
  constructor(private readonly db: Db, private readonly org: string) {}

  /** For the delivery sweep: which (address, kind) pairs are switched off, as `address|kind`. */
  async optedOut(addresses: string[]): Promise<Set<string>> {
    if (addresses.length === 0) return new Set();
    const rows = await this.db.select({ recipient: emailOptOuts.recipient, kind: emailOptOuts.kind }).from(emailOptOuts)
      .where(and(eq(emailOptOuts.organisationId, this.org), inArray(emailOptOuts.recipient, [...new Set(addresses)])));
    return new Set(rows.map((r) => `${r.recipient}|${r.kind}`));
  }

  async list(who: Recipient): Promise<{ kind: string; label: string; audience: string; email: boolean }[]> {
    const types = typesFor(who);
    const off = await this.optedOut(types.map((t) => addressFor(who, t)!));
    return types.map((t) => ({ kind: t.kind, label: t.label, audience: t.audience, email: !off.has(`${addressFor(who, t)}|${t.kind}`) }));
  }

  /** Applies { type: emailOn } for types this person receives (the route checks that). */
  async set(who: Recipient, changes: Map<NoticeType, boolean>, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [type, emailOn] of changes) {
        const address = addressFor(who, type)!;
        if (emailOn) {
          await tx.delete(emailOptOuts).where(and(eq(emailOptOuts.organisationId, this.org), eq(emailOptOuts.recipient, address), eq(emailOptOuts.kind, type.kind)));
        } else {
          await tx.insert(emailOptOuts).values({ organisationId: this.org, recipient: address, kind: type.kind, createdAt: now }).onConflictDoNothing();
        }
      }
    });
  }
}
