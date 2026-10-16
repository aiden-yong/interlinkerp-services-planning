import type { App } from '../app';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { recipientOf } from '../repo/notifications';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/notifications', 'person', 'List my notifications, newest first.', async ({ query, principal }) => {
    const input = new Input(query);
    const before = query.before === undefined ? null : Number(query.before);
    if (before !== null && (!Number.isInteger(before) || before < 1)) input.error('before', 'Use the id of the oldest notification you have.');
    input.check();
    const who = recipientOf(principal!);
    return json(200, { notifications: await app.notifications().list(who, query.unread === 'true', before), unread_count: await app.notifications().unreadCount(who) });
  }, op('My Notifications', 'See what changed in my planning', ['Showing the notification bell'], ['Reading the schedule itself'],
    ['unread', 'before'], ['notifications[]', 'unread_count'], ['Signed-in person'], ['POST /api/notification-reads'],
    ['notifications', 'inbox', 'alerts', 'messages']));

  r.add('POST', '/api/notification-reads', 'person', 'Mark my notifications as read.', async ({ body, principal }) => {
    const input = new Input(await body());
    const all = input.raw('all') === true;
    const raw = input.raw('ids');
    const ids = Array.isArray(raw) && raw.length > 0 && raw.length <= 200 && raw.every((id) => Number.isInteger(id) && (id as number) > 0) ? (raw as number[]) : null;
    if (!all && !ids) input.error('ids', 'Send a list of up to 200 notification ids, or all: true.');
    input.check();
    const who = recipientOf(principal!);
    const marked = await app.notifications().markRead(who, all ? null : ids, app.clock().now());
    if (marked > 0) app.deliveryTrigger().noteBadges({ refs: new Set(who.ref ? [who.ref] : []), emails: new Set(who.email ? [who.email] : []) });
    return json(201, { marked });
  }, op('Mark Notifications Read', 'Clear my unread notifications', ['Opening a notification', 'Clearing the bell'], [],
    ['ids', 'all'], ['marked'], ['Signed-in person'], ['GET /api/notifications'], ['read', 'clear', 'dismiss']));
}
