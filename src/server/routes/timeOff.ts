import type { App } from '../app';
import { actorId } from '../auth/principal';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { toApi } from '../repo/timeOff';
import { localMidnight, nextDay } from '../support/time';

const MAX_MS = 366 * 86_400_000;

function checkSpan(input: Input, start: Date | null, end: Date | null): void {
  if (!start || !end) return;
  if (end <= start) input.error('end_at', 'Time off must end after it starts.');
  else if (end.getTime() - start.getTime() > MAX_MS) input.error('end_at', 'Time off can last at most 366 days.');
}

export function register(r: Router, app: App): void {
  r.add('GET', '/api/unavailabilities', 'manager', 'List time off overlapping a date range.', async ({ query }) => {
    const input = new Input(query);
    const range = input.dateRange('from', 'to', 366);
    const ref = input.string('employee_ref', 64);
    input.check();
    const zone = await app.settings().timezone();
    const records = await app.timeOff().between(new Date(localMidnight(range![0], zone)), new Date(localMidnight(nextDay(range![1]), zone)), ref);
    return json(200, { unavailabilities: records.map(toApi) });
  }, op('List Time Off', 'See when employees are away', ['Checking who is on leave this week'], ['Listing public holidays'],
    ['from', 'to', 'employee_ref'], ['unavailabilities[]'], ['Planning Manager'], ['POST /api/unavailabilities', 'GET /api/schedule'],
    ['time off', 'leave', 'absence', 'vacation', 'unavailable']));

  r.add('POST', '/api/unavailabilities', 'manager', 'Record time off for an employee.', async ({ body, principal }) => {
    const input = new Input(await body());
    const ref = input.string('employee_ref', 64, true);
    if (ref && !(await app.directory().isEmpty()) && !(await app.directory().find(ref))) input.error('employee_ref', 'Not on the employee roster.');
    const start = input.instant('start_at', true);
    const end = input.instant('end_at', true);
    const reason = input.string('reason', 200) ?? '';
    checkSpan(input, start, end);
    input.check();
    const record = await app.timeOff().create(ref!, start!, end!, reason, principal ? actorId(principal) : 'unknown', app.clock().now());
    return json(201, { unavailability: toApi(record) });
  }, op('Record Time Off', 'Mark an employee as unavailable', ['An employee is on leave, sick or training'], ['Adding a company-wide holiday'],
    ['employee_ref', 'start_at', 'end_at', 'reason'], ['unavailability'], ['Planning Manager', 'Employee on the roster'], ['GET /api/unavailabilities'],
    ['leave', 'sick', 'time off', 'absence']));

  r.add('PATCH', '/api/unavailabilities/{id}', 'manager', 'Change recorded time off.', async ({ params, body }) => {
    const current = (await app.timeOff().find(params.id)) ?? (() => { throw HttpError.notFound('No time off with that id.'); })();
    const input = new Input(await body());
    const start = input.has('start_at') ? input.instant('start_at', true) : current.start;
    const end = input.has('end_at') ? input.instant('end_at', true) : current.end;
    const reason = input.has('reason') ? (input.string('reason', 200) ?? '') : current.reason;
    checkSpan(input, start, end);
    input.check();
    return json(200, { unavailability: toApi(await app.timeOff().update(current.id, start!, end!, reason, app.clock().now())) });
  }, op('Update Time Off', 'Correct the dates or reason of time off', ['Leave was extended or shortened'], ['Recording new time off'],
    ['start_at', 'end_at', 'reason'], ['unavailability'], ['Planning Manager'], ['GET /api/unavailabilities'],
    ['leave', 'time off', 'edit']));

  r.add('DELETE', '/api/unavailabilities/{id}', 'manager', 'Remove recorded time off.', async ({ params }) => {
    if (!(await app.timeOff().delete(params.id))) throw HttpError.notFound('No time off with that id.');
    return noContent();
  }, op('Delete Time Off', 'Remove time off recorded by mistake', ['Leave was cancelled'], ['Shortening leave'],
    ['id'], [], ['Planning Manager'], ['GET /api/unavailabilities'], ['leave', 'time off', 'cancel']));
}
