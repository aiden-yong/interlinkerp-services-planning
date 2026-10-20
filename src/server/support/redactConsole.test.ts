import { describe, expect, it } from 'vitest';
import { redactConsole } from './redactConsole';

function fakeConsole() {
  const lines: string[] = [];
  const target = { error: (...args: unknown[]) => lines.push(`E ${args.join(' ')}`), warn: (...args: unknown[]) => lines.push(`W ${args.join(' ')}`) };
  return { target, lines };
}

describe('redactConsole', () => {
  it('removes email addresses from errors and warnings, stack included', () => {
    const { target, lines } = fakeConsole();
    redactConsole(target);
    target.error(new Error('No profile for ana@example.com'));
    target.warn('retrying %s', 'bo@example.com');
    expect(lines[0]).toMatch(/^E Error: No profile for \[address\]\n\s+at /);
    expect(lines[1]).toBe('W retrying [address]');
    expect(lines.join('\n')).not.toContain('@example.com');
  });

  it('patches only once', () => {
    const { target, lines } = fakeConsole();
    redactConsole(target);
    redactConsole(target);
    target.error('x');
    expect(lines).toEqual(['E x']);
  });
});
