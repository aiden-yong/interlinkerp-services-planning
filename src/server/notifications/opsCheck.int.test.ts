import { describe, expect, it } from 'vitest';
import { notificationOutbox, notifications } from '../db/schema';
import { DirectoryRepository } from '../repo/directory';
import { JobRuns } from '../repo/jobRuns';
import { ORG, useTestDatabase } from '../test/db';
import { OpsCheck } from './opsCheck';

const database = useTestDatabase();
const now = new Date('2026-10-20T18:30:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

function check() {
  const lines: string[] = [];
  const directory = new DirectoryRepository(database.db, ORG);
  return { lines, directory, ops: new OpsCheck(database.db, ORG, directory, new JobRuns(database.db, ORG), (line) => lines.push(line)) };
}

const person = { employeeRef: 'E1', displayName: 'Ana Lim', photoUrl: null, departmentId: null, departmentName: null, status: 'Active', email: 'ana@example.com' };

describe('OpsCheck (backlog item 9)', () => {
  it('is quiet when emails went out and the directory is fresh', async () => {
    const { ops, lines, directory } = check();
    await directory.replaceAll([person], hoursAgo(20));
    await new JobRuns(database.db, ORG).claim('sweep', hoursAgo(0.1), 0);
    expect(await ops.run(now)).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('raises one [alert] line per kind of failure from the last day, ignoring skipped emails and older failures', async () => {
    const { ops, lines, directory } = check();
    await directory.replaceAll([person], hoursAgo(50));
    await new JobRuns(database.db, ORG).claim('sweep', hoursAgo(0.1), 0);
    const notice = (createdAt: Date, emailError: string, outboxId: number) => ({
      organisationId: ORG, recipientRef: 'E1', kind: 'shift_assigned', title: 't', body: 'b', link: 'https://x/my', outboxId, createdAt, emailNextAt: createdAt, emailAttempts: 5, emailError,
    });
    await database.db.insert(notifications).values([
      notice(hoursAgo(3), '550 mailbox unavailable', 1),
      notice(hoursAgo(3), 'Skipped: no longer on the roster.', 2),
      notice(hoursAgo(30), '550 mailbox unavailable', 3),
    ]);
    await database.db.insert(notificationOutbox).values({ organisationId: ORG, kind: 'shift_assigned', payload: {}, attempts: 5, lastError: 'render failed', deliverAfter: hoursAgo(2), deliveredAt: hoursAgo(1), createdAt: hoursAgo(2) });

    const alerts = await ops.run(now);
    expect(alerts).toEqual([
      '1 notification email(s) failed for good in the last day. See notifications.email_error.',
      '1 notice(s) could not be delivered in the last day. See notification_outbox.last_error.',
      'The employee directory was last refreshed 50 hours ago. Check the directory cron and the roster service.',
    ]);
    expect(lines.every((l) => l.startsWith('[alert] '))).toBe(true);
  });
});

describe('OpsCheck: the 5-minute sweep (FR-NTF-05)', () => {
  const fresh = async () => {
    const c = check();
    await c.directory.replaceAll([person], hoursAgo(1));
    return c;
  };
  const swept = (minutesAgo: number) => new JobRuns(database.db, ORG).claim('sweep', new Date(now.getTime() - minutesAgo * 60_000), 0);

  it('is quiet while the sweep runs', async () => {
    const { ops } = await fresh();
    await swept(20);
    expect(await ops.run(now)).toEqual([]);
  });

  it('alerts when the sweep has not run for 30 minutes', async () => {
    const { ops } = await fresh();
    await swept(45);
    expect(await ops.run(now)).toEqual(['The 5-minute notification sweep has not run for 45 minutes. Check the external scheduler (README).']);
  });

  it('alerts when it never ran', async () => {
    const { ops } = await fresh();
    expect(await ops.run(now)).toEqual(['The 5-minute notification sweep has never run. Set up the external scheduler (README).']);
  });
});
