import { describe, expect, it } from 'vitest';
import { FakeHttpClient, reply } from '../test/fakes';
import { Gateway } from './gateway';

const GW = 'https://gateway.test';
const gateway = (http: FakeHttpClient) => new Gateway(http, GW, 'https://planning.test');

describe('Gateway', () => {
  it('builds the authorize URL from configured URLs only', () => {
    expect(gateway(new FakeHttpClient()).authorizeUrl('abc_-123')).toBe(`${GW}/oauth/authorize?redirect_uri=https%3A%2F%2Fplanning.test%2F&state=abc_-123`);
  });

  it('exchanges a code server-to-server', async () => {
    const http = new FakeHttpClient().on('POST', `${GW}/oauth/token`, reply(200, { token: 'jwt' }));
    expect(await gateway(http).exchangeCode('c-1')).toBe('jwt');
    expect(JSON.parse(http.requests[0].body!)).toEqual({ code: 'c-1', redirect_uri: 'https://planning.test/' });
  });

  it('throws when the exchange is refused', async () => {
    const http = new FakeHttpClient().on('POST', `${GW}/oauth/token`, reply(400, { error: 'bad' }));
    await expect(gateway(http).exchangeCode('c-1')).rejects.toThrow();
  });

  it('reports live, dead and unknown', async () => {
    const url = `${GW}/oauth/introspect`;
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(200, { active: true }))).liveness('s', 'u')).toBe('live');
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(200, { active: false }))).liveness('s', 'u')).toBe('dead');
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(503, {}))).liveness('s', 'u')).toBe('unknown');
    expect(await gateway(new FakeHttpClient()).liveness('s', 'u')).toBe('unknown');
  });

  it('treats client refusals as dead and server errors as unknown', async () => {
    const url = `${GW}/oauth/introspect`;
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(401, {}))).liveness('s', 'u')).toBe('dead');
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(404, {}))).liveness('s', 'u')).toBe('dead');
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(500, {}))).liveness('s', 'u')).toBe('unknown');
  });

  it('reports live only for a strict boolean true', async () => {
    const url = `${GW}/oauth/introspect`;
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(200, { active: 'true' }))).liveness('s', 'u')).toBe('dead');
  });
});
