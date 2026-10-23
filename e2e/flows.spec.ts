import { DateTime } from 'luxon';
import { ANA, actAs, BO, call, deliverNow, expect, nextWednesday, publishedShift, test } from './fixtures';
import { BASE_URL, ZONE } from './env';

/** Backlog item 21: the four flows people use most, in a real browser. */

test('a manager publishes next week and the employee sees the shift', async ({ page, request, context }) => {
  await call(request, null, 'POST', '/api/shifts', { employee_ref: 'E1', start_at: nextWednesday(9), end_at: nextWednesday(17) });

  await page.goto('/schedule');
  await page.getByRole('button', { name: 'Next period' }).click();
  await expect(page.getByRole('main').getByText('Ana Lim').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish shifts?' });
  await expect(dialog.getByText('1 draft shift in this view will be published.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published 1 shift.' })).toBeVisible();

  await actAs(context, ANA);
  await page.goto('/my');
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByText('09:00–17:00')).toBeVisible();
});

test('an employee claims an open shift', async ({ page, request, context }) => {
  await publishedShift(request, null);
  await actAs(context, ANA);
  await page.goto('/my');
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: /^Claim shift / }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shift claimed.' })).toBeVisible();
  await expect(page.getByText('09:00–17:00')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Claim shift / })).toHaveCount(0);
});

test('an employee asks for cover and a colleague takes the shift over', async ({ page, request, context }) => {
  await publishedShift(request, 'E1');

  await actAs(context, ANA);
  await page.goto('/my');
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: /^Ask for cover for shift / }).click();
  await page.getByRole('dialog', { name: 'Put this shift up for switch?' }).getByRole('button', { name: 'Ask for cover' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shift is up for switch.' })).toBeVisible();
  await expect(page.getByText('Up for switch', { exact: true })).toBeVisible();

  await actAs(context, BO);
  await page.goto('/my');
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: /^Take shift .* from Ana Lim$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shift taken over.' })).toBeVisible();
  await expect(page.getByText('09:00–17:00')).toBeVisible();
});

test('an employee reads a notice and marks everything read', async ({ page, request, context }) => {
  await publishedShift(request, 'E1');
  await deliverNow(request);

  await actAs(context, ANA);
  await page.goto('/my');
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('Your shift was published')).toBeVisible();
  await panel.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  expect((await call(request, ANA, 'GET', '/api/notifications')).unread_count).toBe(0);

  // Backlog item 29: email can be turned off per notice type from the bell (its panel is still open).
  await page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: 'Email settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Email settings' });
  await settings.getByRole('checkbox', { name: 'My shifts are published' }).uncheck();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Email settings saved.' })).toBeVisible();
  const { preferences } = await call(request, ANA, 'GET', '/api/my/notification-preferences');
  expect(preferences.find((p: { kind: string }) => p.kind === 'schedule_published').email).toBe(false);
});

test('a manager repeats a shift weekly and sees it the week after', async ({ page }) => {
  await page.goto('/schedule');
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.getByRole('button', { name: 'Add shift' }).click(); // waits until the period has loaded
  const dialog = page.getByRole('dialog', { name: 'New shift' });
  await dialog.getByRole('combobox', { name: 'Employee', exact: true }).selectOption({ label: 'Ana Lim' });
  await dialog.getByLabel('Start date').fill(nextWednesday(9).slice(0, 10));
  await dialog.getByLabel('End date').fill(nextWednesday(9).slice(0, 10));
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption({ label: 'Weeks' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shift created as a draft.' })).toBeVisible();

  await page.getByRole('button', { name: 'Next period' }).click();
  await expect(page.getByRole('main').getByRole('button', { name: /^09:00–17:00/ })).toBeVisible();
});

test('a manager copies the previous week', async ({ page, request }) => {
  await call(request, null, 'POST', '/api/shifts', { employee_ref: 'E1', start_at: nextWednesday(9), end_at: nextWednesday(17) });

  await page.goto('/schedule');
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.getByRole('button', { name: 'Copy previous week' }).click();
  await page.getByRole('dialog', { name: 'Copy previous week?' }).getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied 1 shift.' })).toBeVisible();
});

test('a manager runs Auto Plan on a week', async ({ page, request }) => {
  const { role } = await call(request, null, 'POST', '/api/roles', { name: 'Technician', color: '#3B82F6' });
  const day = [['08:00', '18:00']];
  await call(request, null, 'PATCH', '/api/employees/E1', { role_ids: [role.id], working_hours: { mon: day, tue: day, wed: day, thu: day, fri: day } });
  await call(request, null, 'POST', '/api/shifts', { employee_ref: null, role_id: role.id, start_at: nextWednesday(9), end_at: nextWednesday(13) });

  await page.goto('/schedule');
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.getByRole('button', { name: 'Auto Plan' }).click();
  await page.getByRole('dialog', { name: 'Fill the draft open shifts in this period?' }).getByRole('button', { name: 'Auto Plan' }).click();
  const result = page.getByRole('dialog', { name: 'Filled 1 of 1 open shifts' });
  await expect(result).toBeVisible();
  await expect(result.getByText('Ana Lim')).toBeVisible();
});

test('a manager downloads a planned-hours CSV', async ({ page }) => {
  await page.goto('/reports');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^planned-hours_/);
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(Buffer.from(chunk));
  const firstLine = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0];
  expect(firstLine).toBe('Group,Draft hours,Published hours,Total hours,Shifts');
});

test('a manager opens a month from the Year scale', async ({ page }) => {
  const month = DateTime.now().setZone(ZONE).setLocale('en').toFormat('LLLL yyyy');
  await page.goto('/schedule');
  await page.getByRole('radio', { name: 'Year' }).click();
  await page.getByRole('button', { name: new RegExp(`^Ana Lim, ${month}:`) }).click();
  await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
  await expect(page.getByRole('heading', { name: month.slice(0, 3) + month.slice(month.indexOf(' ')) })).toBeVisible();
});

test("an employee's calendar link serves an iCalendar file", async ({ request, playwright }) => {
  const { url } = await call(request, ANA, 'POST', '/api/my/calendar-feed');
  const anonymous = await playwright.request.newContext();
  try {
    const response = await anonymous.get(`${BASE_URL}${new URL(url).pathname}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/calendar');
    expect(await response.text()).toMatch(/^BEGIN:VCALENDAR/);
  } finally {
    await anonymous.dispose();
  }
});
