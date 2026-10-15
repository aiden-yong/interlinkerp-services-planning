import { beforeEach, describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(() => h.addEmployee('E1', 'Ana Lim'));

async function create(start = '2026-10-16T00:00:00+08:00', end = '2026-10-17T00:00:00+08:00') {
  const { status, body } = await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: start, end_at: end, reason: 'Annual leave' });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.unavailability;
}

describe('time off API (FR-CFG-03)', () => {
  it('records and lists time off overlapping a range', async () => {
    const created = await create();
    expect(created).toEqual({ id: created.id, employee_ref: 'E1', start_at: '2026-10-15T16:00:00Z', end_at: '2026-10-16T16:00:00Z', reason: 'Annual leave' });
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-12', to: '2026-10-18' })).body.unavailabilities).toHaveLength(1);
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-19', to: '2026-10-25' })).body.unavailabilities).toHaveLength(0);
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-12', to: '2026-10-18', employee_ref: 'E2' })).body.unavailabilities).toHaveLength(0);
  });

  it('names invalid fields', async () => {
    const { status, body } = await h.call('POST', '/api/unavailabilities', { employee_ref: 'E9', start_at: '2026-10-16T10:00:00+08:00', end_at: '2026-10-16T09:00:00+08:00' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['employee_ref', 'end_at']);
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-12' })).status).toBe(422);
  });

  it('edits and deletes', async () => {
    const { id } = await create();
    const { body } = await h.call('PATCH', `/api/unavailabilities/${id}`, { reason: 'Sick leave', end_at: '2026-10-18T00:00:00+08:00' });
    expect(body.unavailability).toMatchObject({ reason: 'Sick leave', end_at: '2026-10-17T16:00:00Z' });
    expect((await h.call('DELETE', `/api/unavailabilities/${id}`)).status).toBe(204);
    expect((await h.call('DELETE', `/api/unavailabilities/${id}`)).status).toBe(404);
  });
});
