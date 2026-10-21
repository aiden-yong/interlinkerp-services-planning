import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

describe('shift templates API (FR-TPL-04)', () => {
  it('creates, lists, edits and deletes', async () => {
    const roleId = await h.addRole('Technician');
    const { status, body } = await h.call('POST', '/api/shift-templates', {
      name: 'Morning', role_id: roleId, start_time: '09:00', duration_minutes: 480, break_minutes: 60,
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.template).toMatchObject({ name: 'Morning', role_id: roleId, start_time: '09:00', duration_minutes: 480, break_minutes: 60 });

    const list = await h.call('GET', '/api/shift-templates');
    expect(list.body.templates.map((t: { name: string }) => t.name)).toEqual(['Morning']);

    const patched = await h.call('PATCH', `/api/shift-templates/${body.template.id}`, { start_time: '08:30' });
    expect(patched.status).toBe(200);
    expect(patched.body.template.start_time).toBe('08:30');

    expect((await h.call('DELETE', `/api/shift-templates/${body.template.id}`)).status).toBe(204);
    expect((await h.call('GET', '/api/shift-templates')).body.templates).toEqual([]);
  });

  it('validates', async () => {
    const { status, body } = await h.call('POST', '/api/shift-templates', {
      name: '', start_time: '25:00', duration_minutes: 0, break_minutes: -1, role_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details).sort()).toEqual(['break_minutes', 'duration_minutes', 'name', 'role_id', 'start_time'].sort());

    await h.call('POST', '/api/shift-templates', { name: 'Morning', start_time: '09:00', duration_minutes: 480 });
    const dup = await h.call('POST', '/api/shift-templates', { name: 'morning', start_time: '10:00', duration_minutes: 120 });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'TEMPLATE_NAME_TAKEN']);
  });

  it('saves a shift as a template (FR-TPL-04)', async () => {
    const roleId = await h.addRole('Technician');
    const created = await h.call('POST', '/api/shifts', {
      role_id: roleId, start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T18:00:00+08:00', break_minutes: 60,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const { status, body } = await h.call('POST', '/api/shift-templates', { name: 'From Shift', from_shift_id: created.body.shift.id });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.template).toMatchObject({ name: 'From Shift', start_time: '09:00', duration_minutes: 480, break_minutes: 60, role_id: roleId });
  });

  it('is for managers only', async () => {
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/shift-templates')).status).toBe(403);
  });
});
