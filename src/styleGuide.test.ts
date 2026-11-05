import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Fails when this app's tokens drift from Styles.md, the guide every InterlinkERP app shares. */
const guide = readFileSync('Styles.md', 'utf8');
const css = readFileSync('src/app/globals.css', 'utf8');

const TOKENS: Record<string, string> = {
  'Page background': '--bg',
  'Surface (cards, menus, dialogs)': '--surface',
  'Text and headings': '--text',
  'Secondary text': '--muted',
  Borders: '--line',
  'Borders on hover': '--line-strong',
  'Quiet fill (tracks, hover)': '--fill',
  'Primary (logo navy)': '--accent-fill',
  'Primary on hover': '--accent-fill-hover',
};

describe('the style guide', () => {
  for (const [role, token] of Object.entries(TOKENS)) {
    it(`uses the guide's colours for ${role}`, () => {
      const row = new RegExp(`^\\| ${role.replace(/[()]/g, '\\$&')} \\| \`(#[0-9a-f]+)\` \\| \`(#[0-9a-f]+)\` \\|$`, 'm').exec(guide);
      expect(row, `Styles.md has no row for ${role}`).not.toBeNull();
      expect(css).toContain(`${token}: light-dark(${row![1]}, ${row![2]});`);
    });
  }

  it('uses the page title, context title and control sizes it sets', () => {
    expect(css).toMatch(/\.page-head h1 \{[^}]*font-size: 1\.75rem; font-weight: 600;/);
    expect(css).toMatch(/h1\.period \{[^}]*font-size: 1\.45rem; font-weight: 600;/);
    expect(css).toMatch(/--radius: 8px;/);
    expect(css).toMatch(/--radius-lg: 16px;/);
    expect(css).toMatch(/--radius-xl: 22px;/);
  });

  it('never gives a button its own colour outside the tokens', () => {
    const buttons = css.split('\n').filter((line) => /^button[.\s{:]/.test(line));
    expect(buttons.filter((line) => /#[0-9a-f]{3,8}\b/i.test(line))).toEqual([]);
  });
});
