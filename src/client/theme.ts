/**
 * Light, dark, or follow the device. Saved per browser. "system" is the default and isn't stored, unless <html> names
 * another default (the public demo opens in light), when it has to be remembered like any other choice.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'interlinkerp-planning-theme';

function defaultTheme(): ThemeChoice {
  return document.documentElement.dataset.defaultTheme === 'light' ? 'light' : 'system';
}

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage blocked (private window, site data off): use the default.
  }
  return defaultTheme();
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system' && defaultTheme() === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies to this page; it just won't be remembered.
  }
}

/** CSS reads data-theme on <html>; without it, colours follow prefers-color-scheme. */
export function showTheme(choice: ThemeChoice): void {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
}

/** Runs in <head> while the HTML is parsed, so a saved choice is on screen before the first paint. */
export const THEME_BOOT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});var r=document.documentElement;if(t==="light"||t==="dark")r.setAttribute("data-theme",t);else if(t!=="system"&&r.dataset.defaultTheme)r.setAttribute("data-theme",r.dataset.defaultTheme)}catch(e){}`;
