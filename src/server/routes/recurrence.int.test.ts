import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { recurrences, shifts } from '../db/schema';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';
import { whileLocked } from '../test/races';

const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
});
// The harness clock starts at 2026-10-13T02:00:00Z (see test/harness.ts); this suite needs 2026-01-01T02:00:00Z instead.
const START = Date.parse('2026-10-13T02:00:00Z');
const advanceTo = (iso: string) => h.clock.advance(Math.round((Date.parse(iso) - START) / 1000));

const repeatWeekly = { interval: 1, unit: 'week', ends: 'never' };

const createRepeating = (overrides: Record<string, unknown> = {}) =>
  h.call('POST', '/api/shifts', {
    employee_ref: 'E1', start_at: '2026-01-01T09:00:00+08:00', end_at: '2026-01-01T17:00:00+08:00', break_minutes: 60,
    repeat: repeatWeekly, ...overrides,
  });

const seriesRows = async (seriesId: string) => (await h.database.db.select().from(shifts)).filter((r) => r.recurrenceId === seriesId);

const atIndex = async (seriesId: string, idx: number) => {
  const rows = await seriesRows(seriesId);
  const row = rows.find((r) => r.recurrenceIndex === idx)!;
  const { body } = await h.call('GET', `/api/shifts/${row.id}`);
  return body.shift;
};

const outbox = () => new Outbox(h.database.db, ORG).all();

describe('recurring shifts', () => {
  beforeEach(() => advanceTo('2026-01-01T02:00:00Z'));

  it('creates a weekly series up to the 6-month horizon only (FR-REC-03 AC1)', async () => {
    const { status, body } = await createRepeating();
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.recurrence.created).toBe(26);
    expect(body.shift.employee_ref).toBe('E1');

    const series = await seriesRows(body.recurrence.id);
    expect(series.length).toBe(26);
    for (const r of series) {
      expect([r.employeeRef, r.breakMinutes, r.allocatedPercent, r.note, r.state]).toEqual(['E1', 60, 100, null, 'draft']);
    }
    const last = series.reduce((a, b) => (a.startAt > b.startAt ? a : b));
    expect(last.startAt.getTime()).toBeLessThan(DateTime.fromISO('2026-07-01T00:00:00', { zone: 'Asia/Kuala_Lumpur' }).toMillis());
  });

  it('extends as time passes (FR-REC-03 AC1)', async () => {
    const { body } = await createRepeating();
    h.clock.advance(31 * 24 * 3600); // -> 2026-02-01T02:00:00Z
    await h.app.recurrences().extendAll(h.clock.now());

    const series = await seriesRows(body.recurrence.id);
    const last = series.reduce((a, b) => (a.startAt > b.startAt ? a : b));
    expect(last.startAt.getTime()).toBeLessThan(DateTime.fromISO('2026-08-01T00:00:00', { zone: 'Asia/Kuala_Lumpur' }).toMillis());
    expect(last.startAt.getTime()).toBeGreaterThan(DateTime.fromISO('2026-07-24T00:00:00', { zone: 'Asia/Kuala_Lumpur' }).toMillis());
  });

  it('does not bring back a deleted occurrence (D4)', async () => {
    const { body } = await createRepeating();
    const before = (await seriesRows(body.recurrence.id)).sort((a, b) => a.recurrenceIndex! - b.recurrenceIndex!);
    const third = before[2]!;
    expect((await h.call('DELETE', `/api/shifts/${third.id}`)).status).toBe(204);

    h.clock.advance(35 * 24 * 3600); // a month and a bit on
    await h.app.recurrences().extendAll(h.clock.now());

    const after = await seriesRows(body.recurrence.id);
    const liveAtThirdIndex = after.filter((r) => r.recurrenceIndex === third.recurrenceIndex && r.deletedAt === null);
    expect(liveAtThirdIndex.length).toBe(0);
    const indexes = after.map((r) => r.recurrenceIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it('two extensions at once create each shift once (Review Focus 4)', async () => {
    const { body } = await createRepeating();
    h.clock.advance(35 * 24 * 3600);
    await Promise.all([
      h.app.recurrences().extendOne(body.recurrence.id, h.clock.now()),
      h.app.recurrences().extendOne(body.recurrence.id, h.clock.now()),
    ]);
    const series = await seriesRows(body.recurrence.id);
    const indexes = series.map((r) => r.recurrenceIndex);
    expect(series.length).toBe(new Set(indexes).size);
  });

  it("extends in the series' own zone (Review Focus 2)", async () => {
    const { body } = await createRepeating();
    expect((await h.call('PATCH', '/api/settings', { timezone: 'Europe/London' })).status).toBe(200);
    h.clock.advance(35 * 24 * 3600);
    await h.app.recurrences().extendOne(body.recurrence.id, h.clock.now());

    const series = await seriesRows(body.recurrence.id);
    const newest = series.filter((r) => r.recurrenceIndex! > 4);
    expect(newest.length).toBeGreaterThan(0);
    for (const r of newest) {
      expect(r.startAt.getUTCHours()).toBe(1); // 09:00 Asia/Kuala_Lumpur, unaffected by the org's new London zone
      expect(r.startAt.getUTCMinutes()).toBe(0);
    }
  });

  it('asks before saving conflicting occurrences (D8)', async () => {
    expect((await h.call('POST', '/api/unavailabilities', {
      employee_ref: 'E1', start_at: '2026-01-15T00:00:00+08:00', end_at: '2026-01-16T00:00:00+08:00', reason: 'Leave',
    })).status).toBe(201);

    const refused = await createRepeating();
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.error.code).toBe('SHIFT_CONFLICT');
    expect(refused.body.error.details.occurrences[0].date).toBe('2026-01-15');
    expect(await h.database.db.select().from(shifts)).toEqual([]);

    const ok = await createRepeating({ acknowledge_conflicts: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const series = await seriesRows(ok.body.recurrence.id);
    const conflicting = series.find((r) => r.startAt.toISOString().startsWith('2026-01-15'));
    const nonConflicting = series.find((r) => r.recurrenceIndex === 0);
    expect(conflicting?.conflictAcknowledgedAt).not.toBeNull();
    expect(nonConflicting?.conflictAcknowledgedAt).toBeNull();
  });

  it('validates repeat', async () => {
    const { status, body } = await createRepeating({ repeat: { interval: 0, unit: 'year', ends: 'on', count: 1000 } });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details).sort()).toEqual(['repeat.count', 'repeat.interval', 'repeat.unit', 'repeat.until_date']);
  });

  it('shows the series on each shift', async () => {
    const { body } = await createRepeating();
    const second = (await seriesRows(body.recurrence.id)).find((r) => r.recurrenceIndex === 1)!;
    const { status, body: readBody } = await h.call('GET', `/api/shifts/${second.id}`);
    expect(status).toBe(200);
    expect(readBody.shift.recurrence).toEqual({
      id: body.recurrence.id, interval: 1, unit: 'week', ends: 'never', until_date: null, count: null, index: 1, detached: false,
    });
  });

  it('respects a shrunk horizon', async () => {
    const { body } = await createRepeating();
    expect((await h.call('PATCH', '/api/settings', { recurrence_horizon_months: 1 })).status).toBe(200);
    const before = await seriesRows(body.recurrence.id);

    h.clock.advance(31 * 24 * 3600);
    await h.app.recurrences().extendOne(body.recurrence.id, h.clock.now());

    const after = await seriesRows(body.recurrence.id);
    const limit = DateTime.fromISO('2026-03-01T02:00:00', { zone: 'Asia/Kuala_Lumpur' }).toMillis();
    const newlyAdded = after.filter((r) => !before.some((b) => b.id === r.id));
    for (const r of newlyAdded) expect(r.startAt.getTime()).toBeLessThan(limit);
    // Existing shifts beyond the shrunk horizon are not deleted by a later horizon change (D3).
    for (const r of before) expect(after.some((a) => a.id === r.id)).toBe(true);
  });

  it('shows the series on the schedule list, batch-loaded for both a series shift and a plain one', async () => {
    const { body } = await createRepeating();
    const plain = await h.call('POST', '/api/shifts', {
      employee_ref: 'E1', start_at: '2026-01-02T09:00:00+08:00', end_at: '2026-01-02T17:00:00+08:00', break_minutes: 60,
    });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);

    const { status, body: scheduleBody } = await h.call('GET', '/api/schedule', undefined, { from: '2026-01-01', to: '2026-01-02' });
    expect(status).toBe(200);
    const seriesShift = scheduleBody.shifts.find((s: { id: string }) => s.id === body.shift.id);
    const plainShift = scheduleBody.shifts.find((s: { id: string }) => s.id === plain.body.shift.id);
    expect(seriesShift.recurrence).toEqual({
      id: body.recurrence.id, interval: 1, unit: 'week', ends: 'never', until_date: null, count: null, index: 0, detached: false,
    });
    expect(plainShift.recurrence).toBeNull();
  });

  it('edits only this shift and detaches it', async () => {
    const { body } = await createRepeating();
    const shift2 = await atIndex(body.recurrence.id, 2);
    const res = await h.call('PATCH', `/api/shifts/${shift2.id}`, { version: shift2.version, note: 'Bring keys', scope: 'this' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.shift.recurrence.detached).toBe(true);
    expect(res.body.updated).toBe(0);

    const others = (await seriesRows(body.recurrence.id)).filter((r) => r.recurrenceIndex !== 2);
    for (const r of others) expect(r.note).toBeNull();
  });

  it('edits this and following', async () => {
    const { body } = await createRepeating();
    const shift5 = await atIndex(body.recurrence.id, 5);
    const res = await h.call('PATCH', `/api/shifts/${shift5.id}`, { version: shift5.version, note: 'New site', scope: 'following' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.updated).toBe(20);

    const rows = await seriesRows(body.recurrence.id);
    expect(rows.find((r) => r.recurrenceIndex === 4)!.note).toBeNull();
    expect(rows.find((r) => r.recurrenceIndex === 6)!.note).toBe('New site');

    h.clock.advance(31 * 24 * 3600);
    await h.app.recurrences().extendAll(h.clock.now());
    const after = await seriesRows(body.recurrence.id);
    const newest = after.filter((r) => r.recurrenceIndex! > 25);
    expect(newest.length).toBeGreaterThan(0);
    for (const r of newest) expect(r.note).toBe('New site');
  });

  it('moves the time of day for all', async () => {
    const { body } = await createRepeating();
    const now = h.clock.now();
    const shift3 = await atIndex(body.recurrence.id, 3);
    const res = await h.call('PATCH', `/api/shifts/${shift3.id}`, {
      version: shift3.version, start_at: '2026-01-22T10:00:00+08:00', end_at: '2026-01-22T18:00:00+08:00', scope: 'all',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = (await seriesRows(body.recurrence.id))
      .filter((r) => r.state === 'draft' && !r.recurrenceDetached && r.deletedAt === null && r.startAt.getTime() > now.getTime());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.startAt.getUTCHours()).toBe(2);
      expect(r.startAt.getUTCMinutes()).toBe(0);
    }
  });

  it('leaves published, detached and started shifts alone (Review Focus 3)', async () => {
    const { body } = await createRepeating();
    const shift1 = await atIndex(body.recurrence.id, 1);
    expect((await h.call('POST', '/api/publications', { shift_ids: [shift1.id] })).status).toBe(201);
    const shift2 = await atIndex(body.recurrence.id, 2);
    expect((await h.call('PATCH', `/api/shifts/${shift2.id}`, { version: shift2.version, scope: 'this' })).status).toBe(200);

    const shift3 = await atIndex(body.recurrence.id, 3);
    const res = await h.call('PATCH', `/api/shifts/${shift3.id}`, { version: shift3.version, note: 'Updated', scope: 'all' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await seriesRows(body.recurrence.id);
    for (const idx of [0, 1, 2]) expect(rows.find((r) => r.recurrenceIndex === idx)!.note).toBeNull();
    for (const idx of [3, 4, 5]) expect(rows.find((r) => r.recurrenceIndex === idx)!.note).toBe('Updated');
  });

  it('changes the pattern from this shift on (D6)', async () => {
    const { body } = await createRepeating();
    const shift4 = await atIndex(body.recurrence.id, 4);
    const res = await h.call('PATCH', `/api/shifts/${shift4.id}`, {
      version: shift4.version, scope: 'following', repeat: { interval: 2, unit: 'week', ends: 'never' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.shift.recurrence.index).toBe(0);
    expect(res.body.shift.recurrence.interval).toBe(2);
    const newSeriesId = res.body.shift.recurrence.id;
    expect(newSeriesId).not.toBe(body.recurrence.id);

    const oldSeries = await h.app.recurrences().find(body.recurrence.id);
    expect(oldSeries!.lastIndex).toBe(3);

    const oldLiveFuture = (await seriesRows(body.recurrence.id)).filter((r) => r.recurrenceIndex! >= 4 && r.deletedAt === null);
    expect(oldLiveFuture.length).toBe(0);

    const newRows = (await seriesRows(newSeriesId)).sort((a, b) => a.recurrenceIndex! - b.recurrenceIndex!);
    expect(newRows[0]!.id).toBe(shift4.id);
    const diffDays = (newRows[1]!.startAt.getTime() - newRows[0]!.startAt.getTime()) / 86_400_000;
    expect(diffDays).toBe(14);
  });

  it('refuses a pattern change for one shift', async () => {
    const { body } = await createRepeating();
    const shift2 = await atIndex(body.recurrence.id, 2);
    const res = await h.call('PATCH', `/api/shifts/${shift2.id}`, {
      version: shift2.version, scope: 'this', repeat: { interval: 2, unit: 'week', ends: 'never' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe('RECURRENCE_PATTERN_SCOPE');
  });

  it('refuses a pattern change on an already-started shift, even for scope all', async () => {
    const { body } = await createRepeating();
    const shift1 = await atIndex(body.recurrence.id, 1);
    h.clock.advance(7 * 24 * 3600); // -> 2026-01-08T02:00:00Z, an hour past shift1's own start (09:00 +08:00 = 01:00Z)
    const res = await h.call('PATCH', `/api/shifts/${shift1.id}`, {
      version: shift1.version, scope: 'all', repeat: { interval: 2, unit: 'week', ends: 'never' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe('RECURRENCE_PATTERN_SCOPE');
  });

  it('deletes this and following, and ends the series', async () => {
    const { body } = await createRepeating();
    const shift10 = await atIndex(body.recurrence.id, 10);
    const res = await h.call('DELETE', `/api/shifts/${shift10.id}`, undefined, { scope: 'following' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deleted).toBe(16);

    h.clock.advance(31 * 24 * 3600);
    await h.app.recurrences().extendAll(h.clock.now());
    const after = await seriesRows(body.recurrence.id);
    const newest = after.filter((r) => r.recurrenceIndex! >= 10 && r.deletedAt === null);
    expect(newest.length).toBe(0);
  });

  it('deletes all not-started shifts, published ones with a notice', async () => {
    const { body } = await createRepeating();
    const shift1 = await atIndex(body.recurrence.id, 1);
    expect((await h.call('POST', '/api/publications', { shift_ids: [shift1.id] })).status).toBe(201);
    const shift0 = await atIndex(body.recurrence.id, 0); // already started at creation time (see START/clock fixture), so scope 'all' naturally excludes it

    const res = await h.call('DELETE', `/api/shifts/${shift1.id}`, undefined, { scope: 'all' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deleted).toBe(25);

    const rows = await seriesRows(body.recurrence.id);
    const row0 = rows.find((r) => r.id === shift0.id)!;
    expect(row0.deletedAt).toBeNull();

    const notices = (await outbox()).filter((n) => n.kind === 'shift_deleted');
    expect(notices.length).toBe(1);
    expect(notices[0]!.subject_id).toBe(shift1.id);
    const deliverAfter = Date.parse(notices[0]!.deliver_after);
    expect(deliverAfter - h.clock.now().getTime()).toBe(30_000);
  });

  it('keeps the single delete and its undo', async () => {
    const { body } = await createRepeating();
    const shift3 = await atIndex(body.recurrence.id, 3);
    const del = await h.call('DELETE', `/api/shifts/${shift3.id}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    const restore = await h.call('POST', '/api/shift-restorations', { shift_id: shift3.id });
    expect(restore.status, JSON.stringify(restore.body)).toBe(201);
  });
});

describe('recurrence lifecycle (final review fixes)', () => {
  beforeEach(() => advanceTo('2026-01-01T02:00:00Z'));

  const localDay = (d: Date) => DateTime.fromJSDate(d, { zone: 'Asia/Kuala_Lumpur' }).toISODate();

  it('always creates the first shift, even when it starts beyond the horizon', async () => {
    expect((await h.call('PATCH', '/api/settings', { recurrence_horizon_months: 1 })).status).toBe(200);
    const { status, body } = await createRepeating({ start_at: '2026-03-05T09:00:00+08:00', end_at: '2026-03-05T17:00:00+08:00' });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.recurrence.created).toBe(1);
    const rows = await seriesRows(body.recurrence.id);
    expect(rows.map((r) => [r.id, r.recurrenceIndex])).toEqual([[body.shift.id, 0]]);
  });

  it('refuses an until_date before the first shift', async () => {
    const { status, body } = await createRepeating({ repeat: { interval: 1, unit: 'week', ends: 'on', until_date: '2025-12-31' } });
    expect(status, JSON.stringify(body)).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['repeat.until_date']);
    expect(await h.database.db.select().from(shifts)).toEqual([]);
  });

  it("refuses a pattern change whose until_date is before the chosen shift's date", async () => {
    const { body } = await createRepeating();
    const cases = [
      { scope: 'following', index: 4, untilDate: '2026-01-20' }, // shift 4 is on 2026-01-29
      { scope: 'all', index: 1, untilDate: '2026-01-07' }, // shift 1 (the first not started) is on 2026-01-08
    ];
    for (const c of cases) {
      // eslint-disable-next-line no-await-in-loop -- sequential requests against one series
      const target = await atIndex(body.recurrence.id, c.index);
      // eslint-disable-next-line no-await-in-loop
      const res = await h.call('PATCH', `/api/shifts/${target.id}`, {
        version: target.version, scope: c.scope, repeat: { interval: 2, unit: 'week', ends: 'on', until_date: c.untilDate },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(Object.keys(res.body.error.details)).toEqual(['repeat.until_date']);
    }
    expect((await h.app.recurrences().find(body.recurrence.id))!.lastIndex).toBeNull();
    expect((await seriesRows(body.recurrence.id)).length).toBe(26);
  });

  it('changes the pattern for all only from the first shift that has not started', async () => {
    const { body } = await createRepeating(); // index 0 has already started; 1.. have not
    const shift3 = await atIndex(body.recurrence.id, 3);
    const refused = await h.call('PATCH', `/api/shifts/${shift3.id}`, {
      version: shift3.version, scope: 'all', repeat: { interval: 2, unit: 'week', ends: 'never' },
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error.code).toBe('RECURRENCE_PATTERN_SCOPE');
    expect((await seriesRows(body.recurrence.id)).length).toBe(26);

    const shift1 = await atIndex(body.recurrence.id, 1);
    const ok = await h.call('PATCH', `/api/shifts/${shift1.id}`, {
      version: shift1.version, scope: 'all', repeat: { interval: 2, unit: 'week', ends: 'never' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.shift.recurrence.index).toBe(0);
    expect((await h.app.recurrences().find(body.recurrence.id))!.lastIndex).toBe(0);
  });

  it('a pattern change never doubles a published shift or brings back a deleted one (D4, D6)', async () => {
    const { body } = await createRepeating();
    const shift3 = await atIndex(body.recurrence.id, 3); // 2026-01-22
    expect((await h.call('POST', '/api/publications', { shift_ids: [shift3.id] })).status).toBe(201);
    const shift4 = await atIndex(body.recurrence.id, 4); // 2026-01-29
    expect((await h.call('DELETE', `/api/shifts/${shift4.id}`)).status).toBe(204);

    const shift1 = await atIndex(body.recurrence.id, 1);
    const res = await h.call('PATCH', `/api/shifts/${shift1.id}`, {
      version: shift1.version, scope: 'following', repeat: { interval: 1, unit: 'week', ends: 'never' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const newDates = (await seriesRows(res.body.shift.recurrence.id)).map((r) => localDay(r.startAt));
    expect(newDates).toEqual(expect.arrayContaining(['2026-01-08', '2026-01-15', '2026-02-05']));
    expect(newDates).not.toContain('2026-01-22');
    expect(newDates).not.toContain('2026-01-29');

    const oldRows = await seriesRows(body.recurrence.id);
    const published = oldRows.find((r) => r.id === shift3.id)!;
    expect([published.state, published.deletedAt, published.recurrenceIndex, localDay(published.startAt)]).toEqual(['published', null, 3, '2026-01-22']);
    expect(oldRows.find((r) => r.id === shift4.id)!.deletedAt).not.toBeNull();
  });

  it('an extension never overwrites a series change committed while it ran (lost update)', async () => {
    const { body } = await createRepeating();
    h.clock.advance(35 * 24 * 3600);
    // Stands in for an end-of-series change (as deleteFrom/splitSeries make) committed between extendOne's read and
    // its write: the row lock makes extendOne's final write wait until that change is committed.
    const created = await whileLocked(h.database, async (client) => {
      await client.query('update recurrences set last_index = 30 where id = $1', [body.recurrence.id]);
    }, () => h.app.recurrences().extendOne(body.recurrence.id, h.clock.now()), 1);
    expect(created).toBeGreaterThan(0);
    const [row] = await h.database.db.select().from(recurrences).where(eq(recurrences.id, body.recurrence.id));
    expect(row!.lastIndex).toBe(30);
    expect(row!.generatedUntil.getTime()).toBeGreaterThan(Date.parse('2026-08-01T00:00:00Z'));
  });

  it('a later series delete never moves an earlier series end forward', async () => {
    const { body } = await createRepeating();
    // A published shift at index 6 stays in the old series when the pattern changes from index 3 (series ends at 2)...
    const shift6 = await atIndex(body.recurrence.id, 6);
    expect((await h.call('POST', '/api/publications', { shift_ids: [shift6.id] })).status).toBe(201);
    const shift3 = await atIndex(body.recurrence.id, 3);
    const split = await h.call('PATCH', `/api/shifts/${shift3.id}`, {
      version: shift3.version, scope: 'following', repeat: { interval: 2, unit: 'week', ends: 'never' },
    });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    expect((await h.app.recurrences().find(body.recurrence.id))!.lastIndex).toBe(2);

    // ...so deleting "this and following" from it must keep the series' earlier end, not move it to 5.
    const res = await h.call('DELETE', `/api/shifts/${shift6.id}`, undefined, { scope: 'following' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect((await h.app.recurrences().find(body.recurrence.id))!.lastIndex).toBe(2);
  });

  it('spreads only the fields this edit changed to the following shifts', async () => {
    await h.addEmployee('E2', 'Bo Tan');
    const { body } = await createRepeating();
    // Shift 5 is first edited on its own (and so detached): another employee and a later time.
    const shift5 = await atIndex(body.recurrence.id, 5); // 2026-02-05
    const own = await h.call('PATCH', `/api/shifts/${shift5.id}`, {
      version: shift5.version, scope: 'this', employee_ref: 'E2', start_at: '2026-02-05T10:00:00+08:00', end_at: '2026-02-05T18:00:00+08:00',
    });
    expect(own.status, JSON.stringify(own.body)).toBe(200);

    // Then only its note changes, but the body carries every field, as the dialog sends it.
    const s = own.body.shift;
    const res = await h.call('PATCH', `/api/shifts/${s.id}`, {
      version: s.version, scope: 'following', employee_ref: s.employee_ref, role_id: s.role_id, start_at: s.start_at, end_at: s.end_at,
      break_minutes: s.break_minutes, allocated_percent: s.allocated_percent, note: 'Bring keys',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const following = (await seriesRows(body.recurrence.id)).filter((r) => r.recurrenceIndex! > 5);
    expect(following.length).toBeGreaterThan(0);
    for (const r of following) {
      expect(r.note).toBe('Bring keys');
      expect(r.employeeRef).toBe('E1');
      expect(r.startAt.getUTCHours()).toBe(1); // still 09:00 +08:00
      expect(r.endAt.getUTCHours()).toBe(9);
    }
    const series = await h.app.recurrences().find(body.recurrence.id);
    expect([series!.employeeRef, series!.firstStartLocal.slice(11), series!.note]).toEqual(['E1', '09:00', 'Bring keys']);
  });
});
