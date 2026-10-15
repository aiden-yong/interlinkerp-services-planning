import type { App } from '../app';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { MAX_RANGE_DAYS } from '../scheduling/scheduleService';
import { isTimezone } from '../support/time';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/schedule', 'manager', 'Read the schedule for a date range: employees, hours, time off and shifts with conflicts.', async ({ query }) => {
    const input = new Input(query);
    const range = input.dateRange('from', 'to', MAX_RANGE_DAYS);
    const zone = input.has('timezone') ? input.string('timezone', 64) : null;
    if (zone && !isTimezone(zone)) input.error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
    input.check();
    return json(200, await app.scheduleService().build(range![0], range![1], zone ?? undefined));
  }, op('Read Schedule', 'See who is planned when, and where the problems are', ['Showing the planning board', 'Checking a week before publishing'], ["Reading one employee's own published shifts"],
    ['from', 'to', 'timezone'], ['period', 'employees[]', 'shifts[]', 'roles[]'], ['Planning Manager'], ['POST /api/shifts', 'POST /api/publications'],
    ['schedule', 'roster', 'rota', 'planning board', 'gantt', 'calendar']));
}
