import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { Input, slicePage } from './input';

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

  it('collects an error rather than throwing for numbers and objects given as instants', () => {
    const input = new Input({ x: 1_786_000_000_000, y: { at: '2026-10-13T09:00:00+08:00' } });
    expect(input.instant('x')).toBeNull();
    expect(input.instant('y')).toBeNull();
    expect(errors(input).x).toContain('time zone offset');
    expect(errors(input).y).toContain('time zone offset');
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
    expect(errors(bad).d).toBe('Use a real date in YYYY-MM-DD format.');
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

  it('pages by the contract: clamps an oversized limit and rejects limit 0 or a negative offset (SS-12)', () => {
    expect(new Input({}).page(50, 100)).toEqual({ limit: 50, offset: 0 });
    expect(new Input({ limit: '20', offset: '40' }).page(50, 100)).toEqual({ limit: 20, offset: 40 });
    expect(new Input({ limit: '5000' }).page(50, 100)).toEqual({ limit: 100, offset: 0 });
    const bad = new Input({ limit: '0', offset: '-1' });
    bad.page(50, 100);
    expect(errors(bad)).toEqual({ limit: 'Must be at least 1.', offset: 'Must be at least 0.' });
    const junk = new Input({ limit: 'ten', offset: '1.5' });
    junk.page(50, 100);
    expect(Object.keys(errors(junk))).toEqual(['limit', 'offset']);
  });

  it('slices an in-memory list and reports the total', () => {
    expect(slicePage([1, 2, 3, 4, 5], { limit: 2, offset: 1 })).toEqual({ items: [2, 3], pagination: { limit: 2, offset: 1, total: 5 } });
  });
});
