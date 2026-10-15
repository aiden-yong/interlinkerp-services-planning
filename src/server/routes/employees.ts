import type { App } from '../app';
import { parseWorkingHours, WorkingHoursError } from '../domain/workingHours';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import type { DirectoryRow } from '../repo/directory';
import { blankProfile, type Profile } from '../repo/profiles';
import { isTimezone } from '../support/time';

function shape(row: DirectoryRow, profile: Profile, orgTimezone: string) {
  return {
    employee_ref: row.employeeRef,
    name: row.displayName,
    photo_url: row.photoUrl,
    department_id: row.departmentId,
    department_name: row.departmentName,
    status: row.status,
    role_ids: profile.roleIds,
    default_role_id: profile.defaultRoleId,
    timezone: profile.timezone,
    effective_timezone: profile.timezone ?? orgTimezone,
    working_hours: profile.workingHours,
  };
}

export function register(r: Router, app: App): void {
  r.add('GET', '/api/employees', 'manager', 'List plannable employees with their roles and working hours.', async () => {
    await app.directoryRefresher().refreshIfEmpty();
    const [rows, profiles, orgTimezone] = await Promise.all([app.directory().all(), app.profiles().all(), app.settings().timezone()]);
    return json(200, { employees: rows.map((row) => shape(row, profiles.get(row.employeeRef) ?? blankProfile(row.employeeRef), orgTimezone)) });
  }, op('List Employees', 'See who can be planned and how', ['Choosing who to put on a shift', 'Reviewing roles and working hours'], ['Reading shifts', 'Looking up personal details'],
    [], ['employees[].employee_ref', 'employees[].name', 'employees[].role_ids', 'employees[].working_hours'], ['Planning Manager'], ['PATCH /api/employees/{ref}', 'GET /api/schedule'],
    ['employees', 'staff', 'roster', 'team', 'people']));

  r.add('PATCH', '/api/employees/{ref}', 'manager', "Set an employee's planning roles, default role, time zone and working hours.", async ({ params, body }) => {
    const ref = params.ref;
    await app.directoryRefresher().refreshIfEmpty();
    const row = await app.directory().find(ref);
    if (!row) throw HttpError.notFound('No employee with that reference on the roster.');
    const current = await app.profiles().find(ref);
    const input = new Input(await body());

    let workingHours = current.workingHours;
    if (input.has('working_hours')) {
      const raw = input.raw('working_hours');
      try {
        workingHours = raw === null ? null : parseWorkingHours(raw);
      } catch (error) {
        if (!(error instanceof WorkingHoursError)) throw error;
        input.error('working_hours', error.message);
      }
    }
    const roleIds = input.has('role_ids') ? (input.stringList('role_ids', 50) ?? []) : current.roleIds;
    const known = await app.roles().ids();
    const unknown = roleIds.find((id) => !known.has(id));
    const newlyArchived = roleIds.find((id) => known.get(id) === true && !current.roleIds.includes(id));
    if (unknown) input.error('role_ids', `Unknown role ${unknown}.`);
    else if (newlyArchived) input.error('role_ids', `Role ${newlyArchived} is archived and cannot be newly assigned.`);
    const defaultRoleId = input.has('default_role_id') ? input.string('default_role_id', 36) : current.defaultRoleId;
    if (defaultRoleId && !roleIds.includes(defaultRoleId)) input.error('default_role_id', "The default role must be one of the employee's roles.");
    const timezone = input.has('timezone') ? input.string('timezone', 64) : current.timezone;
    if (timezone && !isTimezone(timezone)) input.error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
    input.check();

    await app.profiles().save({ employeeRef: ref, roleIds, defaultRoleId, timezone, workingHours }, app.clock().now());
    return json(200, { employee: shape(row, await app.profiles().find(ref), await app.settings().timezone()) });
  }, op('Update Planning Profile', 'Change how an employee can be planned', ['Giving someone a role', 'Setting part-time working hours', 'Marking someone as flexible hours'], ['Changing personal details on the roster'],
    ['role_ids', 'default_role_id', 'timezone', 'working_hours'], ['employee'], ['Planning Manager', 'Employee on the roster'], ['GET /api/employees', 'GET /api/roles'],
    ['working hours', 'schedule', 'roles', 'part time', 'flexible']));
}
