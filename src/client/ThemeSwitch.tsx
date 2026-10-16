'use client';

import { useLayoutEffect, useState } from 'react';
import { DisplayIcon, MoonIcon, SunIcon } from './icons';
import { Segmented } from './Segmented';
import { readTheme, saveTheme, showTheme, THEME_KEY, type ThemeChoice } from './theme';

const SEGMENTS = [
  { value: 'system', label: 'System', icon: <DisplayIcon /> },
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
] as const;

export function ThemeSwitch() {
  // The server can't see the saved choice, so start at "system" and correct it before paint.
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useLayoutEffect(() => {
    const sync = () => {
      const saved = readTheme();
      setChoice(saved);
      showTheme(saved); // also restores the attribute React drops on the dev Strict Mode remount
    };
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY || e.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function choose(next: ThemeChoice) {
    setChoice(next);
    saveTheme(next);
    // A short cross-fade instead of a hard cut, so the brightness change isn't a jolt.
    if (typeof document.startViewTransition === 'function') document.startViewTransition(() => showTheme(next));
    else showTheme(next);
  }

  return <Segmented label="Appearance" className="theme-switch" value={choice} segments={SEGMENTS} onChange={choose} />;
}
