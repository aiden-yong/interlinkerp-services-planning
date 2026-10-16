import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readTheme, saveTheme, showTheme, THEME_BOOT_SCRIPT, THEME_KEY } from './theme';
import { ThemeSwitch } from './ThemeSwitch';

const root = document.documentElement;

afterEach(() => {
  cleanup();
  localStorage.clear();
  root.removeAttribute('data-theme');
});

describe('theme choice', () => {
  it('follows the device until someone picks a theme, and ignores junk in storage', () => {
    expect(readTheme()).toBe('system');
    localStorage.setItem(THEME_KEY, 'sepia');
    expect(readTheme()).toBe('system');
    saveTheme('dark');
    expect(readTheme()).toBe('dark');
  });

  it('marks <html> only for an explicit choice; "system" leaves it to prefers-color-scheme', () => {
    showTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    showTheme('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('forgets the stored choice when set back to system', () => {
    saveTheme('dark');
    saveTheme('system');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('applies a saved choice from the pre-paint script', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('leaves <html> alone in the pre-paint script when nothing valid is saved', () => {
    localStorage.setItem(THEME_KEY, '"><script>');
    new Function(THEME_BOOT_SCRIPT)();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('ThemeSwitch', () => {
  it('shows the saved choice and switches the page when another is picked', () => {
    saveTheme('dark');
    render(<ThemeSwitch />);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');

    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('follows a choice made in another tab', () => {
    render(<ThemeSwitch />);
    localStorage.setItem(THEME_KEY, 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' }));
    });
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);
  });
});
