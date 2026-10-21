import type { App } from '../app';
import { actorId } from '../auth/principal';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { MAX_RANGE_DAYS } from '../scheduling/scheduleService';
import { isTimezone } from '../support/time';
import { actor } from './shifts';

export function register(r: Router, app: App): void {
  r.add('POST', '/api/auto-plans', 'manager', 'Fill the draft open shifts of a period automatically, and report what stayed open and why.', async ({ body, principal }) => {
    const input = new Input(await body());
    const range = input.dateRange('from', 'to', MAX_RANGE_DAYS);
    // The viewer zone is resolved as GET /api/schedule and the reports do.
    const zone = input.has('timezone') ? input.string('timezone', 64) : null;
    if (zone && !isTimezone(zone)) input.error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
    input.check();
    const report = await app.autoPlans().run(range![0], range![1], zone ?? undefined, actorId(actor(principal)), app.clock().now());
    return json(201, report);
  }, op('Run Auto Plan', 'Assign draft open shifts to suitable employees without creating conflicts or over-allocation, leaving them as drafts',
    ['Filling the open shifts of a week or month in one go', 'Finding out why an open shift cannot be filled'], ['Assigning one shift to a chosen employee', 'Filling published open shifts (employees claim those)'],
    ['from', 'to', 'timezone'], ['filled[]', 'unfilled[]', 'skipped_published[]', 'skipped_changed[]'],
    ['Planning Manager'], ['GET /api/schedule', 'POST /api/publications', 'GET /api/reports/open-shifts'], ['auto plan', 'auto schedule', 'fill open shifts', 'auto assign']));
}
