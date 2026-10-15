import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

describe('settings API', () => {
  it('defaults to the configured time zone', async () => {
    expect((await h.call('GET', '/api/settings')).body.settings).toEqual({ country_code: null, region_code: null, timezone: 'Asia/Kuala_Lumpur' });
  });

  it('saves and keeps absent fields', async () => {
    await h.call('PATCH', '/api/settings', { country_code: 'MY', region_code: 'MY-10' });
    const { status, body } = await h.call('PATCH', '/api/settings', { timezone: 'Asia/Singapore' });
    expect(status).toBe(200);
    expect(body.settings).toEqual({ country_code: 'MY', region_code: 'MY-10', timezone: 'Asia/Singapore' });
  });

  it('names every invalid field', async () => {
    const { status, body } = await h.call('PATCH', '/api/settings', { country_code: 'my', timezone: 'Mars/Olympus' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['country_code', 'timezone']);
  });

  it('is for managers only', async () => {
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/settings')).status).toBe(403);
  });
});
