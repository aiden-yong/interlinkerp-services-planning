import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { shifts } from '../db/schema';
import { useApiHarness } from '../test/harness';

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
});
