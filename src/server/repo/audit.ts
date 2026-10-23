import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type AuditAction, auditEntries } from '../db/schema';
import { isUuid } from '../support/ids';
import { iso } from '../support/time';
import type { ShiftRecord } from './shifts';

export type ActorKind = 'manager' | 'employee' | 'system';

/** One thing that happened to one shift (DR-04, D16). `actor` is an email (managers), an employee_ref (employees) or `system`. */
export interface AuditInput {
  shiftId: string;
  action: AuditAction;
  actor: string | null;
  actorKind: ActorKind;
  changes?: Record<string, [unknown, unknown]> | null;
}

/** Who did it, for the entries an operation records. */
export type AuditActor = Pick<AuditInput, 'actor' | 'actorKind'>;

export const managerActor = (email: string): AuditActor => ({ actor: email, actorKind: 'manager' });
export const employeeActor = (ref: string): AuditActor => ({ actor: ref, actorKind: 'employee' });
/** The recurrence cron (D16). */
export const SYSTEM_ACTOR: AuditActor = { actor: 'system', actorKind: 'system' };

const AUDITED: [keyof ShiftRecord, string][] = [
  ['employeeRef', 'employee_ref'], ['roleId', 'role_id'], ['start', 'start_at'], ['end', 'end_at'],
  ['breakMinutes', 'break_minutes'], ['percent', 'allocated_percent'], ['note', 'note'],
];

const plain = (v: unknown): unknown => (v instanceof Date ? iso(v) : v);

/** Fields that differ, as [old, new]; instants as ISO strings. Fields: employee_ref, role_id, start_at, end_at, break_minutes, allocated_percent, note, conflict_acknowledged (whether a warning is accepted, not who or when). */
export function diffShift(before: ShiftRecord, after: ShiftRecord): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [field, name] of AUDITED) {
    const [a, b] = [plain(before[field]), plain(after[field])];
    if (a !== b) out[name] = [a, b];
  }
  const [wasAcked, isAcked] = [before.ackAt !== null, after.ackAt !== null];
  if (wasAcked !== isAcked) out.conflict_acknowledged = [wasAcked, isAcked];
  return out;
}

/** diffShift, or null when nothing audited changed (so an entry stores no empty object). */
export function changesOf(before: ShiftRecord, after: ShiftRecord): Record<string, [unknown, unknown]> | null {
  const diff = diffShift(before, after);
  return Object.keys(diff).length > 0 ? diff : null;
}

/** DR-04: the audit trail. Written through a WriteScope, in the same transaction as the change it records. */
export class AuditRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  /** One multi-row insert; no-op for []. */
  async record(entries: AuditInput[], at: Date): Promise<void> {
    if (entries.length === 0) return;
    await this.db.insert(auditEntries).values(entries.map((e) => ({
      organisationId: this.org, shiftId: e.shiftId, action: e.action, actor: e.actor, actorKind: e.actorKind, changes: e.changes ?? null, at,
    })));
  }

  /** For shifts that are hard-deleted (never-published drafts), so no history is left pointing at a row that is gone. */
  async deleteForShifts(shiftIds: string[]): Promise<void> {
    if (shiftIds.length === 0) return;
    await this.db.delete(auditEntries).where(and(eq(auditEntries.organisationId, this.org), inArray(auditEntries.shiftId, shiftIds)));
  }

  /** Newest first; entries saved at the same instant come back in reverse order of saving. */
  async forShift(shiftId: string): Promise<(AuditInput & { at: Date })[]> {
    if (!isUuid(shiftId)) return [];
    const rows = await this.db.select().from(auditEntries)
      .where(and(eq(auditEntries.organisationId, this.org), eq(auditEntries.shiftId, shiftId)))
      .orderBy(desc(auditEntries.at), desc(auditEntries.id));
    return rows.map((r) => ({ shiftId: r.shiftId, action: r.action, actor: r.actor, actorKind: r.actorKind as ActorKind, changes: r.changes, at: r.at }));
  }
}
