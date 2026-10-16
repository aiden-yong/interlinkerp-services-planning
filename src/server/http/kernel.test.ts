import { describe, expect, it } from 'vitest';
import type { Principal } from '../auth/principal';
import { currentCorrelationId } from '../support/requestContext';
import { HttpError } from './errors';
import { type AccessGuard, Kernel } from './kernel';
import { json } from './responses';
import { Router } from './router';

const open: AccessGuard = { check: async () => ({ principal: null, cookies: [] }) };
const kernel = (r: Router, guard: AccessGuard = open, logged: string[] = []) => new Kernel(r, guard, (line) => logged.push(line));
const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);

describe('Kernel', () => {
  it('reuses a safe correlation id and exposes it during the request', async () => {
    const r = new Router();
    r.add('GET', '/ok', 'public', 'Ok', () => json(200, { cid: currentCorrelationId() }));
    const response = await kernel(r).handle(req('/ok', { headers: { 'X-Correlation-ID': 'trace-42' } }));
    expect(response.headers.get('X-Correlation-ID')).toBe('trace-42');
    expect(await response.json()).toEqual({ cid: 'trace-42' });
  });

  it('mints a correlation id when the supplied one is unsafe', async () => {
    const response = await kernel(new Router()).handle(req('/x', { headers: { 'X-Correlation-ID': 'bad value!' } }));
    expect(response.headers.get('X-Correlation-ID')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the envelope for unrouted paths', async () => {
    const response = await kernel(new Router()).handle(req('/nope'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'RESOURCE_NOT_FOUND', message: 'No route for /nope.', correlation_id: response.headers.get('X-Correlation-ID'), details: null },
    });
  });

  it('hides unexpected errors behind a generic 500 and logs them', async () => {
    const r = new Router();
    r.add('GET', '/boom', 'public', 'Boom', () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const logged: string[] = [];
    const response = await kernel(r, open, logged).handle(req('/boom'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret_table');
    expect(logged[0]).toContain('secret_table');
  });

  it('scrubs email addresses from the logged 500 and never returns them (DR-02)', async () => {
    const r = new Router();
    r.add('GET', '/boom', 'public', 'Boom', () => {
      throw new Error('Failed query: insert\nparams: ana@example.com');
    });
    const logged: string[] = [];
    const response = await kernel(r, open, logged).handle(req('/boom'));
    expect(await response.text()).not.toContain('example.com');
    expect(logged[0]).toContain('[address]');
    expect(logged[0]).not.toContain('@example.com');
  });

  it('passes the principal to the handler and appends guard cookies', async () => {
    const r = new Router();
    r.add('GET', '/me', 'person', 'Me', ({ principal }) => json(200, { who: principal?.email }));
    const guard: AccessGuard = {
      check: async () => ({ principal: { kind: 'person', subject: 's', email: 'ana@example.com' } as Principal, cookies: ['planning_session=abc; Path=/'] }),
    };
    const response = await kernel(r, guard).handle(req('/me'));
    expect(await response.json()).toEqual({ who: 'ana@example.com' });
    expect(response.headers.get('Set-Cookie')).toBe('planning_session=abc; Path=/');
  });

  it('keeps HttpError headers and rejects non-object JSON bodies', async () => {
    const r = new Router();
    r.add('GET', '/x', 'public', 'X', () => {
      throw new HttpError(401, 'UNAUTHORIZED', 'Signed out.', null, { 'Set-Cookie': 'planning_session=; Max-Age=0' });
    });
    r.add('POST', '/y', 'public', 'Y', async ({ body }) => json(200, await body()));
    expect((await kernel(r).handle(req('/x'))).headers.get('Set-Cookie')).toBe('planning_session=; Max-Age=0');
    const bad = await kernel(r).handle(req('/y', { method: 'POST', body: '[1,2]' }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.details).toEqual({ body: 'Request body must be a JSON object.' });
  });
});
