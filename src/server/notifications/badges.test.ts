import { describe, expect, it } from 'vitest';
import { FakeHttpClient, reply } from '../test/fakes';
import { GatewayBadgePublisher } from './badges';

describe('GatewayBadgePublisher', () => {
  it('posts counts in batches of 500 with client credentials, clamped and lower-cased', async () => {
    const http = new FakeHttpClient().on('POST', 'https://gw.test/api/badges', reply(200, {}));
    const badges = new GatewayBadgePublisher(http, 'https://gw.test', 'planning-api', 'id', 'secret', () => {});
    const many = Array.from({ length: 1001 }, (_, i) => ({ email: `P${i}@Example.com`, count: i === 0 ? 100_000 : -1 }));
    expect(await badges.publish(many)).toBe(true);
    expect(http.requests).toHaveLength(3);
    expect(http.requests[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    const first = JSON.parse(http.requests[0]!.body!);
    expect(first.service).toBe('planning-api');
    expect(first.badges).toHaveLength(500);
    expect(first.badges[0]).toEqual({ email: 'p0@example.com', count: 99999 });
    expect(first.badges[1]).toEqual({ email: 'p1@example.com', count: 0 });
  });

  it('reports failure without throwing when the gateway refuses or is unreachable', async () => {
    const logs: string[] = [];
    const refused = new GatewayBadgePublisher(new FakeHttpClient().on('POST', 'https://gw.test', reply(503, null)), 'https://gw.test', 's', 'i', 'x', (l) => logs.push(l));
    expect(await refused.publish([{ email: 'a@example.com', count: 1 }])).toBe(false);
    const offline = new GatewayBadgePublisher(new FakeHttpClient(), 'https://gw.test', 's', 'i', 'x', (l) => logs.push(l));
    expect(await offline.publish([{ email: 'a@example.com', count: 1 }])).toBe(false);
    expect(logs).toHaveLength(2);
  });
});
