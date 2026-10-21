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
      does: ['See the schedule for a week or month', 'Create a shift', 'Move or reassign a shift', 'Duplicate or delete a shift', 'Undo a deletion'],
      best_for: 'Managers building and adjusting the team schedule.',
      endpoints: ['GET /api/schedule', 'POST /api/shifts', 'GET /api/shifts/{id}', 'PATCH /api/shifts/{id}', 'DELETE /api/shifts/{id}', 'POST /api/shift-splits', 'POST /api/shift-restorations'],
    },
    {
      name: 'Reuse Shift Patterns',
      icon: '📋',
      description: 'Save common shift shapes and prefill new shifts from them.',
      does: ['Save a name, role, start time, duration and break as a template', 'Save an existing shift as a template', 'List, edit and delete templates'],
      best_for: 'Managers who plan the same kind of shift often.',
      endpoints: ['GET /api/shift-templates', 'POST /api/shift-templates', 'PATCH /api/shift-templates/{id}', 'DELETE /api/shift-templates/{id}'],
    },
    {
      name: 'Share Schedules',
      icon: '📣',
      description: 'Publish planned shifts and let employees see their own.',
      does: ['Publish a week of shifts', 'See my own shifts', "Copy last week's shifts into this week as drafts"],
      best_for: 'Getting the plan from the manager to the team.',
      endpoints: ['POST /api/publications', 'GET /api/my/shifts', 'POST /api/week-copies'],
    },
    {
      name: 'Swap and Pick Up Shifts',
      icon: '🔁',
      description: 'Let employees take open shifts and hand over shifts they cannot work.',
      does: ['See open shifts I can take', 'Claim an open shift', 'Put a shift up for switch', 'Take over a colleague\'s shift', 'Give up a shift'],
      best_for: 'Employees managing their own hours within the rules.',
      endpoints: ['GET /api/my/open-shifts', 'POST /api/shift-claims', 'POST /api/switch-requests', 'DELETE /api/switch-requests/{shift_id}', 'POST /api/switch-takeovers', 'POST /api/unassignments'],
    },
    {
      name: 'Stay Informed',
      icon: '🔔',
      description: 'Notices about published, changed, claimed and switched shifts.',
      does: ['See my notifications', 'Mark notifications read', 'Choose which notices are also emailed'],
      best_for: 'Showing people what changed without them checking the schedule.',
      endpoints: ['GET /api/notifications', 'POST /api/notification-reads', 'GET /api/my/notification-preferences', 'PATCH /api/my/notification-preferences'],
    },
    {
      name: 'Report on Planning',
      icon: '📊',
      description: 'Planned hours, utilisation and unfilled open shifts over any period, with CSV export.',
      does: ['Total planned hours by employee, role or department, draft and published apart', 'Compare allocated with available hours and find over-allocated days', 'Count open shifts per role per day', 'Download any report as CSV'],
      best_for: 'Managers reviewing capacity and coverage across weeks, months or a year.',
      endpoints: ['GET /api/reports/planned-hours', 'GET /api/reports/utilisation', 'GET /api/reports/open-shifts'],
    },
  ] as Capability[],
  workflows: [
    { name: 'Plan and publish a week', steps: ['GET /api/schedule', 'POST /api/shifts', 'PATCH /api/shifts/{id}', 'POST /api/publications'] },
  ],
  related_services: ['intern-database', 'department-api'],
};
