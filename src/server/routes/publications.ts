import type { App } from '../app';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';

export function register(r: Router, app: App): void {
  r.add('POST', '/api/publications', 'manager', 'Publish draft shifts and notify the employees concerned.', async ({ body }) =>
    json(201, await app.publishService().publish(await body())),
  op('Publish Shifts', 'Make draft shifts visible to employees and tell them', ["A week's plan is ready to share"], ['Changing a shift that is already published'],
    ['shift_ids'], ['published', 'employees_notified'], ['Planning Manager'], ['GET /api/schedule', 'GET /api/my/shifts'],
    ['publish', 'send schedule', 'release', 'notify']));
}
