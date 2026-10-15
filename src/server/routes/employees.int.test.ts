import { describe, expect, it } from 'vitest';
import { employeeProfiles } from '../db/schema';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const HOURS = { mon: [['09:00', '13:00'], ['14:00', '18:00']] };

describe('employees API (FR-CFG-02)', () => {
  it('shows a never-configured employee with no roles and flexible hours (AC1)', async () => {
    await h.addEmployee('E1', 'Ana Lim', 'DEP-1', 'Field Services');
    const { status, body } = await h.call('GET', '/api/employees');
    expect(status).toBe(200);
    expect(body.employees).toEqual([{
      employee_ref: 'E1', name: 'Ana Lim', photo_url: null, department_id: 'DEP-1', department_name: 'Field Services', status: 'Active',
      role_ids: [], default_role_id: null, timezone: null, effective_timezone: 'Asia/Kuala_Lumpur', working_hours: null,
    }]);
  });

  it('fills an empty directory from the roster on first use', async () => {
    h.roster.add('u7', 'Bo Tan', 'bo@x.test');
    expect((await h.call('GET', '/api/employees')).body.employees.map((e: { name: string }) => e.name)).toEqual(['Bo Tan']);
  });

  it('saves a profile', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const tech = await h.addRole('Technician');
    const desk = await h.addRole('Reception');
    const { status, body } = await h.call('PATCH', '/api/employees/E1', { role_ids: [tech, desk], default_role_id: tech, timezone: 'Asia/Singapore', working_hours: HOURS });
    expect(status).toBe(200);
    expect([...body.employee.role_ids].sort()).toEqual([tech, desk].sort());
    expect(body.employee).toMatchObject({ default_role_id: tech, effective_timezone: 'Asia/Singapore' });
    expect(body.employee.working_hours.mon).toEqual(HOURS.mon);
    expect(body.employee.working_hours.sun).toEqual([]);
  });

  it('keeps absent fields; null working hours means flexible', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const tech = await h.addRole('Technician');
    await h.call('PATCH', '/api/employees/E1', { role_ids: [tech], working_hours: HOURS });
    const { body } = await h.call('PATCH', '/api/employees/E1', { working_hours: null });
    expect(body.employee.role_ids).toEqual([tech]);
    expect(body.employee.working_hours).toBeNull();
  });

  it('names every invalid field', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const tech = await h.addRole('Technician');
    const { status, body } = await h.call('PATCH', '/api/employees/E1', { role_ids: ['nope'], default_role_id: tech, timezone: 'Nowhere/Land', working_hours: { mon: [['18:00', '09:00']] } });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['working_hours', 'role_ids', 'default_role_id', 'timezone']);
    expect(body.error.details.working_hours).toContain('must end after it starts');
  });

  it('is 404 for someone not on the roster and 403 for employees', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    expect((await h.call('PATCH', '/api/employees/E404', { timezone: null })).status).toBe(404);
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/employees')).status).toBe(403);
  });

  it('refreshes an empty directory before saving, so a rostered person can be configured', async () => {
    h.roster.add('u7', 'Bo Tan', 'bo@x.test');
    const { status, body } = await h.call('PATCH', '/api/employees/u7', { timezone: 'Asia/Singapore' });
    expect(status).toBe(200);
    expect(body.employee).toMatchObject({ employee_ref: 'u7', name: 'Bo Tan', effective_timezone: 'Asia/Singapore' });
  });

  it('never writes a profile for a ref that is not on the roster, even after refreshing', async () => {
    const { status } = await h.call('PATCH', '/api/employees/ghost', { timezone: 'Asia/Singapore' });
    expect(status).toBe(404);
    expect(await h.database.db.select().from(employeeProfiles)).toEqual([]);
  });

  it('refuses to newly assign an archived role, but keeps one already held', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const held = await h.addRole('Technician');
    await h.call('PATCH', '/api/employees/E1', { role_ids: [held] });
    await h.call('PATCH', `/api/roles/${held}`, { archived: true });
    const retired = await h.addRole('Retired');
    await h.call('PATCH', `/api/roles/${retired}`, { archived: true });

    const refused = await h.call('PATCH', '/api/employees/E1', { role_ids: [held, retired] });
    expect(refused.status).toBe(422);
    expect(Object.keys(refused.body.error.details)).toEqual(['role_ids']);

    const kept = await h.call('PATCH', '/api/employees/E1', { timezone: 'Asia/Singapore' });
    expect(kept.status).toBe(200);
    expect(kept.body.employee.role_ids).toEqual([held]);
    const resent = await h.call('PATCH', '/api/employees/E1', { role_ids: [held] });
    expect(resent.status).toBe(200);
  });

  it('reports the effective time zone in /api/me', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.call('PATCH', '/api/employees/E1', { timezone: 'Asia/Singapore' });
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/me')).body).toMatchObject({ timezone: 'Asia/Singapore', organisation_timezone: 'Asia/Kuala_Lumpur' });
    h.asEmployee(null, 'visitor@example.com');
    expect((await h.call('GET', '/api/me')).body.timezone).toBe('Asia/Kuala_Lumpur');
  });
});
