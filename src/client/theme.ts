/** Light, dark, or follow the device. Saved per browser; "system" is the default and is never stored. */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'interlinkerp-planning-theme';

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system'; // storage blocked (private window, site data off)
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
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
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
