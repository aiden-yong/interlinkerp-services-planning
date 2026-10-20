import { describe, expect, it } from 'vitest';
import { startsDelivery } from './entry';

describe('startsDelivery (backlog item 17)', () => {
  it('runs the delivery sweep after app requests only', () => {
    const at = (path: string) => startsDelivery(new Request(`http://localhost${path}`));
    expect(at('/api/schedule')).toBe(true);
    expect(at('/api/notification-reads')).toBe(true);
    expect(at('/health')).toBe(false);
    expect(at('/openapi.json')).toBe(false);
    expect(at('/internal/cron/notifications')).toBe(false);
  });
});
