import type { App } from '../app';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { NOTICE_TYPES, type NoticeType, typesFor } from '../repo/emailPreferences';
import { recipientOf } from '../repo/notifications';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/notifications', 'person', 'List my notifications, newest first.', async ({ query, principal }) => {
    const input = new Input(query);
    const before = query.before === undefined ? null : Number(query.before);
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) input.error('before', 'Use the id of the oldest notification you have.');
    if (query.unread !== undefined && query.unread !== 'true' && query.unread !== 'false') input.error('unread', 'Use true or false.');
    const page = input.page(50, 100);
    input.check();
    const who = recipientOf(principal!);
    return json(200, { notifications: await app.notifications().list(who, query.unread === 'true', before, page), unread_count: await app.notifications().unreadCount(who), pagination: page });
  }, op('My Notifications', 'See what changed in my planning', ['Showing the notification bell'], ['Reading the schedule itself'],
    ['unread', 'before', 'limit', 'offset'], ['notifications[]', 'unread_count', 'pagination'], ['Signed-in person'], ['POST /api/notification-reads'],
    ['notifications', 'inbox', 'alerts', 'messages']));

  r.add('POST', '/api/notification-reads', 'person', 'Mark my notifications as read.', async ({ body, principal }) => {
    const input = new Input(await body());
    const all = input.raw('all') === true;
    const raw = input.raw('ids');
    const ids = Array.isArray(raw) && raw.length > 0 && raw.length <= 200 && raw.every((id) => Number.isSafeInteger(id) && (id as number) > 0) ? (raw as number[]) : null;
    if (!all && !ids) input.error('ids', 'Send a list of up to 200 notification ids, or all: true.');
    input.check();
    const who = recipientOf(principal!);
    const marked = await app.notifications().markRead(who, all ? null : ids, app.clock().now());
    if (marked > 0) app.deliveryTrigger().noteBadges({ refs: new Set(who.ref ? [who.ref] : []), emails: new Set(who.email ? [who.email] : []) });
    return json(201, { marked });
  }, op('Mark Notifications Read', 'Clear my unread notifications', ['Opening a notification', 'Clearing the bell'], [],
    ['ids', 'all'], ['marked'], ['Signed-in person'], ['GET /api/notifications'], ['read', 'clear', 'dismiss']));

  r.add('GET', '/api/my/notification-preferences', 'person', 'List the notice types I receive and whether each is also emailed.', async ({ principal }) =>
    json(200, { preferences: await app.emailPreferences().list(recipientOf(principal!)) }),
  op('My Email Preferences', 'See which notices also reach me by email', ['Showing email settings'], ['Reading the notices themselves'],
    [], ['preferences[].kind', 'preferences[].label', 'preferences[].email'], ['Signed-in person'], ['PATCH /api/my/notification-preferences', 'GET /api/notifications'],
    ['email', 'preferences', 'notification settings', 'mute']));

  r.add('PATCH', '/api/my/notification-preferences', 'person', 'Turn email on or off for notice types I receive. In-app notices always stay on.', async ({ body, principal }) => {
    const input = new Input(await body());
    const who = recipientOf(principal!);
    const mine = new Map<string, NoticeType>(typesFor(who).map((t) => [t.kind, t]));
    const raw = input.raw('email');
    const changes = new Map<NoticeType, boolean>();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw).length === 0) {
      input.error('email', 'Send an object of notice type to true (email me) or false (in-app only).');
    } else {
      for (const [kind, value] of Object.entries(raw)) {
        const type = mine.get(kind);
        if (!type) input.error(`email.${kind}`, NOTICE_TYPES.some((t) => t.kind === kind) ? 'You do not receive this notice type.' : 'Unknown notice type.');
        else if (typeof value !== 'boolean') input.error(`email.${kind}`, 'Must be true or false.');
        else changes.set(type, value);
      }
    }
    input.check();
    await app.emailPreferences().set(who, changes, app.clock().now());
    return json(200, { preferences: await app.emailPreferences().list(who) });
  }, op('Change Email Preferences', 'Choose which notices also reach me by email', ['Stopping emails about a notice type', 'Turning emails back on'], ['Marking notices read'],
    ['email'], ['preferences[]'], ['Signed-in person'], ['GET /api/my/notification-preferences'], ['email', 'unsubscribe', 'mute', 'preferences']));
}
