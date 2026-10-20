import { ANA, actAs, BO, call, deliverNow, expect, nextWednesday, publishedShift, test } from './fixtures';

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
});
