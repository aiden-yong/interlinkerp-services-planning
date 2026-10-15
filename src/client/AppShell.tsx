'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { FeedbackProvider } from './feedback';
import { access, type Screen } from './router';
import type { Me } from './types';

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return <Link href={href} aria-current={active ? 'page' : undefined}>{children}</Link>;
}

export function AppShell({ screen, children }: { screen: Screen; children?: (me: Me) => ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => window.location.reload());
    api<Me>('GET', '/api/me').then(setMe, (error: Error) => setFailure(error.message));
  }, []);

  const verdict = me ? access(screen, me) : null;
  const redirect = verdict && typeof verdict === 'object' ? verdict.redirect : null;
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  let content: ReactNode;
  if (failure) content = <p className="empty">Planning could not start: {failure}</p>;
  else if (!me || redirect) content = <p className="empty">Loading…</p>;
  else if (verdict === 'forbidden') content = <p className="empty">Only Planning Managers can open this page.</p>;
  else if (verdict === 'not-on-roster' || screen === 'not-on-roster') {
    content = <p className="empty">You are signed in as {me.email}, but you are not on the planning roster. Ask a Planning Manager if you expected to see shifts here.</p>;
  } else content = children?.(me);

  return (
    <FeedbackProvider>
      <header className="top">
        <strong>Planning</strong>
        <nav>
          {me?.is_manager && <NavLink href="/schedule" active={screen === 'schedule'}>Schedule</NavLink>}
          {me?.employee_ref && <NavLink href="/my" active={screen === 'my'}>My Planning</NavLink>}
          {me?.is_manager && <NavLink href="/settings" active={screen === 'settings'}>Settings</NavLink>}
        </nav>
        <span className="spacer" />
        {/* No sign-out button: the InterlinkERP gateway is the only place to sign out. */}
        <span className="who">{me?.name ?? me?.email ?? ''}</span>
      </header>
      <main>{content}</main>
    </FeedbackProvider>
  );
}
