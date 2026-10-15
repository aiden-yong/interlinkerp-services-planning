import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { isUniqueViolation } from '../support/ids';

const COLOR = /^#[0-9a-fA-F]{6}$/;
const taken = (name: string) => HttpError.conflict('ROLE_NAME_TAKEN', `A role named "${name}" already exists.`);

export function register(r: Router, app: App): void {
  r.add('GET', '/api/roles', 'person', 'List the roles shifts can require.', async ({ query }) =>
    json(200, { roles: await app.roles().all(query.include_archived === 'true') }),
  op('List Roles', 'See the job roles shifts are planned for', ['Filling a role picker', 'Showing role names and colours on a schedule'], ['Finding which employees hold a role'],
    ['include_archived'], ['roles[].id', 'roles[].name', 'roles[].color', 'roles[].archived'], ['Signed-in person'], ['POST /api/roles', 'GET /api/employees'],
    ['roles', 'job roles', 'positions', 'skills']));

  r.add('POST', '/api/roles', 'manager', 'Create a role.', async ({ body }) => {
    const input = new Input(await body());
    const name = input.string('name', 80, true);
    const color = input.string('color', 7, true);
    if (color && !COLOR.test(color)) input.error('color', 'Use a hex colour such as #3B82F6.');
    input.check();
    if (await app.roles().nameTaken(name!, null)) throw taken(name!);
    try {
      return json(201, { role: await app.roles().create(name!, color!.toUpperCase(), app.clock().now()) });
    } catch (error) {
      if (isUniqueViolation(error)) throw taken(name!); // two managers creating the same name at once
      throw error;
    }
  }, op('Create Role', 'Add a job role that shifts can require', ['Setting up a new kind of work to plan'], ['Renaming an existing role'],
    ['name', 'color'], ['role'], ['Planning Manager', 'Name not already used'], ['GET /api/roles', 'PATCH /api/roles/{id}'],
    ['role', 'create role', 'add position']));

  r.add('PATCH', '/api/roles/{id}', 'manager', 'Rename, recolour or archive a role.', async ({ params, body }) => {
    const role = (await app.roles().find(params.id)) ?? (() => { throw HttpError.notFound('No role with that id.'); })();
    const input = new Input(await body());
    const fields: { name?: string; color?: string; archived?: boolean } = {};
    if (input.has('name')) fields.name = input.string('name', 80, true) ?? undefined;
    if (input.has('color')) {
      const color = input.string('color', 7, true);
      if (color && !COLOR.test(color)) input.error('color', 'Use a hex colour such as #3B82F6.');
      fields.color = color?.toUpperCase();
    }
    if (input.has('archived')) fields.archived = input.bool('archived');
    input.check();
    if (fields.name && (await app.roles().nameTaken(fields.name, role.id))) throw taken(fields.name);
    return json(200, { role: await app.roles().update(role.id, fields, app.clock().now()) });
  }, op('Update Role', 'Change or retire a role', ['Renaming a role', 'Archiving a role nobody uses any more'], ['Creating a role'],
    ['name', 'color', 'archived'], ['role'], ['Planning Manager', 'Role exists'], ['GET /api/roles'],
    ['role', 'archive role', 'rename role']));
}
