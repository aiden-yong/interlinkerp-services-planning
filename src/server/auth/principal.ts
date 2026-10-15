import type { RosterLookup } from './session';

/** Who is calling: a signed-in person, or a program with a gateway access token. */
export interface Principal {
  kind: 'person' | 'client';
  subject: string;
  email: string | null;
  name: string | null;
  gatewayRole: string | null;
  employeeRef: string | null;
  /** People only: what the last roster lookup said. Absent means unknown; read employeeRef first. */
  rosterStatus?: RosterLookup;
  isManager: boolean;
  scopes: string[];
}

/** Stored in created_by / granted_by columns. */
export function actorId(p: Principal): string {
  return p.kind === 'person' ? (p.email ?? p.subject) : `client:${p.subject}`;
}
