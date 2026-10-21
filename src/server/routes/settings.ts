import type { App } from '../app';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { REMINDER_LEAD_MINUTES } from '../db/schema';
import type { GiveUpMode } from '../repo/settings';
import { isTimezone } from '../support/time';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/settings', 'manager', 'Read organisation planning settings.', async () => json(200, { settings: await app.settings().get() }),
    op('Read Settings', 'See the organisation country, region and time zone', ['Showing the settings page'], ["Reading an employee's time zone"],
      [], ['settings.country_code', 'settings.region_code', 'settings.timezone', 'settings.give_up_mode', 'settings.unassign_window_days', 'settings.recurrence_horizon_months', 'settings.reminder_lead_minutes'],
      ['Planning Manager'], ['PATCH /api/settings'],
      ['settings', 'configuration', 'time zone', 'country']));

  r.add('PATCH', '/api/settings', 'manager', 'Change organisation planning settings.', async ({ body }) => {
    const current = await app.settings().get();
    const input = new Input(await body());
    const country = input.has('country_code') ? input.string('country_code', 2) : current.country_code;
    const region = input.has('region_code') ? input.string('region_code', 10) : current.region_code;
    const timezone = input.has('timezone') ? input.string('timezone', 64, true) : current.timezone;
    if (country && !/^[A-Z]{2}$/.test(country)) input.error('country_code', 'Use a two-letter ISO country code in capitals, such as MY.');
    if (region && !/^[A-Z0-9-]{1,10}$/.test(region)) input.error('region_code', 'Use a region code such as MY-10.');
    if (timezone && !isTimezone(timezone)) input.error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
    const mode = input.has('give_up_mode') ? input.string('give_up_mode', 16, true) : current.give_up_mode;
    if (mode && mode !== 'switch' && mode !== 'unassign') input.error('give_up_mode', 'Use switch or unassign.');
    const windowDays = input.has('unassign_window_days') ? input.int('unassign_window_days', 0, 60, current.unassign_window_days) : current.unassign_window_days;
    const horizonMonths = input.has('recurrence_horizon_months') ? input.int('recurrence_horizon_months', 1, 24, current.recurrence_horizon_months) : current.recurrence_horizon_months;
    let reminderLead = current.reminder_lead_minutes;
    if (input.has('reminder_lead_minutes')) {
      const value = input.int('reminder_lead_minutes', 0, 1440, current.reminder_lead_minutes);
      if (value !== null && !(REMINDER_LEAD_MINUTES as readonly number[]).includes(value)) {
        input.error('reminder_lead_minutes', `Use one of ${REMINDER_LEAD_MINUTES.join(', ')} minutes (0 turns reminders off).`);
      } else if (value !== null) reminderLead = value;
    }
    input.check();
    await app.openShifts().applySettings({
      country_code: country, region_code: region, timezone: timezone!, give_up_mode: mode as GiveUpMode, unassign_window_days: windowDays!, recurrence_horizon_months: horizonMonths!, reminder_lead_minutes: reminderLead,
    });
    return json(200, { settings: await app.settings().get() });
  }, op('Update Settings', 'Set the organisation country, region and time zone', ['Choosing which public holidays apply', 'Changing the default time zone'], ["Changing one employee's time zone"],
    ['country_code', 'region_code', 'timezone', 'give_up_mode', 'unassign_window_days', 'recurrence_horizon_months', 'reminder_lead_minutes'], ['settings'], ['Planning Manager'], ['GET /api/settings', 'POST /api/holiday-syncs'],
    ['settings', 'time zone', 'country', 'region']));
}
