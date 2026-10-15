import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../app';
import { SERVICE_VERSION } from '../config/serviceInfo';
import type { Database } from '../db/client';

beforeAll(() => {
  process.env.SERVICE_ID = 'planning-api';
  process.env.OPENAPI_EXTENSION_KEY = 'x-test';
  process.env.GATEWAY_URL = 'https://gateway.test';
  process.env.PUBLIC_URL = 'https://planning.test';
  process.env.SESSION_SECRET = 's'.repeat(32);
});

function appWithDatabase(up: boolean): App {
  return new App({ database: { ping: async () => up } as unknown as Database });
}

describe('GET /health', () => {
  it('is ok when the database answers', async () => {
    const response = await appWithDatabase(true).kernel().handle(new Request('http://localhost/health'));
    expect(await response.json()).toEqual({ status: 'ok', service: 'planning-api', version: SERVICE_VERSION, checks: { database: true } });
  });

  it('is degraded, still 200, when it does not', async () => {
    const response = await appWithDatabase(false).kernel().handle(new Request('http://localhost/health'));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('degraded');
  });
});
