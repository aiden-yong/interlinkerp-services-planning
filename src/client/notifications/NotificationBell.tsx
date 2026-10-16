'use client';

import './notifications.css';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { NotificationItem, NotificationsPayload } from '../types';
import { unreadLabel } from './inbox';

const POLL_MS = 60_000;

/** FR-NTF-04 in-app: a bell with the unread count and a panel of recent notices. Failing to load never breaks the page. */
export function NotificationBell() {
  const [data, setData] = useState<NotificationsPayload | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<NotificationsPayload>('GET', '/api/notifications'));
    } catch {
      // The bell is a nicety; a 401 already reloads the page through api().
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  async function markRead(body: { ids: number[] } | { all: true }) {
    try {
      await api('POST', '/api/notification-reads', body);
    } finally {
      await load();
    }
  }

  async function openItem(item: NotificationItem) {
    if (!item.read_at) await markRead({ ids: [item.id] });
    window.location.assign(item.link);
  }

  const unread = data?.unread_count ?? 0;
  return (
    <div className="bell">
      <button type="button" className="bell-button" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-count" aria-hidden="true">{unreadLabel(unread)}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" onClick={() => void markRead({ all: true })}>Mark all read</button>}
          </div>
          {data && data.notifications.length === 0 && <p className="muted">Nothing yet.</p>}
          <ul>
            {data?.notifications.map((n) => (
              <li key={n.id} className={n.read_at ? 'read' : 'unread'}>
                <button type="button" onClick={() => void openItem(n)}>
                  <strong>{n.title}</strong>
                  <span className="bell-body">{n.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
