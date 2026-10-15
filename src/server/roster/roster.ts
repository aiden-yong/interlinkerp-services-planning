export interface RosterPerson {
  ref: string;
  name: string;
  email: string | null;
  photoUrl: string | null;
  departmentId: string | null;
  status: string;
}

export class RosterUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterUnavailable';
  }
}

/** IF-02. The only code that knows where the employee roster lives (OI-03). */
export interface Roster {
  findByEmail(email: string): Promise<RosterPerson | null>;
  listPlannable(): Promise<RosterPerson[]>;
}

/** IF-03 */
export interface DepartmentNames {
  all(): Promise<Map<string, string>>;
}

const NOT_CONFIGURED = 'No InterlinkERP API client is configured (INTERLINK_CLIENT_ID / INTERN_DATABASE_URL / DEPARTMENT_API_URL).';

/** Used when no API client is configured: behaves like a roster that is down (NFR-06). */
export const unconfiguredRoster: Roster & DepartmentNames = {
  findByEmail: async () => {
    throw new RosterUnavailable(NOT_CONFIGURED);
  },
  listPlannable: async () => {
    throw new RosterUnavailable(NOT_CONFIGURED);
  },
  all: async () => {
    throw new RosterUnavailable(NOT_CONFIGURED);
  },
};
