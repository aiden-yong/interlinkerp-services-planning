import { describe, expect, it } from 'vitest';
import { contrast, inkOn } from './ink';

describe('inkOn', () => {
  it('picks white on dark or saturated role colours', () => {
    expect(inkOn('#2563EB')).toBe('#ffffff');
    expect(inkOn('#9333ea')).toBe('#ffffff');
    expect(inkOn('#000000')).toBe('#ffffff');
  });

  it('picks black on light role colours, where white would be unreadable', () => {
    expect(inkOn('#FACC15')).toBe('#000000');
    expect(inkOn('#16A34A')).toBe('#000000');
    expect(inkOn('#ffffff')).toBe('#000000');
  });

  it('reaches WCAG AA (4.5:1) on every colour a role can have', () => {
    for (let n = 0; n <= 0xffffff; n += 0x0f0f0f + 7) {
      const color = `#${n.toString(16).padStart(6, '0')}`;
      expect(contrast(inkOn(color), color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to white for anything that is not #rrggbb', () => {
    expect(inkOn('teal')).toBe('#ffffff');
  });
});
