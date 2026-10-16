import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { GatewayBadgePublisher, noBadges } from './badges';

const KEYS = ['GATEWAY_BADGES', 'INTERLINK_CLIENT_ID', 'INTERLINK_CLIENT_SECRET', 'GATEWAY_URL', 'SERVICE_ID', 'OPENAPI_EXTENSION_KEY'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function badgesWith(vars: Record<string, string | undefined>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { GATEWAY_URL: 'https://gw.test', SERVICE_ID: 'planning-api', OPENAPI_EXTENSION_KEY: 'x-test' });
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  return new App({ logger: () => {} }).badges();
}

describe('App.badges()', () => {
  it('is the no-op publisher unless GATEWAY_BADGES is on and both client credentials are set', () => {
    expect(badgesWith({})).toBe(noBadges);
    expect(badgesWith({ GATEWAY_BADGES: 'off', INTERLINK_CLIENT_ID: 'i', INTERLINK_CLIENT_SECRET: 's' })).toBe(noBadges);
    expect(badgesWith({ GATEWAY_BADGES: 'on', INTERLINK_CLIENT_SECRET: 's' })).toBe(noBadges);
    expect(badgesWith({ GATEWAY_BADGES: 'on', INTERLINK_CLIENT_ID: 'i' })).toBe(noBadges);
    expect(badgesWith({ GATEWAY_BADGES: 'on', INTERLINK_CLIENT_ID: 'i', INTERLINK_CLIENT_SECRET: 's' })).toBeInstanceOf(GatewayBadgePublisher);
  });
});
