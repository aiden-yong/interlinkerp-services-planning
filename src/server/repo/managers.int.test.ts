import { describe, expect, it } from 'vitest';
import { ORG, useTestDatabase } from '../test/db';
import { ManagerRepository } from './managers';

const database = useTestDatabase();

describe('ManagerRepository', () => {
  it('grants, lists, checks and revokes by lower-cased email', async () => {
    const repo = new ManagerRepository(database.db, ORG);
    const at = new Date('2026-10-13T00:00:00Z');

    expect(await repo.grant('Bo@Example.com', 'admin@example.com', at)).toBe(true);
    expect(await repo.grant('bo@example.com', 'admin@example.com', at)).toBe(false);
    expect(await repo.isManager('BO@example.com')).toBe(true);
    expect(await repo.all()).toEqual([{ email: 'bo@example.com', granted_by: 'admin@example.com', granted_at: '2026-10-13T00:00:00Z' }]);
    expect(await repo.count()).toBe(1);

    expect(await repo.revoke('bo@example.com')).toBe(true);
    expect(await repo.revoke('bo@example.com')).toBe(false);
    expect(await repo.isManager('bo@example.com')).toBe(false);
  });

  it('cannot see other organisations', async () => {
    await new ManagerRepository(database.db, 'other-org').grant('bo@example.com', 'x', new Date());
    expect(await new ManagerRepository(database.db, ORG).isManager('bo@example.com')).toBe(false);
  });
});
