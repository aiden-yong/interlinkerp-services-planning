'use client';

import './notifications.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { BellIcon } from '../icons';
import type { NotificationItem, NotificationsPayload } from '../types';
import { unreadLabel } from './inbox';

const POLL_MS = 60_000;
/** The server's default page size for /api/notifications. */
const PAGE = 50;

/** FR-NTF-04 in-app: a bell with the unread count and a panel of recent notices. Failing to load never breaks the page. */
export function NotificationBell() {
  const [data, setData] = useState<NotificationsPayload | null>(null);
  /** Older pages loaded with "Load older" (backlog item 27); dropped whenever the newest page is reloaded after a change. */
  const [older, setOlder] = useState<NotificationItem[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  /** Marking read is best effort: a failure never blocks the user and never rejects. */
  async function markRead(body: { ids: number[] } | { all: true }) {
    try {
      await api('POST', '/api/notification-reads', body);
    } catch {
      // The reload below shows the true state.
    }
    setOlder([]);
    setOlderDone(false);
    await load();
  }

  const shown = [...(data?.notifications ?? []), ...older.filter((o) => !data?.notifications.some((n) => n.id === o.id))];

  async function loadOlder() {
    const oldest = shown.at(-1);
    if (!oldest) return;
    try {
      const page = await api<NotificationsPayload>('GET', `/api/notifications?before=${oldest.id}`);
      setOlder((have) => [...have, ...page.notifications]);
      if (page.notifications.length < PAGE) setOlderDone(true);
    } catch {
      // Same as the bell itself: a failed load changes nothing.
    }
  }

  async function openItem(item: NotificationItem) {
    if (!item.read_at) await markRead({ ids: [item.id] });
    // Path and query only, so a preview deployment never jumps to the production host named in the link.
    const target = new URL(item.link, window.location.origin);
    window.location.assign(target.pathname + target.search);
  }

  const unread = data?.unread_count ?? 0;
  return (
    <div className="bell" ref={rootRef}>
      <button type="button" className="bell-button" ref={buttonRef} aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(!open)}>
        <BellIcon />
        {unread > 0 && <span className="bell-count" aria-hidden="true">{unreadLabel(unread)}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications" tabIndex={-1} ref={panelRef}>
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" onClick={() => void markRead({ all: true })}>Mark all read</button>}
          </div>
          {data && shown.length === 0 && <p className="muted">Nothing yet.</p>}
          <ul>
            {shown.map((n) => (
              <li key={n.id} className={n.read_at ? 'read' : 'unread'}>
                <button type="button" onClick={() => void openItem(n)}>
                  <strong>{n.title}</strong>
                  <span className="bell-body">{n.body}</span>
                </button>
              </li>
            ))}
          </ul>
          {data && data.notifications.length >= PAGE && !olderDone && (
            <button type="button" className="bell-more" onClick={() => void loadOlder()}>Load older</button>
          )}
        </div>
      )}
    </div>
  );
}
