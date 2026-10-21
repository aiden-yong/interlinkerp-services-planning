import { describe, expect, it } from 'vitest';
import { UnitOfWork } from '../scheduling/unitOfWork';
import { isUniqueViolation } from '../support/ids';
import { ORG, useTestDatabase } from '../test/db';
import { type ShiftRecord, ShiftRepository } from './shifts';

const database = useTestDatabase();
const now = new Date('2026-10-13T00:00:00Z');
const shift = (id: string): ShiftRecord => ({
  id, employeeRef: null, roleId: null, start: new Date('2026-10-14T01:00:00Z'), end: new Date('2026-10-14T09:00:00Z'), breakMinutes: 0, percent: 100,
  note: null, state: 'draft', publishedAt: null, ackBy: null, ackAt: null, version: 1, createdBy: 'tester', deletedAt: null, switchRequestedAt: null,
  recurrenceId: null, recurrenceIndex: null, recurrenceDetached: false, copiedFrom: null,
});
const ID = '6f1c2b0e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';
const RECURRENCE_ID = '7a2d3c1f-4b5e-4f6a-9b0c-1d2e3f4a5b6c';
const COPIED_FROM = '8b3e4d2a-5c6f-4a7b-ac0d-2e3f4a5b6c7d';

describe('ShiftRepository.update', () => {
  it('saves once per version and returns the saved row', async () => {
    const repo = new ShiftRepository(database.db, ORG);
    await repo.insert(shift(ID), now);
    const first = await repo.update({ ...shift(ID), note: 'a' }, 1, now);
    expect([first?.version, first?.note]).toEqual([2, 'a']);
    expect(await repo.update({ ...shift(ID), note: 'b' }, 1, now)).toBeNull();
    expect((await repo.find(ID))?.note).toBe('a');
  });

  it('returns null for a shift deleted meanwhile', async () => {
    const repo = new ShiftRepository(database.db, ORG);
    await repo.insert(shift(ID), now);
    await repo.softDelete(ID, 'tester', now);
    expect(await repo.update({ ...shift(ID), note: 'x' }, 1, now)).toBeNull();
  });
});

describe('ShiftRepository.clearSwitchRequests', () => {
  it('clears and version-bumps only live, not-started, requested shifts', async () => {
    const repo = new ShiftRepository(database.db, ORG);
    const [future, started, plain, deleted] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    const requested = { employeeRef: 'E1', state: 'published' as const, switchRequestedAt: now };
    await repo.insert({ ...shift(future!), ...requested }, now);
    await repo.insert({ ...shift(started!), ...requested, start: new Date('2026-10-12T01:00:00Z'), end: new Date('2026-10-14T09:00:00Z') }, now);
    await repo.insert({ ...shift(plain!), employeeRef: 'E1', state: 'published' }, now);
    await repo.insert({ ...shift(deleted!), ...requested }, now);
    await repo.softDelete(deleted!, 'tester', now);
    const cleared = await repo.clearSwitchRequests(now);
    expect(cleared.map((s) => [s.id, s.version, s.switchRequestedAt])).toEqual([[future, 2, null]]);
    expect((await repo.find(started!))).toMatchObject({ version: 1, switchRequestedAt: now });
    expect((await repo.find(plain!))!.version).toBe(1);
    expect(await repo.find(deleted!, true)).toMatchObject({ version: 1, switchRequestedAt: now });
  });
});

describe('series fields', () => {
  it('stores and returns the series fields', async () => {
    const repo = new ShiftRepository(database.db, ORG);
    await repo.insert({
      ...shift(ID), recurrenceId: RECURRENCE_ID, recurrenceIndex: 3, recurrenceDetached: true, copiedFrom: COPIED_FROM,
    }, now);
    const saved = await repo.find(ID);
    expect(saved).toMatchObject({ recurrenceId: RECURRENCE_ID, recurrenceIndex: 3, recurrenceDetached: true, copiedFrom: COPIED_FROM });
  });

  it('refuses a second shift with the same series step, even after a soft delete', async () => {
    const repo = new ShiftRepository(database.db, ORG);
    const second = '9c4f5e3b-6d7a-4b8c-bd1e-3f4a5b6c7d8e';
    await repo.insert({ ...shift(ID), recurrenceId: RECURRENCE_ID, recurrenceIndex: 3 }, now);
    await repo.softDelete(ID, 'tester', now);
    await expect(repo.insert({ ...shift(second), recurrenceId: RECURRENCE_ID, recurrenceIndex: 3 }, now))
      .rejects.toSatisfy(isUniqueViolation);
  });
});

describe('UnitOfWork', () => {
  it('rolls back the shift and the notification together', async () => {
    const unit = new UnitOfWork(database.db, ORG, 'UTC');
    await expect(unit.run(async ({ shifts, outbox }) => {
      await shifts.insert(shift(ID), now);
      await outbox.add('shift_changed', null, ID, {}, now, now);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await new ShiftRepository(database.db, ORG).find(ID)).toBeNull();
  });
});
