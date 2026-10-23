import type { App } from '../app';
import { actorId } from '../auth/principal';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { actor } from './shifts';

export function register(r: Router, app: App): void {
  r.add('POST', '/api/publications', 'manager', 'Publish draft shifts and notify the employees concerned.', async ({ body, principal }) =>
    json(201, await app.publishService().publish(await body(), actorId(actor(principal)))),
  op('Publish Shifts', 'Make draft shifts visible to employees and tell them', ["A week's plan is ready to share"], ['Changing a shift that is already published'],
    ['shift_ids', 'notify_open_shifts'], ['published', 'employees_notified', 'open_shift_notices'], ['Planning Manager'], ['GET /api/schedule', 'GET /api/my/shifts'],
    ['publish', 'send schedule', 'release', 'notify']));
}
