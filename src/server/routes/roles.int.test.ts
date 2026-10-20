import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

describe('roles API (FR-CFG-01)', () => {
  it('creates and lists', async () => {
    const { status, body } = await h.call('POST', '/api/roles', { name: ' Technician ', color: '#22c55e' });
    expect(status).toBe(201);
    expect(body.role).toMatchObject({ name: 'Technician', color: '#22C55E', archived: false });

    h.asEmployee('E1');
    expect((await h.call('GET', '/api/roles')).body.roles.map((r: { name: string }) => r.name)).toEqual(['Technician']);
  });

  it('pages the list with limit and offset (contract SS-12)', async () => {
    for (const name of ['A', 'B', 'C']) await h.addRole(name);
    const page = await h.call('GET', '/api/roles', undefined, { limit: 2, offset: 1 });
    expect(page.body.roles.map((r: { name: string }) => r.name)).toEqual(['B', 'C']);
    expect(page.body.pagination).toEqual({ limit: 2, offset: 1, total: 3 });
    expect((await h.call('GET', '/api/roles', undefined, { limit: 100000 })).body.pagination.limit).toBe(1000);
    expect((await h.call('GET', '/api/roles', undefined, { limit: 0 })).status).toBe(422);
    expect((await h.call('GET', '/api/roles', undefined, { offset: -1 })).status).toBe(422);
    for (const path of ['/api/employees', '/api/managers', '/api/notifications']) expect((await h.call('GET', path, undefined, { limit: 0 })).status, path).toBe(422);
  });

  it('refuses a duplicate name regardless of case', async () => {
    await h.addRole('Technician');
    const { status, body } = await h.call('POST', '/api/roles', { name: 'technician', color: '#000000' });
    expect([status, body.error.code]).toEqual([409, 'ROLE_NAME_TAKEN']);
  });

  it('names invalid fields', async () => {
    const { status, body } = await h.call('POST', '/api/roles', { name: '', color: 'green' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['name', 'color']);
  });

  it('renames and archives; archived roles are hidden by default', async () => {
    const id = await h.addRole('Technician');
    const { body } = await h.call('PATCH', `/api/roles/${id}`, { name: 'Field Technician', archived: true });
    expect(body.role).toMatchObject({ name: 'Field Technician', archived: true });
    expect((await h.call('GET', '/api/roles')).body.roles).toEqual([]);
    expect((await h.call('GET', '/api/roles', undefined, { include_archived: 'true' })).body.roles).toHaveLength(1);
  });

  it('refuses renaming onto another role name regardless of case', async () => {
    await h.addRole('Technician');
    const id = await h.addRole('Driver');
    const { status, body } = await h.call('PATCH', `/api/roles/${id}`, { name: 'technician' });
    expect([status, body.error.code]).toEqual([409, 'ROLE_NAME_TAKEN']);
  });

  it('names a non-string name and a null archived flag as invalid fields', async () => {
    const id = await h.addRole('Technician');
    const named = await h.call('PATCH', `/api/roles/${id}`, { name: 5 });
    expect(named.status).toBe(422);
    expect(Object.keys(named.body.error.details)).toEqual(['name']);
    const archived = await h.call('PATCH', `/api/roles/${id}`, { archived: null });
    expect(archived.status).toBe(422);
    expect(Object.keys(archived.body.error.details)).toEqual(['archived']);
  });

  it('returns 404 for a well-formed id that matches no role', async () => {
    expect((await h.call('PATCH', '/api/roles/00000000-0000-4000-8000-000000000000', { name: 'X' })).status).toBe(404);
  });

  it('returns 404, 403 and 401 where it should', async () => {
    expect((await h.call('PATCH', '/api/roles/not-a-uuid', { name: 'X' })).status).toBe(404);
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/roles', { name: 'X', color: '#000000' })).status).toBe(403);
    h.asNobody();
    expect((await h.call('GET', '/api/roles')).status).toBe(401);
  });
});
