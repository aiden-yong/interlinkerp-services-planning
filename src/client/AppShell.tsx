'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { FeedbackProvider } from './feedback';
import { CalendarIcon, ChartIcon, GearIcon, PersonIcon } from './icons';
import { access, notOnRosterMessage, type Screen as ScreenName } from './router';
import { NotificationBell } from './notifications/NotificationBell';
import { DevIdentityPicker } from './DevIdentityPicker';
import { ProfileMenu } from './ProfileMenu';
import type { Me } from './types';

const ShellContext = createContext<{ me: Me | null; failure: string | null }>({ me: null, failure: null });

/** Lights up on the click, before the next page arrives, so a link always answers at once. */
function NavLink({ href, active, pending, onPick, icon, children }: { href: string; active: boolean; pending: string | null; onPick: (href: string) => void; icon: ReactNode; children: ReactNode }) {
  const current = pending ? pending === href : active;
  return <Link href={href} prefetch aria-current={current ? 'page' : undefined} onClick={() => onPick(href)}>{icon}{children}</Link>;
}

/**
 * The header and everything shared between pages. It lives in a layout, so it stays mounted while people move around:
 * who they are is asked once, and the bell and profile menu don't start over on every page.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => window.location.reload());
    api<Me>('GET', '/api/me').then(setMe, (error: Error) => setFailure(error.message));
  }, []);
  useEffect(() => setPending(null), [pathname]);

  const link = (href: string) => ({ href, active: pathname === href || pathname.startsWith(`${href}/`), pending, onPick: setPending });

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
          {me?.is_manager && <NavLink {...link('/schedule')} icon={<CalendarIcon />}>Schedule</NavLink>}
          {me?.is_manager && <NavLink {...link('/reports')} icon={<ChartIcon />}>Reports</NavLink>}
          {me?.employee_ref && <NavLink {...link('/my')} icon={<PersonIcon />}>My Planning</NavLink>}
          {me?.is_manager && <NavLink {...link('/settings')} icon={<GearIcon />}>Settings</NavLink>}
        </nav>
        <span className="spacer" />
        {me && pathname !== '/not-on-roster' && <NotificationBell />}
        {me?.dev_identity && <DevIdentityPicker />}
        {me && <ProfileMenu me={me} />}
      </header>
      <main id="main" tabIndex={-1}>
        <ShellContext.Provider value={{ me, failure }}>{children}</ShellContext.Provider>
      </main>
    </FeedbackProvider>
  );
}

/** One page's content, once it's known who is asking and that they may see it. */
export function AppShell({ screen, children }: { screen: ScreenName; children?: (me: Me) => ReactNode }) {
  const router = useRouter();
  const { me, failure } = useContext(ShellContext);
  const verdict = me ? access(screen, me) : null;
  const redirect = verdict && typeof verdict === 'object' ? verdict.redirect : null;
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  if (failure) return <p className="empty">Planning could not start: {failure}</p>;
  if (!me || redirect) return <p className="empty">Loading…</p>;
  if (verdict === 'forbidden') return <p className="empty">Only Planning Managers can open this page.</p>;
  if (verdict === 'not-on-roster' || screen === 'not-on-roster') return <p className="empty">{notOnRosterMessage(me)}</p>;
  return <>{children?.(me)}</>;
}
