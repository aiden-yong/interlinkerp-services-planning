import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const year = async () => (await h.call('GET', '/api/holidays', undefined, { year: 2026 })).body.holidays;

describe('holidays API (FR-CFG-04)', () => {
  it('adds, hides and deletes a manual holiday', async () => {
    const { status, body } = await h.call('POST', '/api/holidays', { date: '2026-11-08', name: 'Deepavali' });
    expect(status).toBe(201);
    expect(body.holiday).toEqual({ id: body.holiday.id, date: '2026-11-08', name: 'Deepavali', source: 'manual', hidden: false, edited: false });
    expect((await h.call('PATCH', `/api/holidays/${body.holiday.id}`, { hidden: true })).body.holiday.hidden).toBe(true);
    expect((await h.call('DELETE', `/api/holidays/${body.holiday.id}`)).status).toBe(204);
    expect(await year()).toEqual([]);
  });

  it('needs a provider and a country to sync', async () => {
    expect((await h.call('POST', '/api/holiday-syncs', { year: 2026 })).body.error.code).toBe('HOLIDAY_PROVIDER_NOT_CONFIGURED');
    h.holidays.configured = true;
    expect((await h.call('POST', '/api/holiday-syncs', { year: 2026 })).body.error.code).toBe('COUNTRY_NOT_SET');
  });

  it('keeps hidden and renamed holidays across a re-sync (AC2)', async () => {
    h.holidays.configured = true;
    h.holidays.list = [
      { key: 'MY-2026-11-08', date: '2026-11-08', name: 'Deepavali' },
      { key: 'MY-2026-12-25', date: '2026-12-25', name: 'Christmas' },
    ];
    await h.call('PATCH', '/api/settings', { country_code: 'MY', region_code: 'MY-10' });

    const first = await h.call('POST', '/api/holiday-syncs', { year: 2026 });
    expect([first.status, first.body]).toEqual([201, { added: 2, updated: 0 }]);
    expect(h.holidays.calls).toEqual([[2026, 'MY', 'MY-10']]);

    const [deepavali, christmas] = await year();
    await h.call('PATCH', `/api/holidays/${deepavali.id}`, { hidden: true });
    await h.call('PATCH', `/api/holidays/${christmas.id}`, { name: 'Christmas Day' });
    expect((await h.call('DELETE', `/api/holidays/${deepavali.id}`)).body.error.code).toBe('PROVIDER_HOLIDAY');

    h.holidays.list[0].name = 'Deepavali (Diwali)';
    h.holidays.list[1].name = 'Christmas (provider)';
    await h.call('POST', '/api/holiday-syncs', { year: 2026 });

    const [after1, after2] = await year();
    expect([after1.name, after1.hidden]).toEqual(['Deepavali (Diwali)', true]);
    expect(after2.name).toBe('Christmas Day');
  });

  it('names invalid fields', async () => {
    const { status, body } = await h.call('POST', '/api/holidays', { date: '2026-02-30', name: '' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['date', 'name']);
  });
});
