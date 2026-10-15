import { describe, expect, it } from 'vitest';
import { access, landingPath } from './router';
import type { Me } from './types';

const me = (over: Partial<Me>): Me => ({
  name: 'Ana', email: 'ana@example.com', gateway_role: 'user', employee_ref: null, is_manager: false,
  timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur', ...over,
});

describe('screen access (FR-ACC-02)', () => {
  it('lands managers on the schedule, employees on My Planning, others on a message', () => {
    expect(landingPath(me({ is_manager: true, employee_ref: 'E1' }))).toBe('/schedule');
    expect(landingPath(me({ employee_ref: 'E1' }))).toBe('/my');
    expect(landingPath(me({}))).toBe('/not-on-roster');
    expect(access('home', me({ employee_ref: 'E1' }))).toEqual({ redirect: '/my' });
  });

  it('keeps employees out of manager screens', () => {
    expect(access('schedule', me({ employee_ref: 'E1' }))).toBe('forbidden');
    expect(access('settings', me({ employee_ref: 'E1' }))).toBe('forbidden');
    expect(access('schedule', me({ is_manager: true }))).toBe('ok');
  });

  it('needs a roster reference for My Planning', () => {
    expect(access('my', me({ is_manager: true }))).toBe('not-on-roster');
    expect(access('my', me({ employee_ref: 'E1' }))).toBe('ok');
  });
});
