import { afterEach, describe, expect, it } from 'vitest';
import { env, requireAll, requireEnv } from './env';

afterEach(() => {
  delete process.env.PLANNING_TEST_A;
  delete process.env.PLANNING_TEST_B;
});

describe('env', () => {
  it('names the missing variable', () => {
    expect(() => requireEnv('PLANNING_TEST_A')).toThrow('Missing required environment variable PLANNING_TEST_A.');
  });

  it('lists every missing variable', () => {
    process.env.PLANNING_TEST_A = 'x';
    expect(() => requireAll(['PLANNING_TEST_A', 'PLANNING_TEST_B'])).toThrow('Missing required environment variables: PLANNING_TEST_B.');
  });

  it('treats an empty value as missing', () => {
    process.env.PLANNING_TEST_A = '';
    expect(env('PLANNING_TEST_A')).toBeUndefined();
    expect(env('PLANNING_TEST_A', 'fallback')).toBe('fallback');
  });
});
