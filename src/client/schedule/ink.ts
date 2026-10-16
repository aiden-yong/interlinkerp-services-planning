const HEX = /^#([0-9a-f]{6})$/i;

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const n = parseInt(HEX.exec(hex)![1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour for a label on a solid role colour. Whichever of white or black contrasts more is
 * always at least 4.58:1, so any colour a manager picks stays readable.
 */
export function inkOn(color: string): '#ffffff' | '#000000' {
  if (!HEX.test(color)) return '#ffffff';
  return contrast('#ffffff', color) >= contrast('#000000', color) ? '#ffffff' : '#000000';
}
