import { timingSafeEqual } from 'node:crypto';
import type { App } from '../app';
import { HttpError } from '../http/errors';
import { json } from '../http/responses';
import type { Router } from '../http/router';

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireCronSecret(app: App, request: Request): void {
  const secret = app.cronSecret();
  if (!secret || !sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    throw HttpError.unauthorized('A valid cron secret is required.');
  }
}

export function register(r: Router, app: App): void {
  // Vercel cron sends "Authorization: Bearer $CRON_SECRET". Not part of the public API document.
  r.add('GET', '/internal/cron/directory', 'internal', 'Refresh the cached employee directory.', async ({ request }) => {
    requireCronSecret(app, request);
    return json(200, { refreshed: await app.directoryRefresher().refresh() });
  });

  // D1 backstop: delivers anything the after-response sweeps left behind, removes finished rows (backlog item 23)
  // and raises [alert] log lines for failures nobody would otherwise see (backlog item 9).
  r.add('GET', '/internal/cron/notifications', 'internal', 'Deliver due notifications, prune old ones and check for failures.', async ({ request }) => {
    requireCronSecret(app, request);
    const now = app.clock().now();
    const extended = await app.recurrences().extendAll(now);
    const report = await app.delivery().deliverDue();
    return json(200, { ...report, pruned: await app.retention().run(now), alerts: await app.opsCheck().run(now), extended });
  });
}
