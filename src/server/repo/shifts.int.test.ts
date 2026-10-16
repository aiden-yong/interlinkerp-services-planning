import { describe, expect, it } from 'vitest';
import { UnitOfWork } from '../scheduling/unitOfWork';
import { ORG, useTestDatabase } from '../test/db';
import { type ShiftRecord, ShiftRepository } from './shifts';

const database = useTestDatabase();
const now = new Date('2026-10-13T00:00:00Z');
const shift = (id: string): ShiftRecord => ({
  id, employeeRef: null, roleId: null, start: new Date('2026-10-14T01:00:00Z'), end: new Date('2026-10-14T09:00:00Z'), breakMinutes: 0, percent: 100,
  note: null, state: 'draft', publishedAt: null, ackBy: null, ackAt: null, version: 1, createdBy: 'tester', deletedAt: null, switchRequestedAt: null,
});
const ID = '6f1c2b0e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';

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
