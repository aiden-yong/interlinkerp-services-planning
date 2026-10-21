import { createHash, randomBytes } from 'node:crypto';
import type { App } from '../app';
import { toICalendar } from '../feeds/ical';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { rosterRef } from '../scheduling/openShiftService';

const DAY_MS = 86_400_000;
const FEED_BACK_DAYS = 30;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const unknownFeed = () => HttpError.notFound('No calendar feed here.');

export function register(r: Router, app: App): void {
  // FR-MYP-03: the employee's own feed link. Only the hash of the token is kept, so the link is shown once, when it is made.
  const mine = ['GET /api/my/calendar-feed', 'POST /api/my/calendar-feed', 'DELETE /api/my/calendar-feed'];

  r.add('GET', '/api/my/calendar-feed', 'person', 'Say whether my calendar feed is on.', async ({ principal }) => {
    const ref = rosterRef(principal!);
    return json(200, { enabled: (await app.calendarFeeds().find(ref)) !== null });
  }, op('My Calendar Feed', 'Check my calendar feed', ['An employee opens the Add to your calendar section'], ['Reading the feed itself'],
    [], ['enabled'], ['Signed-in person on the roster'], mine, ['calendar feed', 'subscribe', 'ics']));

  r.add('POST', '/api/my/calendar-feed', 'person', 'Turn on my calendar feed, or replace its link.', async ({ principal }) => {
    const ref = rosterRef(principal!);
    const token = randomBytes(32).toString('base64url');
    await app.calendarFeeds().upsert(ref, sha256(token), app.clock().now());
    return json(201, { enabled: true, url: `${app.publicUrl()}/feeds/calendar/${token}.ics` });
  }, op('My Calendar Feed', 'Get a new calendar feed link', ['An employee adds their shifts to a calendar app', 'An employee replaces a leaked link'], ['Reading the feed itself'],
    [], ['enabled', 'url'], ['Signed-in person on the roster'], mine, ['calendar feed', 'reset link', 'ics']));

  r.add('DELETE', '/api/my/calendar-feed', 'person', 'Turn off my calendar feed.', async ({ principal }) => {
    await app.calendarFeeds().remove(rosterRef(principal!));
    return noContent();
  }, op('My Calendar Feed', 'Turn off my calendar feed', ['An employee stops sharing their shifts with a calendar app'], ['Replacing the link'],
    [], [], ['Signed-in person on the roster'], mine, ['calendar feed', 'turn off']));

  // D23: the one route that answers without a gateway session. Read-only, one employee's published shifts, secret and resettable.
  r.add('GET', '/feeds/calendar/{file}', 'public', 'The private calendar feed of one employee.', async ({ params }) => {
    const match = /^([A-Za-z0-9_-]{1,128})\.ics$/.exec(params.file ?? '');
    if (!match) throw unknownFeed();
    const hash = sha256(match[1]!);
    const feed = await app.calendarFeeds().byTokenHash(hash);
    if (!feed) throw unknownFeed();
    const directory = app.directory();
    if (!(await directory.isEmpty()) && !(await directory.find(feed.employeeRef))) throw unknownFeed();

    const wait = await app.feedLimiter().take(`feed:${hash.slice(0, 16)}`);
    if (wait !== null) {
      throw new HttpError(429, 'RATE_LIMITED', `Too many requests for this feed. Try again in ${wait} seconds.`, { retry_after_seconds: wait }, { 'Retry-After': String(wait) });
    }

    const now = app.clock().now();
    const until = new Date(now);
    until.setUTCMonth(until.getUTCMonth() + (await app.settings().get()).recurrence_horizon_months);
    const [shifts, roles] = await Promise.all([
      app.shifts().publishedForEmployee(feed.employeeRef, new Date(now.getTime() - FEED_BACK_DAYS * DAY_MS), until),
      app.roles().all(),
    ]);
    const roleNames = new Map(roles.map((role) => [role.id, role.name]));
    const host = new URL(app.publicUrl()).host;
    const body = toICalendar(shifts.map((s) => ({
      uid: `${s.id}@${host}`,
      start: s.start,
      end: s.end,
      summary: (s.roleId && roleNames.get(s.roleId)) || 'Shift',
      description: [s.breakMinutes > 0 ? `Break: ${s.breakMinutes} min` : null, s.note].filter((line): line is string => !!line).join('\n'),
      sequence: s.version,
    })), now);
    await app.calendarFeeds().touch(feed.employeeRef, now);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900' } });
  }, op('My Calendar Feed', 'Read an employee calendar feed', ['A calendar app refreshes the private link an employee subscribed with'], ['Anything that needs a signed-in session'],
    ['file'], ['text/calendar events'], ['None: the secret token in the link is the credential'], mine, ['calendar feed', 'ics', 'subscription']));
}
