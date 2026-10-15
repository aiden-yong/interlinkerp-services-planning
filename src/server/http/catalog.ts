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
  capabilities: [
    {
      name: 'Check Access',
      icon: '🔑',
      description: 'See who is signed in and whether they can manage planning.',
      does: ['See who is signed in', 'Check if someone is a Planning Manager'],
      best_for: 'Screens that change depending on who is looking.',
      endpoints: ['GET /api/me'],
    },
  ] as Capability[],
  workflows: [
    { name: 'Plan and publish a week', steps: ['GET /api/schedule', 'POST /api/shifts', 'PATCH /api/shifts/{id}', 'POST /api/publications'] },
  ],
  related_services: ['intern-database', 'department-api'],
};
