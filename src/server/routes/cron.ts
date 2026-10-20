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

  // D1 backstop: delivers anything the after-response sweeps left behind, then removes finished rows (backlog item 23).
  r.add('GET', '/internal/cron/notifications', 'internal', 'Deliver due notifications and prune old ones.', async ({ request }) => {
    requireCronSecret(app, request);
    const report = await app.delivery().deliverDue();
    return json(200, { ...report, pruned: await app.retention().run(app.clock().now()) });
  });
}
