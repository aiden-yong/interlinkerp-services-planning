export interface Capability {
  name: string;
  icon: string;
  description: string;
  does: string[];
  best_for: string;
  endpoints: string[];
}

/**
 * Service-level catalogue metadata (contract SS-23, SS-27). Every person or
 * manager route must appear in a capability; openapi.test.ts checks this.
 */
export const catalog = {
  domain: 'Operations',
  owner: 'services-team',
  app_url: '/',
  category: 'Operations',
  industries: ['Operations', 'Human Resources'],
  use_cases: [
    'Planning weekly shifts for a services team',
    'Publishing a work schedule to employees',
    'Checking who is working when',
    'Spotting double bookings and people scheduled on leave',
  ],
  capabilities: [] as Capability[],
  workflows: [
    { name: 'Plan and publish a week', steps: ['GET /api/schedule', 'POST /api/shifts', 'PATCH /api/shifts/{id}', 'POST /api/publications'] },
  ],
  related_services: ['intern-database', 'department-api'],
};
