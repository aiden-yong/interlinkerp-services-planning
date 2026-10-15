import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { Input } from './input';

function errors(input: Input): Record<string, string> {
  try {
    input.check();
    return {};
  } catch (e) {
    return (e as HttpError).details as Record<string, string>;
  }
}

describe('Input', () => {
  it('needs an offset on instants, stores UTC, and drops seconds', () => {
    const input = new Input({ a: '2026-10-13T09:00:30+08:00', b: '2026-10-13T09:00:00', c: '2026-02-30T09:00:00+08:00' });
    expect(input.instant('a')?.toISOString()).toBe('2026-10-13T01:00:00.000Z');
    expect(input.instant('b')).toBeNull();
    expect(input.instant('c')).toBeNull();
    expect(errors(input).b).toContain('time zone offset');
    expect(errors(input).c).toBe('Not a real date-time.');
  });

  it('checks required strings and lengths', () => {
    const input = new Input({ name: '  ', long: 'xxxxxx' });
    input.string('name', 10, true);
    input.string('long', 5);
    expect(errors(input)).toEqual({ name: 'This field is required.', long: 'Must be at most 5 characters.' });
  });

  it('accepts only whole numbers in range', () => {
    const input = new Input({ a: '5', b: 101, c: 50 });
    expect(input.int('a', 1, 100, 1)).toBe(1);
    input.int('b', 1, 100);
    expect(input.int('c', 1, 100)).toBe(50);
    expect(errors(input)).toEqual({ a: 'Must be a whole number.', b: 'Must be between 1 and 100.' });
  });

  it('validates dates and ranges', () => {
    expect(new Input({ from: '2026-10-12', to: '2026-10-18' }).dateRange('from', 'to', 62)).toEqual(['2026-10-12', '2026-10-18']);
    const bad = new Input({ d: '2026-13-01' });
    expect(bad.date('d')).toBeNull();
    const long = new Input({ from: '2026-01-01', to: '2026-12-31' });
    expect(long.dateRange('from', 'to', 62)).toBeNull();
    expect(errors(long)).toEqual({ to: 'The range can be at most 62 days.' });
    expect(new Input({ from: '2026-10-12', to: '2026-10-11' }).dateRange('from', 'to', 62)).toBeNull();
  });

  it('reads string lists', () => {
    const input = new Input({ ok: ['a', 'b', 'a'], bad: ['a', 3], obj: { x: 'a' } });
    expect(input.stringList('ok', 10)).toEqual(['a', 'b']);
    expect(input.stringList('bad', 10)).toBeNull();
    expect(input.stringList('obj', 10)).toBeNull();
    expect(Object.keys(errors(input))).toEqual(['bad', 'obj']);
  });
});
