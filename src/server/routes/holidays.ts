import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { localDate } from '../support/time';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/holidays', 'manager', 'List public holidays for a year.', async ({ query }) => {
    const year = query.year ?? localDate(app.clock().now().getTime(), await app.settings().timezone()).slice(0, 4);
    if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) throw HttpError.validation({ year: 'Use a year between 2000 and 2100.' });
    return json(200, { holidays: await app.holidays().forYear(Number(year)) });
  }, op('List Holidays', 'See the public holidays planning respects', ['Reviewing the holiday calendar'], ['Listing personal leave'],
    ['year'], ['holidays[]'], ['Planning Manager'], ['POST /api/holidays', 'POST /api/holiday-syncs'], ['holidays', 'public holiday', 'calendar']));

  r.add('POST', '/api/holidays', 'manager', 'Add a public holiday by hand.', async ({ body }) => {
    const input = new Input(await body());
    const date = input.date('date', true);
    const name = input.string('name', 160, true);
    input.check();
    return json(201, { holiday: await app.holidays().createManual(date!, name!, app.clock().now()) });
  }, op('Add Holiday', 'Add a holiday the provider does not know', ['A state or company holiday is missing'], ['Loading a whole year of holidays'],
    ['date', 'name'], ['holiday'], ['Planning Manager'], ['GET /api/holidays'], ['holiday', 'add holiday', 'company holiday']));

  r.add('PATCH', '/api/holidays/{id}', 'manager', 'Rename, hide or show a public holiday.', async ({ params, body }) => {
    const holiday = (await app.holidays().find(params.id)) ?? (() => { throw HttpError.notFound('No holiday with that id.'); })();
    const input = new Input(await body());
    const name = input.has('name') ? (input.string('name', 160, true) ?? undefined) : undefined;
    const hidden = input.has('hidden') ? input.bool('hidden') : undefined;
    input.check();
    return json(200, { holiday: await app.holidays().update(holiday.id, { name, hidden }, app.clock().now()) });
  }, op('Update Holiday', 'Rename or hide a holiday', ['The organisation works on a public holiday', 'Correcting a holiday name'], ['Adding a holiday'],
    ['name', 'hidden'], ['holiday'], ['Planning Manager'], ['GET /api/holidays'], ['holiday', 'hide holiday', 'rename']));

  r.add('DELETE', '/api/holidays/{id}', 'manager', 'Delete a manually added public holiday.', async ({ params }) => {
    const holiday = (await app.holidays().find(params.id)) ?? (() => { throw HttpError.notFound('No holiday with that id.'); })();
    if (holiday.source === 'provider') throw HttpError.conflict('PROVIDER_HOLIDAY', 'Holidays from the provider would come back on the next sync. Hide this holiday instead.');
    await app.holidays().delete(holiday.id);
    return noContent();
  }, op('Delete Holiday', 'Remove a holiday added by hand', ['A manual holiday was added by mistake'], ['Removing a provider holiday (hide it instead)'],
    ['id'], [], ['Planning Manager', 'Holiday was added by hand'], ['PATCH /api/holidays/{id}'], ['holiday', 'delete holiday']));

  r.add('POST', '/api/holiday-syncs', 'manager', 'Load a year of public holidays from the holiday provider.', async ({ body }) => {
    const input = new Input(await body());
    const year = input.int('year', 2000, 2100);
    if (year === null) input.error('year', 'This field is required.');
    input.check();
    if (!app.holidayProvider().isConfigured()) {
      throw HttpError.conflict('HOLIDAY_PROVIDER_NOT_CONFIGURED', 'No public holiday provider is configured yet (open issue OI-02). Add holidays by hand for now.');
    }
    const settings = await app.settings().get();
    if (!settings.country_code) throw HttpError.conflict('COUNTRY_NOT_SET', 'Set the organisation country in settings before syncing holidays.');
    const list = await app.holidayProvider().holidays(year!, settings.country_code, settings.region_code);
    return json(201, await app.holidays().syncFromProvider(list, app.clock().now()));
  }, op('Sync Holidays', "Load public holidays for the organisation's country and region", ['Starting a new year', 'After changing the country or region'], ['Adding one holiday by hand'],
    ['year'], ['added', 'updated'], ['Planning Manager', 'Country set in settings', 'Holiday provider configured'], ['PATCH /api/settings', 'GET /api/holidays'],
    ['holidays', 'sync', 'import', 'public holidays']));
}
