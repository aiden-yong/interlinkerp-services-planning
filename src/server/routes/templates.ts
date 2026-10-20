import { DateTime } from 'luxon';
import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { isUniqueViolation } from '../support/ids';

const START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const BREAK_MAX = 32_767;
const taken = (name: string) => HttpError.conflict('TEMPLATE_NAME_TAKEN', `A shift template named "${name}" already exists.`);

/** Maps a unique-name race (two requests passing the pre-check at once) to the same 409 as the pre-check. */
async function saveNamed<T>(name: string, save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (isUniqueViolation(error)) throw taken(name);
    throw error;
  }
}

export function register(r: Router, app: App): void {
  r.add('GET', '/api/shift-templates', 'manager', 'List the shift templates managers can prefill a new shift from.', async () => {
    const templates = await app.templates().all();
    return json(200, { templates });
  }, op('List Shift Templates', 'See the saved shift templates', ['Filling a template picker when creating a shift'], ['Listing the roles shifts can require'],
    [], ['templates[].id', 'templates[].name', 'templates[].role_id', 'templates[].start_time', 'templates[].duration_minutes', 'templates[].break_minutes'],
    ['Planning Manager'], ['POST /api/shift-templates'], ['shift templates', 'templates', 'prefill']));

  r.add('POST', '/api/shift-templates', 'manager', 'Create a shift template, directly or by saving an existing shift.', async ({ body }) => {
    const input = new Input(await body());
    const name = input.string('name', 80, true);

    if (input.has('from_shift_id')) {
      const fromShiftId = input.string('from_shift_id', 36, true);
      input.check();
      const shift = (await app.shifts().find(fromShiftId!)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
      const zone = await app.settings().timezone();
      const startTime = DateTime.fromJSDate(shift.start, { zone }).toFormat('HH:mm');
      const durationMinutes = Math.round((shift.end.getTime() - shift.start.getTime()) / 60_000) - shift.breakMinutes;
      if (await app.templates().nameTaken(name!, null)) throw taken(name!);
      return json(201, {
        template: await saveNamed(name!, () => app.templates().create({
          name: name!, role_id: shift.roleId, start_time: startTime, duration_minutes: durationMinutes, break_minutes: shift.breakMinutes,
        }, app.clock().now())),
      });
    }

    const roleId = input.string('role_id', 36);
    const startTime = input.string('start_time', 5, true);
    if (startTime && !START_TIME.test(startTime)) input.error('start_time', 'Use 24-hour HH:MM.');
    const durationMinutes = input.int('duration_minutes', 1, 10_080, null);
    if (durationMinutes === null) input.error('duration_minutes', 'This field is required.');
    const breakMinutes = input.int('break_minutes', 0, BREAK_MAX, 0)!;
    if (roleId) {
      const role = await app.roles().find(roleId);
      if (!role) input.error('role_id', 'Unknown role.');
      else if (role.archived) input.error('role_id', 'This role is archived.');
    }
    input.check();
    if (await app.templates().nameTaken(name!, null)) throw taken(name!);
    return json(201, {
      template: await saveNamed(name!, () => app.templates().create({
        name: name!, role_id: roleId, start_time: startTime!, duration_minutes: durationMinutes!, break_minutes: breakMinutes,
      }, app.clock().now())),
    });
  }, op('Create Shift Template', 'Save a reusable shift prefill, from scratch or from an existing shift', ['Setting up a common shift pattern', 'Saving a shift just created as a template (FR-TPL-04)'],
    ['Creating a one-off shift'], ['name', 'role_id', 'start_time', 'duration_minutes', 'break_minutes', 'from_shift_id'], ['template'],
    ['Planning Manager', 'Name not already used', 'Role exists and is not archived (unless from_shift_id is used)'], ['GET /api/shift-templates', 'POST /api/shifts'],
    ['shift template', 'create template', 'save as template']));

  r.add('PATCH', '/api/shift-templates/{id}', 'manager', 'Change a shift template.', async ({ params, body }) => {
    const template = (await app.templates().find(params.id)) ?? (() => { throw HttpError.notFound('No shift template with that id.'); })();
    const input = new Input(await body());
    const fields: { name?: string; role_id?: string | null; start_time?: string; duration_minutes?: number; break_minutes?: number } = {};
    if (input.has('name')) fields.name = input.string('name', 80, true) ?? undefined;
    if (input.has('role_id')) {
      const roleId = input.string('role_id', 36);
      fields.role_id = roleId;
      if (roleId) {
        const role = await app.roles().find(roleId);
        if (!role) input.error('role_id', 'Unknown role.');
        else if (role.archived) input.error('role_id', 'This role is archived.');
      }
    }
    if (input.has('start_time')) {
      const startTime = input.string('start_time', 5, true);
      if (startTime && !START_TIME.test(startTime)) input.error('start_time', 'Use 24-hour HH:MM.');
      fields.start_time = startTime ?? undefined;
    }
    if (input.has('duration_minutes')) {
      const durationMinutes = input.int('duration_minutes', 1, 10_080, null);
      if (durationMinutes === null) input.error('duration_minutes', 'This field is required.');
      fields.duration_minutes = durationMinutes ?? undefined;
    }
    if (input.has('break_minutes')) fields.break_minutes = input.int('break_minutes', 0, BREAK_MAX, 0) ?? undefined;
    input.check();
    if (fields.name && (await app.templates().nameTaken(fields.name, template.id))) throw taken(fields.name);
    const name = fields.name ?? template.name;
    return json(200, { template: await saveNamed(name, () => app.templates().update(template.id, fields, app.clock().now())) });
  }, op('Update Shift Template', 'Change a saved shift template', ['Adjusting a template\'s default time, duration or break'], ['Creating a new template'],
    ['name', 'role_id', 'start_time', 'duration_minutes', 'break_minutes'], ['template'], ['Planning Manager', 'Template exists'], ['GET /api/shift-templates'],
    ['shift template', 'update template', 'edit template']));

  r.add('DELETE', '/api/shift-templates/{id}', 'manager', 'Delete a shift template.', async ({ params }) => {
    const template = await app.templates().find(params.id);
    if (!template) throw HttpError.notFound('No shift template with that id.');
    await app.templates().delete(template.id);
    return noContent();
  }, op('Delete Shift Template', 'Remove a shift template nobody needs any more', ['Cleaning up unused templates'], ['Archiving a role'],
    [], [], ['Planning Manager', 'Template exists'], ['GET /api/shift-templates'], ['shift template', 'delete template', 'remove template']));
}
