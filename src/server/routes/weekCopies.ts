import type { App } from '../app';
import { actorId } from '../auth/principal';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { actor } from './shifts';

export function register(r: Router, app: App): void {
  r.add('POST', '/api/week-copies', 'manager', "Copy last week's one-off shifts into this week as drafts.", async ({ body, principal }) => {
    const input = new Input(await body());
    const parsed = app.weekCopies().parse(input);
    input.check();
    const report = await app.weekCopies().run(parsed!.weekStart, parsed!.dryRun, actorId(actor(principal)), app.clock().now());
    return json(parsed!.dryRun ? 200 : 201, report);
  }, op('Copy Previous Week', "Duplicate last week's one-off shifts into this week as drafts, so a manager need not re-plan from scratch",
    ["Starting this week's plan from last week's pattern"], ['Copying a repeating series (it already extends itself)', 'Changing a shift that is already published'],
    ['week_start', 'dry_run'], ['created', 'skipped_recurring', 'skipped_already_copied', 'skipped_off_roster', 'conflicts'],
    ['Planning Manager'], ['GET /api/schedule', 'POST /api/publications'], ['copy week', 'duplicate week', 'repeat last week']));
}
