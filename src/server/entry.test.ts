import { afterEach, describe, expect, it } from 'vitest';
import { handleApi } from './entry';

const ENV = { SERVICE_ID: 'planning-api', OPENAPI_EXTENSION_KEY: 'x-test', DATABASE_URL: 'postgres://u:p@localhost:5432/none', GATEWAY_URL: 'https://gw.test', PUBLIC_URL: 'https://planning.test', SESSION_SECRET: 'test-secret-test-secret-test-secret' };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('handleApi', () => {
  it('still resolves to a Response when called outside a request scope (scripts, tests)', async () => {
    Object.assign(process.env, ENV);
    const response = await handleApi(new Request('http://localhost/api/does-not-exist'));
    expect(response).toBeInstanceOf(Response);
  });
});
