import { beforeEach, describe, expect, it } from 'vitest';
import { shifts } from '../db/schema';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
  await h.addEmployee('E2', 'Bo Tan');
});

async function shift(ref: string | null, startAt: string, endAt: string, note: string | null = null): Promise<string> {
  const { status, body } = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: startAt, end_at: endAt, note });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.shift.id as string;
}

const allRows = () => h.database.db.select().from(shifts);

/** 16 one-off shifts (14 for E1, 2 open) plus a daily series of 4 for E2, all in the week of 2025-12-29 (Mon) - 2026-01-04 (Sun). */
async function seedPreviousWeek() {
  const days = ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'];
  const oneOffIds: string[] = [];
  for (const day of days) {
    oneOffIds.push(await shift('E1', `${day}T09:00:00+08:00`, `${day}T13:00:00+08:00`, 'Morning'));
    oneOffIds.push(await shift('E1', `${day}T14:00:00+08:00`, `${day}T18:00:00+08:00`, 'Afternoon'));
  }
  const openIds = [
    await shift(null, '2025-12-30T20:00:00+08:00', '2025-12-30T23:00:00+08:00'),
    await shift(null, '2026-01-02T20:00:00+08:00', '2026-01-02T23:00:00+08:00'),
  ];
  await h.call('POST', '/api/publications', { shift_ids: oneOffIds.slice(0, 7) });

  const { status, body } = await h.call('POST', '/api/shifts', {
    employee_ref: 'E2', start_at: '2025-12-29T06:00:00+08:00', end_at: '2025-12-29T08:00:00+08:00',
    repeat: { interval: 1, unit: 'day', ends: 'after', count: 4 },
  });
  expect(status, JSON.stringify(body)).toBe(201);
  return { oneOffIds, openIds, recurrenceId: body.recurrence.id as string };
}

describe('copy previous week (FR-PUB-04)', () => {
  it('copies last week as drafts (FR-PUB-04 AC1)', async () => {
    const { oneOffIds, openIds } = await seedPreviousWeek();

    const { status, body } = await h.call('POST', '/api/week-copies', { week_start: '2026-01-05' });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toEqual({ created: 16, skipped_recurring: 4, skipped_already_copied: 0, skipped_off_roster: 0, conflicts: 0 });

    const sources = [...oneOffIds, ...openIds];
    const rows = await allRows();
    const copies = rows.filter((r) => r.copiedFrom && sources.includes(r.copiedFrom));
    expect(copies.length).toBe(16);
    for (const copy of copies) {
      expect(copy.state).toBe('draft');
      expect(copy.publishedAt).toBeNull();
      expect(copy.conflictAcknowledgedAt).toBeNull();
      expect(copy.recurrenceId).toBeNull();
    }

    const source = rows.find((r) => r.id === oneOffIds[0])!;
    const copy = copies.find((c) => c.copiedFrom === oneOffIds[0])!;
    expect(copy.startAt.getTime() - source.startAt.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(copy.endAt.getTime() - source.endAt.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect([copy.employeeRef, copy.roleId, copy.breakMinutes, copy.allocatedPercent, copy.note])
      .toEqual([source.employeeRef, source.roleId, source.breakMinutes, source.allocatedPercent, source.note]);

    const openCopies = copies.filter((c) => openIds.includes(c.copiedFrom!));
    expect(openCopies.length).toBe(2);
    for (const c of openCopies) expect(c.employeeRef).toBeNull();
  });

  it('flags conflicts instead of blocking', async () => {
    const sourceId = await shift('E1', '2025-12-29T09:00:00+08:00', '2025-12-29T17:00:00+08:00');
    expect((await h.call('POST', '/api/unavailabilities', {
      employee_ref: 'E1', start_at: '2026-01-05T00:00:00+08:00', end_at: '2026-01-06T00:00:00+08:00', reason: 'Leave',
    })).status).toBe(201);

    const { status, body } = await h.call('POST', '/api/week-copies', { week_start: '2026-01-05' });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toEqual({ created: 1, skipped_recurring: 0, skipped_already_copied: 0, skipped_off_roster: 0, conflicts: 1 });

    const copyRow = (await allRows()).find((r) => r.copiedFrom === sourceId)!;
    const { status: readStatus, body: readBody } = await h.call('GET', `/api/shifts/${copyRow.id}`);
    expect(readStatus).toBe(200);
    expect(readBody.shift.conflicts.length).toBeGreaterThan(0);
  });

  it('copies once', async () => {
    await seedPreviousWeek();
    const first = await h.call('POST', '/api/week-copies', { week_start: '2026-01-05' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const { status, body } = await h.call('POST', '/api/week-copies', { week_start: '2026-01-05' });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toEqual({ created: 0, skipped_recurring: 4, skipped_already_copied: 16, skipped_off_roster: 0, conflicts: 0 });
  });

  it('skips people no longer on the roster', async () => {
    await shift('E1', '2025-12-29T09:00:00+08:00', '2025-12-29T17:00:00+08:00');
    await h.app.directory().replaceAll(
      [{ employeeRef: 'E2', displayName: 'Bo Tan', photoUrl: null, departmentId: null, departmentName: null, status: 'Active', email: null }],
      h.clock.now(),
    );

    const { status, body } = await h.call('POST', '/api/week-copies', { week_start: '2026-01-05' });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toEqual({ created: 0, skipped_recurring: 0, skipped_already_copied: 0, skipped_off_roster: 1, conflicts: 0 });
  });

  it('dry run counts without creating', async () => {
    await seedPreviousWeek();
    const before = (await allRows()).length;

    const { status, body } = await h.call('POST', '/api/week-copies', { week_start: '2026-01-05', dry_run: true });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({ created: 16, skipped_recurring: 4, skipped_already_copied: 0, skipped_off_roster: 0, conflicts: 0 });

    expect((await allRows()).length).toBe(before);
  });

  it('copies across a month end at the same wall-clock time (Review Focus 5)', async () => {
    expect((await h.call('PATCH', '/api/settings', { timezone: 'Europe/London' })).status).toBe(200);
    const sourceId = await shift('E1', '2026-03-23T09:00:00Z', '2026-03-23T17:00:00Z');

    const { status, body } = await h.call('POST', '/api/week-copies', { week_start: '2026-03-30' });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.created).toBe(1);

    const copyRow = (await allRows()).find((r) => r.copiedFrom === sourceId)!;
    expect(copyRow.startAt.toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });

  it('validates week_start', async () => {
    const tuesday = await h.call('POST', '/api/week-copies', { week_start: '2026-01-06' });
    expect(tuesday.status, JSON.stringify(tuesday.body)).toBe(422);
    expect(Object.keys(tuesday.body.error.details)).toEqual(['week_start']);

    const malformed = await h.call('POST', '/api/week-copies', { week_start: 'not-a-date' });
    expect(malformed.status, JSON.stringify(malformed.body)).toBe(422);
    expect(Object.keys(malformed.body.error.details)).toEqual(['week_start']);
  });
});
