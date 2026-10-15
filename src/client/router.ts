import type { Me } from './types';

export type Screen = 'home' | 'schedule' | 'my' | 'settings' | 'not-on-roster';

export function landingPath(me: Me): string {
  if (me.is_manager) return '/schedule';
  if (me.employee_ref) return '/my';
  return '/not-on-roster';
}

/** What a page should do for this person. The API enforces the same rules; this only avoids showing dead screens. */
export function access(screen: Screen, me: Me): 'ok' | 'forbidden' | 'not-on-roster' | { redirect: string } {
  if (screen === 'home') return { redirect: landingPath(me) };
  if (screen === 'schedule' || screen === 'settings') return me.is_manager ? 'ok' : 'forbidden';
  if (screen === 'my') return me.employee_ref ? 'ok' : 'not-on-roster';
  return 'ok';
}
