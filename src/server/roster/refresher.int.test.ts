import { describe, expect, it } from 'vitest';
import { DirectoryRepository } from '../repo/directory';
import { ORG, useTestDatabase } from '../test/db';
import { FakeDepartments, FakeRoster, FixedClock } from '../test/fakes';
import { DirectoryRefresher } from './refresher';

const database = useTestDatabase();

function setup() {
  const roster = new FakeRoster();
  const departments = new FakeDepartments();
  const directory = new DirectoryRepository(database.db, ORG);
  const clock = FixedClock.at('2026-10-13T00:00:00Z');
  const refresher = new DirectoryRefresher(roster, departments, directory, clock, () => {});
  return { roster, departments, directory, clock, refresher };
}

describe('DirectoryRefresher', () => {
  it('stores people with department names', async () => {
    const { roster, departments, directory, clock, refresher } = setup();
    roster.add('u1', 'Ana Lim', 'ana@x.test', 'DEP-1');
    departments.names.set('DEP-1', 'Field Services');

    expect(await refresher.refresh()).toBe(true);
    expect(await directory.all()).toEqual([{ employeeRef: 'u1', displayName: 'Ana Lim', photoUrl: null, departmentId: 'DEP-1', departmentName: 'Field Services', status: 'Active' }]);
    expect(await directory.lastFetchedAt()).toEqual(clock.now());
  });

  it('keeps the old cache when the roster is down', async () => {
    const { roster, directory, refresher } = setup();
    roster.add('u1', 'Ana Lim', 'ana@x.test');
    await refresher.refresh();
    roster.down = true;
    expect(await refresher.refresh()).toBe(false);
    expect(await directory.all()).toHaveLength(1);
  });

  it('still refreshes people when department names are unavailable', async () => {
    const { roster, departments, directory, refresher } = setup();
    roster.add('u1', 'Ana Lim', 'ana@x.test', 'DEP-1');
    departments.down = true;
    expect(await refresher.refresh()).toBe(true);
    expect((await directory.all())[0].departmentName).toBeNull();
  });

  it('backs off for 5 minutes after a failed first load', async () => {
    const { roster, clock, refresher } = setup();
    roster.down = true;
    expect(await refresher.refreshIfEmpty()).toBe(false);
    roster.down = false;
    roster.add('u1', 'Ana Lim', 'ana@x.test');
    expect(await refresher.refreshIfEmpty()).toBe(false);
    clock.advance(301);
    expect(await refresher.refreshIfEmpty()).toBe(true);
    expect(await refresher.refreshIfEmpty()).toBe(false);
  });
});
