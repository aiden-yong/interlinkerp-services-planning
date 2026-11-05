import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { WorkingHoursMap } from '../db/schema';
import { formatSpan } from '../notifications/messages';
import { DEMO_EMAIL, DEMO_EMPLOYEE_REF, DEMO_VIEW_EMPLOYEE_REF } from './demo';

/** Weeks of sample shifts, counted from the current week. */
export const FIRST_WEEK = -6;
export const LAST_WEEK = 3;

const COLORS = { field: '#0F766E', desk: '#2563EB', dispatch: '#7C3AED', lead: '#C2410C', supervisor: '#BE185D' } as const;
const ROLE_NAMES: Record<RoleKey, string> = { field: 'Field Technician', desk: 'Service Desk', dispatch: 'Dispatcher', lead: 'Installation Lead', supervisor: 'Site Supervisor' };
type RoleKey = keyof typeof COLORS;

const DEPARTMENTS = { field: 'Field Services', support: 'Customer Support', projects: 'Project Delivery' } as const;
type DepartmentKey = keyof typeof DEPARTMENTS;

type Span = [string, string];
const OFFICE: Span[] = [['09:00', '13:00'], ['14:00', '18:00']];
const DESK: Span[] = [['08:00', '13:00'], ['13:00', '18:00']];

function hours(days: Partial<WorkingHoursMap>): WorkingHoursMap {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [], ...days };
}
const weekdays = (spans: Span[]) => hours({ mon: spans, tue: spans, wed: spans, thu: spans, fri: spans });

interface Person {
  ref: string;
  name: string;
  email: string;
  department: DepartmentKey;
  roles: RoleKey[];
  hours: WorkingHoursMap | null;
  /** Their usual week: which days (1 = Monday), in which shift pattern. */
  days: number[];
  pattern: 'day' | 'install' | 'desk' | 'dispatch';
}

/** Fictional people. SVC-001 is who every demo visitor signs in as. */
const PEOPLE: Person[] = [
  { ref: DEMO_EMPLOYEE_REF, name: 'Demo Manager', email: DEMO_EMAIL, department: 'field', roles: ['supervisor', 'field'], hours: weekdays(OFFICE), days: [1, 2, 3, 4, 5], pattern: 'day' },
  { ref: 'SVC-002', name: 'Nadia Rahman', email: 'nadia.rahman@interlinkerp.example', department: 'field', roles: ['field'], hours: weekdays(OFFICE), days: [1, 2, 3, 4], pattern: 'day' },
  { ref: 'SVC-003', name: 'Lim Wei Jie', email: 'wei.jie@interlinkerp.example', department: 'field', roles: ['field'], hours: hours({ tue: OFFICE, wed: OFFICE, thu: OFFICE, fri: OFFICE, sat: OFFICE, sun: OFFICE }), days: [2, 3, 4, 5], pattern: 'day' },
  { ref: 'SVC-004', name: 'Hafiz Ismail', email: 'hafiz.ismail@interlinkerp.example', department: 'field', roles: ['field', 'lead'], hours: weekdays(OFFICE), days: [1, 3, 4, 5], pattern: 'install' },
  { ref: 'SVC-005', name: 'Priya Nair', email: 'priya.nair@interlinkerp.example', department: 'support', roles: ['dispatch'], hours: weekdays(OFFICE), days: [2, 3, 4, 5], pattern: 'dispatch' },
  { ref: 'SVC-006', name: 'Mei Ling Chong', email: 'mei.ling@interlinkerp.example', department: 'support', roles: ['desk'], hours: weekdays(DESK), days: [1, 2, 3, 4, 5], pattern: 'desk' },
  { ref: 'SVC-007', name: 'Arjun Menon', email: 'arjun.menon@interlinkerp.example', department: 'support', roles: ['desk'], hours: weekdays(DESK), days: [1, 2, 3, 4, 5], pattern: 'desk' },
  { ref: 'SVC-008', name: 'Siti Aminah', email: 'siti.aminah@interlinkerp.example', department: 'support', roles: ['desk', 'dispatch'], hours: hours({ tue: DESK, thu: DESK }), days: [2, 4], pattern: 'desk' },
  { ref: 'SVC-009', name: 'Jason Goh', email: 'jason.goh@interlinkerp.example', department: 'projects', roles: ['lead'], hours: weekdays(OFFICE), days: [1, 2, 3, 4], pattern: 'install' },
  { ref: 'SVC-010', name: 'Farah Aziz', email: 'farah.aziz@interlinkerp.example', department: 'projects', roles: ['field'], hours: weekdays(OFFICE), days: [1, 2, 4, 5], pattern: 'install' },
  { ref: 'SVC-011', name: 'Daniel Wong', email: 'daniel.wong@interlinkerp.example', department: 'projects', roles: ['supervisor'], hours: null, days: [1, 3, 5], pattern: 'day' },
  { ref: 'SVC-012', name: 'Kavitha Raj', email: 'kavitha.raj@interlinkerp.example', department: 'support', roles: ['dispatch'], hours: weekdays(OFFICE), days: [2, 3, 4], pattern: 'dispatch' },
];

const ROLE_OF_PATTERN: Record<Person['pattern'], (p: Person) => RoleKey> = {
  day: (p) => p.roles[0]!,
  install: (p) => (p.roles.includes('lead') ? 'lead' : 'field'),
  desk: () => 'desk',
  dispatch: () => 'dispatch',
};

const NOTES = ['Klang Valley call-outs', 'Rack install, Level 12', 'Preventive maintenance round', 'Customer site visit', 'Fibre upgrade, Shah Alam'];

export interface SampleShift {
  id: string;
  employeeRef: string | null;
  role: RoleKey;
  start: Date;
  end: Date;
  breakMinutes: number;
  note: string | null;
  published: boolean;
  switchRequested?: boolean;
  acknowledged?: boolean;
  recurrenceIndex?: number;
}

export interface SampleNotice {
  kind: string;
  audience: 'employee' | 'managers';
  /** Employee notices only: who gets it. */
  recipientRef: string | null;
  title: string;
  body: string;
  path: string;
  shiftId: string | null;
  ageHours: number;
  read: boolean;
}

/** Everything the seeder writes, dated relative to `now`, so the board always opens on a lived-in current week. */
export function buildSampleData(now: Date, zone: string) {
  const monday = DateTime.fromJSDate(now, { zone }).startOf('week');
  /** `week` counts from the current week; `day` is 1 (Monday) to 7 (Sunday). */
  const at = (week: number, day: number, time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return monday.plus({ weeks: week, days: day - 1 }).set({ hour, minute });
  };
  const roleIds = Object.fromEntries((Object.keys(COLORS) as RoleKey[]).map((key) => [key, randomUUID()])) as Record<RoleKey, string>;
  const shifts: SampleShift[] = [];
  const add = (employeeRef: string | null, role: RoleKey, week: number, day: number, from: string, to: string, extra: Partial<SampleShift> = {}) => {
    const shift: SampleShift = {
      id: randomUUID(), employeeRef, role, start: at(week, day, from).toJSDate(), end: at(week, day, to).toJSDate(),
      breakMinutes: 0, note: null, published: week <= 0 || (week === 1 && day <= 3), ...extra,
    };
    shifts.push(shift);
    return shift;
  };

  // Mei Ling's leave is next Wednesday to Friday, so she has no shifts then.
  const onLeave = (p: Person, week: number, day: number) => p.ref === 'SVC-006' && week === 1 && day >= 3 && day <= 5;

  for (let week = FIRST_WEEK; week <= LAST_WEEK; week++) {
    for (const [index, person] of PEOPLE.entries()) {
      for (const day of person.days) {
        if (onLeave(person, week, day)) continue;
        const role = ROLE_OF_PATTERN[person.pattern](person);
        if (person.pattern === 'desk') {
          const morning = (week + day + index) % 2 === 0;
          add(person.ref, role, week, day, morning ? '08:00' : '13:00', morning ? '13:00' : '18:00');
        } else if (person.pattern === 'install') {
          add(person.ref, role, week, day, '09:00', '17:30', { breakMinutes: 60, note: (week + day + index) % 3 === 0 ? NOTES[(week + 6 + day) % NOTES.length]! : null });
        } else {
          add(person.ref, role, week, day, '09:00', '18:00', { breakMinutes: 60, note: role === 'field' && (week + day) % 4 === 0 ? NOTES[(week + 6 + day) % NOTES.length]! : null });
        }
      }
    }
  }

  // A repeating shift: Kavitha opens dispatch every Monday.
  const seriesStart = at(FIRST_WEEK, 1, '09:00');
  const seriesCount = LAST_WEEK - FIRST_WEEK + 7;
  const recurrenceId = randomUUID();
  for (let i = 0; i < seriesCount; i++) {
    const week = FIRST_WEEK + i;
    add('SVC-012', 'dispatch', week, 1, '09:00', '18:00', { breakMinutes: 60, note: 'Opens dispatch', recurrenceIndex: i, published: week <= 1 });
  }
  const seriesEnd = at(FIRST_WEEK + seriesCount - 1, 1, '18:00');

  // My Planning lists the week on screen, so this weekend has something to claim and take over, and Auto Plan something to fill.
  add(null, 'field', 0, 6, '09:00', '14:00', { published: true, note: 'Saturday service round' });
  add(null, 'field', 0, 7, '18:00', '22:00', { published: true, note: 'Sunday evening stand-by' });
  add('SVC-003', 'field', 0, 6, '15:00', '18:00', { published: true, switchRequested: true, note: 'Swap wanted: family event' });
  // Auto Plan only assigns a shift that fits inside one block of someone's working hours, so these are half days.
  add(null, 'desk', 0, 7, '09:00', '13:00', { published: false, note: 'Weekend desk cover' }); // the desk has nobody on Sundays, so this stays open, with the reason
  add(null, 'field', 0, 5, '09:00', '13:00', { published: false, note: 'Generator servicing, Klang' }); // Nadia is free on Fridays
  add(null, 'field', 0, 6, '10:00', '13:00', { published: false, note: 'Weekend meter readings' }); // Lim Wei Jie works weekends
  add(null, 'field', 0, 7, '14:00', '18:00', { published: false, note: 'Sunday call-outs' });

  // Open shifts visitors can claim on My Planning: published, and clear of the demo visitor's own shifts.
  add(null, 'field', 1, 3, '18:30', '22:30', { published: true, note: 'After-hours call-out cover' });
  add(null, 'field', 1, 6, '09:00', '14:00', { published: true, note: 'Saturday service round' });
  add(null, 'supervisor', 2, 6, '09:00', '14:00', { published: true, note: 'Weekend site handover' });
  add(null, 'desk', 1, 2, '18:00', '21:00', { published: true, note: 'Late desk cover' });

  // Draft open shifts for Auto Plan. Both lead-role holders work Thursdays, so that one comes back unfilled.
  add(null, 'field', 1, 5, '09:00', '13:00', { published: false, note: 'Generator servicing, Subang' });
  add(null, 'field', 2, 1, '14:00', '18:00', { published: false });
  add(null, 'desk', 1, 4, '08:00', '13:00', { published: false });
  add(null, 'dispatch', 2, 1, '09:00', '13:00', { published: false });
  add(null, 'lead', 1, 4, '09:00', '13:00', { published: false, note: 'Second crew, data hall' });

  // A colleague's Saturday shift, up for grabs: the demo visitor can take it over.
  add('SVC-003', 'field', 1, 6, '09:00', '14:00', { published: true, switchRequested: true, note: 'Swap wanted: family event' });

  // Things the board flags. A double booking, a shift against approved leave (accepted), the wrong role, and too many hours.
  add('SVC-003', 'field', 1, 4, '16:00', '20:00', { published: false, note: 'Overlaps the day shift' });
  add('SVC-009', 'lead', 1, 5, '09:00', '13:00', { published: false, acknowledged: true, note: 'Client asked for Jason; leave clash accepted' });
  add('SVC-010', 'desk', 0, 3, '18:00', '20:00', { published: false, note: 'Not a Service Desk role' });
  add('SVC-002', 'field', 1, 3, '18:30', '22:30', { published: false, note: 'Long day: over planned hours' });

  const claimed = shifts.find((s) => s.employeeRef === 'SVC-008' && s.start > at(1, 1, '00:00').toJSDate())!;
  const openToTake = shifts.filter((s) => s.employeeRef === null && s.published && s.role !== 'desk');
  const span = (shift: SampleShift) => formatSpan(shift.start, shift.end, zone);
  // Both people a visitor can be have an inbox to open.
  const employeeNotices = (ref: string): SampleNotice[] => {
    const nextWeek = shifts.filter((s) => s.employeeRef === ref && s.published && s.start >= at(1, 1, '00:00').toJSDate());
    const first = nextWeek[0]!;
    return [
      { kind: 'schedule_published', audience: 'employee', recipientRef: ref, title: `Your ${nextWeek.length} shifts were published`, body: nextWeek.map(span).join('\n'), path: '/my', shiftId: null, ageHours: 20, read: false },
      { kind: 'open_shifts_available', audience: 'employee', recipientRef: ref, title: `${openToTake.length} open shifts you can take`, body: openToTake.map(span).join('\n'), path: '/my', shiftId: null, ageHours: 26, read: false },
      { kind: 'shift_assigned', audience: 'employee', recipientRef: ref, title: 'You have a new shift', body: span(first), path: '/my', shiftId: first.id, ageHours: 72, read: true },
    ];
  };
  const notices = ([
    { kind: 'shift_claimed', audience: 'managers', recipientRef: null, title: 'Open shift claimed', body: `Siti Aminah claimed the open shift on ${span(claimed)}.`, path: '/schedule', shiftId: claimed.id, ageHours: 3, read: false },
    ...employeeNotices(DEMO_EMPLOYEE_REF),
    ...employeeNotices(DEMO_VIEW_EMPLOYEE_REF),
  ] satisfies SampleNotice[] as SampleNotice[]).sort((a, b) => b.ageHours - a.ageHours); // the inbox lists the latest insert first, so the oldest goes in first

  return {
    settings: { countryCode: 'MY', regionCode: null, timezone: zone, giveUpMode: 'switch', unassignWindowDays: 2, recurrenceHorizonMonths: 6, reminderLeadMinutes: 60 },
    roles: (Object.keys(COLORS) as RoleKey[]).map((key) => ({ id: roleIds[key], name: ROLE_NAMES[key], color: COLORS[key] })),
    roleIds,
    people: PEOPLE.map((p, i) => ({
      ref: p.ref, name: p.name, email: p.email, departmentId: p.department, departmentName: DEPARTMENTS[p.department],
      roleIds: p.roles.map((r) => roleIds[r]), defaultRoleId: roleIds[p.roles[0]!], workingHours: p.hours, order: i,
    })),
    templates: [
      { name: 'Field day', role: 'field', startTime: '09:00', durationMinutes: 540, breakMinutes: 60 },
      { name: 'Site install', role: 'lead', startTime: '09:00', durationMinutes: 510, breakMinutes: 60 },
      { name: 'Desk morning', role: 'desk', startTime: '08:00', durationMinutes: 300, breakMinutes: 0 },
      { name: 'Desk afternoon', role: 'desk', startTime: '13:00', durationMinutes: 300, breakMinutes: 0 },
      { name: 'Dispatch day', role: 'dispatch', startTime: '09:00', durationMinutes: 540, breakMinutes: 60 },
    ] satisfies { name: string; role: RoleKey; startTime: string; durationMinutes: number; breakMinutes: number }[],
    timeOff: [
      { employeeRef: 'SVC-006', start: at(1, 3, '00:00').toJSDate(), end: at(1, 6, '00:00').toJSDate(), reason: 'Annual leave' },
      { employeeRef: 'SVC-009', start: at(1, 5, '00:00').toJSDate(), end: at(1, 6, '00:00').toJSDate(), reason: 'Family event' },
      { employeeRef: 'SVC-004', start: at(0, 2, '00:00').toJSDate(), end: at(0, 3, '00:00').toJSDate(), reason: 'Medical appointment' },
      { employeeRef: 'SVC-007', start: at(2, 4, '00:00').toJSDate(), end: at(2, 6, '00:00').toJSDate(), reason: 'Training course' },
    ],
    holidays: fixedHolidays(monday.year),
    managers: [DEMO_EMAIL, 'daniel.wong@interlinkerp.example'],
    recurrence: {
      id: recurrenceId, interval: 1, unit: 'week', ends: 'after', count: seriesCount, roleId: roleIds.dispatch, employeeRef: 'SVC-012',
      firstStartLocal: seriesStart.toFormat('yyyy-MM-dd HH:mm:ss'), durationMinutes: 540, breakMinutes: 60, note: 'Opens dispatch', generatedUntil: seriesEnd.toJSDate(),
    },
    shifts,
    notices,
  };
}

/** Only holidays that fall on the same date every year, so the sample calendar is never wrong. */
function fixedHolidays(year: number): { date: string; name: string }[] {
  return [year, year + 1].flatMap((y) => [
    { date: `${y}-01-01`, name: "New Year's Day" },
    { date: `${y}-05-01`, name: 'Labour Day' },
    { date: `${y}-08-31`, name: 'Merdeka Day' },
    { date: `${y}-09-16`, name: 'Malaysia Day' },
    { date: `${y}-12-25`, name: 'Christmas Day' },
  ]);
}
