import { describe, expect, it } from 'vitest';
import { ORG, useTestDatabase } from '../test/db';
import { DirectoryRepository, type DirectoryRow } from './directory';

const database = useTestDatabase();
const row = (ref: string, name: string, email: string | null = null): DirectoryRow =>
  ({ employeeRef: ref, displayName: name, photoUrl: null, departmentId: null, departmentName: null, status: 'Active', email });

describe('DirectoryRepository.replaceAll (backlog item 24)', () => {
  it('updates people in place, adds new ones and removes people who left', async () => {
    const repo = new DirectoryRepository(database.db, ORG);
    await repo.replaceAll([row('E1', 'Ana Lim'), row('E2', 'Bo Tan')], new Date('2026-10-19T00:00:00Z'));
    await repo.replaceAll([row('E1', 'Ana Lim-Tan', 'ana@example.com'), row('E3', 'Cy Ong')], new Date('2026-10-20T00:00:00Z'));
    expect((await repo.all()).map((r) => [r.employeeRef, r.displayName, r.email])).toEqual([['E1', 'Ana Lim-Tan', 'ana@example.com'], ['E3', 'Cy Ong', null]]);
    expect(await repo.lastFetchedAt()).toEqual(new Date('2026-10-20T00:00:00Z'));
  });

  it('empties the cache for an empty roster and leaves other organisations alone', async () => {
    await new DirectoryRepository(database.db, 'other-org').replaceAll([row('E9', 'Other')], new Date());
    const repo = new DirectoryRepository(database.db, ORG);
    await repo.replaceAll([row('E1', 'Ana Lim')], new Date());
    await repo.replaceAll([], new Date());
    expect(await repo.all()).toEqual([]);
    expect(await new DirectoryRepository(database.db, 'other-org').refs()).toEqual(['E9']);
  });
});
