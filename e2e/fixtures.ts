import { type APIRequestContext, type BrowserContext, expect, test as base } from '@playwright/test';
import { DateTime } from 'luxon';
import { createDatabase } from '../src/server/db/client';
import { BASE_URL, CRON_SECRET, DATABASE_URL, ZONE } from './env';
import { reset } from './global-setup';

export interface Persona { email: string; name: string; role: 'admin' | 'user'; ref: string | null }
export const ANA: Persona = { email: 'ana@example.com', name: 'Ana Lim', role: 'user', ref: 'E1' };
export const BO: Persona = { email: 'bo@example.com', name: 'Bo Tan', role: 'user', ref: 'E2' };

/** The identity picker's cookie (backlog item 32); without it the browser is the manager from SERVER_ENV. */
const cookieValue = (p: Persona) => Buffer.from(JSON.stringify(p)).toString('base64url');

export async function actAs(context: BrowserContext, persona: Persona | null): Promise<void> {
  await context.clearCookies({ name: 'planning_dev_as' });
  if (persona) await context.addCookies([{ name: 'planning_dev_as', value: cookieValue(persona), url: BASE_URL }]);
}

/** Next week's Wednesday in the organisation's zone: always in the future and always one "Next week" click away. */
export function nextWednesday(hour: number): string {
  return DateTime.now().setZone(ZONE).startOf('week').plus({ weeks: 1, days: 2 }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toISO({ suppressMilliseconds: true })!;
}

/** Calls the API as a person (the manager when persona is null), the way the browser would. */
export async function call(request: APIRequestContext, persona: Persona | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = persona ? { cookie: `planning_dev_as=${cookieValue(persona)}` } : {};
  const response = await request.fetch(path, { method, headers, data: body });
  const json = await response.json().catch(() => null);
  expect(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(json)}`).toBe(true);
  return json;
}

export async function publishedShift(request: APIRequestContext, employeeRef: string | null): Promise<string> {
  const { shift } = await call(request, null, 'POST', '/api/shifts', { employee_ref: employeeRef, start_at: nextWednesday(9), end_at: nextWednesday(17) });
  await call(request, null, 'POST', '/api/publications', { shift_ids: [shift.id] });
  return shift.id;
}

/** What the daily cron does, so notices arrive without waiting for the after-response sweep's 30-second throttle. */
export async function deliverNow(request: APIRequestContext): Promise<void> {
  const response = await request.get('/internal/cron/notifications', { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(response.ok()).toBe(true);
}

/** Every test starts from the seeded directory and nothing else, and fails if the page breaks its own security policy. */
export const test = base.extend<{ clean: void; cspClean: void }>({
  clean: [async ({}, use) => {
    const database = createDatabase(DATABASE_URL);
    try {
      await reset(database.pool);
    } finally {
      await database.close();
    }
    await use();
  }, { auto: true }],
  // Backlog item 4: a script or style the Content-Security-Policy blocks shows up as a console error.
  cspClean: [async ({ page }, use) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) violations.push(message.text());
    });
    await use();
    expect(violations, 'Content-Security-Policy violations').toEqual([]);
  }, { auto: true }],
});

export { expect };
