import type { Me } from './types';

export type Screen = 'home' | 'schedule' | 'reports' | 'my' | 'settings' | 'not-on-roster';

export function landingPath(me: Me): string {
  if (me.is_manager) return '/schedule';
  if (me.employee_ref) return '/my';
  return '/not-on-roster';
}

/** What a page should do for this person. The API enforces the same rules; this only avoids showing dead screens. */
export function access(screen: Screen, me: Me): 'ok' | 'forbidden' | 'not-on-roster' | { redirect: string } {
  if (screen === 'home') return { redirect: landingPath(me) };
  if (screen === 'schedule' || screen === 'reports' || screen === 'settings') return me.is_manager ? 'ok' : 'forbidden';
  if (screen === 'my') return me.employee_ref ? 'ok' : 'not-on-roster';
  if (screen === 'not-on-roster' && me.employee_ref) return { redirect: landingPath(me) };
  return 'ok';
}

export function notOnRosterMessage(me: Me): string {
  if (me.roster_status === 'failed') return "The employee roster can't be reached right now. Try again in a minute.";
  return `You are signed in as ${me.email}, but you are not on the planning roster. Ask a Planning Manager if you expected to see shifts here.`;
}
