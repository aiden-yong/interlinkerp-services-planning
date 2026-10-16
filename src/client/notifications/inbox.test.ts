import { describe, expect, it } from 'vitest';
import { unreadLabel } from './inbox';

describe('unreadLabel', () => {
  it('caps the badge at 99+', () => {
    expect([unreadLabel(1), unreadLabel(99), unreadLabel(100)]).toEqual(['1', '99', '99+']);
  });
});
