import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const afterMock = vi.fn();
vi.mock('next/server', () => ({ after: (task: () => unknown) => afterMock(task) }));

const { handleApi, startsDelivery } = await import('./entry');
const { REQUIRED_ENV } = await import('./app');

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

describe('handleApi logging (backlog item 22)', () => {
  let logged: string[];
  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.join(' ')));
    afterMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const configure = () => {
    for (const key of REQUIRED_ENV) vi.stubEnv(key, 'x');
    vi.stubEnv('DATABASE_URL', 'postgres://nobody@127.0.0.1:1/never_test');
    vi.stubEnv('GATEWAY_URL', 'https://gateway.test');
    vi.stubEnv('PUBLIC_URL', 'https://planning.test');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(32));
  };

  it('answers 500 with the envelope and names the missing setting in the log only', async () => {
    for (const key of REQUIRED_ENV) vi.stubEnv(key, '');
    const response = await handleApi(new Request('http://localhost/api/schedule'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'The service is misconfigured. See the server log.' });
    expect(response.headers.get('X-Correlation-ID')).toBe(body.error.correlation_id);
    expect(logged.join('\n')).toMatch(/\[planning-api\] Missing required environment variables?/);
    expect(JSON.stringify(body)).not.toContain('SESSION_SECRET');
  });

  it('logs a failure to schedule delivery once per distinct error, and stays quiet outside a request scope', async () => {
    configure();
    afterMock.mockImplementation(() => { throw new Error('after() was called outside a request scope'); });
    expect((await handleApi(new Request('http://localhost/api/nope'))).status).toBe(404);
    expect(logged).toEqual([]);

    afterMock.mockImplementation(() => { throw new Error('queue full'); });
    await handleApi(new Request('http://localhost/api/nope'));
    await handleApi(new Request('http://localhost/api/nope'));
    expect(logged).toEqual(['[planning-api] could not schedule delivery after the response: queue full']);
  });

  it('never schedules delivery for health probes', async () => {
    configure();
    await handleApi(new Request('http://localhost/openapi.json'));
    expect(afterMock).not.toHaveBeenCalled();
    await handleApi(new Request('http://localhost/api/nope'));
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});
