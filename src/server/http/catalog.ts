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
      does: ['See who is signed in', 'Check if someone is a Planning Manager', 'Grant or revoke Planning Manager access'],
      best_for: 'Screens that change depending on who is looking.',
      endpoints: ['GET /api/me', 'GET /api/managers', 'POST /api/managers', 'DELETE /api/managers/{email}'],
    },
    {
      name: 'Configure Planning',
      icon: '⚙️',
      description: 'Set up the roles and organisation settings planning relies on.',
      does: ['Create and archive roles', 'Set the organisation time zone and country'],
      best_for: 'Planning Managers setting Planning up for their team.',
      endpoints: ['GET /api/roles', 'POST /api/roles', 'PATCH /api/roles/{id}', 'GET /api/settings', 'PATCH /api/settings'],
    },
    {
      name: 'Manage Team Profiles',
      icon: '👥',
      description: 'See plannable employees and set their roles and working hours.',
      does: ['List the team', 'Give an employee roles', 'Set working hours or flexible hours'],
      best_for: 'Managers preparing who can be scheduled for what.',
      endpoints: ['GET /api/employees', 'PATCH /api/employees/{ref}'],
    },
    {
      name: 'Track Time Off',
      icon: '🏖️',
      description: 'Record when people are away and which public holidays apply.',
      does: ['Record leave for an employee', 'Add, hide or sync public holidays'],
      best_for: 'Keeping the schedule from planning people who are away.',
      endpoints: [
        'GET /api/unavailabilities', 'POST /api/unavailabilities', 'PATCH /api/unavailabilities/{id}', 'DELETE /api/unavailabilities/{id}',
        'GET /api/holidays', 'POST /api/holidays', 'PATCH /api/holidays/{id}', 'DELETE /api/holidays/{id}', 'POST /api/holiday-syncs',
      ],
    },
    {
      name: 'Plan Shifts',
      icon: '🗓️',
      description: 'Create and change shifts, with warnings when a shift breaks a planning rule.',
      does: ['Create a shift', 'Move or reassign a shift', 'Duplicate or delete a shift', 'Undo a deletion'],
      best_for: 'Managers building and adjusting the team schedule.',
      endpoints: ['POST /api/shifts', 'GET /api/shifts/{id}', 'PATCH /api/shifts/{id}'],
    },
  ] as Capability[],
  workflows: [
    { name: 'Plan and publish a week', steps: ['GET /api/schedule', 'POST /api/shifts', 'PATCH /api/shifts/{id}', 'POST /api/publications'] },
  ],
  related_services: ['intern-database', 'department-api'],
};
