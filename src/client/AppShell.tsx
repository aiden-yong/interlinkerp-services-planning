'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { FeedbackProvider } from './feedback';
import { CalendarIcon, ChartIcon, GearIcon, PersonIcon } from './icons';
import { access, notOnRosterMessage, type Screen } from './router';
import { NotificationBell } from './notifications/NotificationBell';
import { DevIdentityPicker } from './DevIdentityPicker';
import { ProfileMenu } from './ProfileMenu';
import type { Me } from './types';

function NavLink({ href, active, icon, children }: { href: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return <Link href={href} aria-current={active ? 'page' : undefined}>{icon}{children}</Link>;
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
  else if (verdict === 'not-on-roster' || screen === 'not-on-roster') content = <p className="empty">{notOnRosterMessage(me)}</p>;
  else content = children?.(me);

  return (
    <FeedbackProvider>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="top">
        <span className="brand">
          <span className="brand-logo-full">
            <img src="/brand/interlinkerp-logo-light.svg" alt="InterlinkERP" className="brand-logo-light" />
            <img src="/brand/interlinkerp-logo-dark.svg" alt="InterlinkERP" className="brand-logo-dark" />
          </span>
          <span className="brand-logo-icon">
            <img src="/brand/interlinkerp-icon-light.svg" alt="InterlinkERP" className="brand-logo-light" />
            <img src="/brand/interlinkerp-icon-dark.svg" alt="InterlinkERP" className="brand-logo-dark" />
          </span>
          <span className="brand-app">Planning</span>
          {me?.demo && <span className="badge badge-neutral">Demo</span>}
        </span>
        <nav aria-label="Planning">
          {me?.is_manager && <NavLink href="/schedule" active={screen === 'schedule'} icon={<CalendarIcon />}>Schedule</NavLink>}
          {me?.is_manager && <NavLink href="/reports" active={screen === 'reports'} icon={<ChartIcon />}>Reports</NavLink>}
          {me?.employee_ref && <NavLink href="/my" active={screen === 'my'} icon={<PersonIcon />}>My Planning</NavLink>}
          {me?.is_manager && <NavLink href="/settings" active={screen === 'settings'} icon={<GearIcon />}>Settings</NavLink>}
        </nav>
        <span className="spacer" />
        {me && screen !== 'not-on-roster' && <NotificationBell />}
        {me?.dev_identity && <DevIdentityPicker />}
        {me && <ProfileMenu me={me} />}
      </header>
      <main id="main" tabIndex={-1}>{content}</main>
    </FeedbackProvider>
  );
}
