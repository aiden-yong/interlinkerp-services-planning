import { describe, expect, it } from 'vitest';
import type { Principal } from '../auth/principal';
import { currentCorrelationId } from '../support/requestContext';
import { HttpError } from './errors';
import { type AccessGuard, Kernel, MAX_BODY_BYTES } from './kernel';
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
  describe('headers on every response (backlog item 12)', () => {
    const refreshing: AccessGuard = { check: async () => ({ principal: null, cookies: ['planning_session=new; Path=/'] }) };

    it('keeps a refreshed session cookie when the handler fails', async () => {
      const r = new Router();
      r.add('GET', '/bad', 'public', 'Bad', () => {
        throw HttpError.validation({ x: 'wrong' });
      });
      r.add('GET', '/boom', 'public', 'Boom', () => {
        throw new Error('kaput');
      });
      expect((await kernel(r, refreshing).handle(req('/bad'))).headers.get('Set-Cookie')).toBe('planning_session=new; Path=/');
      expect((await kernel(r, refreshing).handle(req('/boom'))).headers.get('Set-Cookie')).toBe('planning_session=new; Path=/');
    });

    it('lets an error that clears the session win over the refresh', async () => {
      const r = new Router();
      r.add('GET', '/out', 'public', 'Out', () => {
        throw new HttpError(401, 'UNAUTHORIZED', 'Signed out.', null, { 'Set-Cookie': 'planning_session=; Max-Age=0' });
      });
      expect((await kernel(r, refreshing).handle(req('/out'))).headers.get('Set-Cookie')).toBe('planning_session=; Max-Age=0');
    });

    it('marks answers no-store unless a successful route chose its own caching', async () => {
      const r = new Router();
      r.add('GET', '/ok', 'public', 'Ok', () => json(200, {}));
      r.add('GET', '/cached', 'public', 'Cached', () => json(200, {}, { 'Cache-Control': 'public, max-age=60' }));
      expect((await kernel(r).handle(req('/ok'))).headers.get('Cache-Control')).toBe('no-store');
      expect((await kernel(r).handle(req('/cached'))).headers.get('Cache-Control')).toBe('public, max-age=60');
      expect((await kernel(r).handle(req('/missing'))).headers.get('Cache-Control')).toBe('no-store');
    });
  });

  describe('HEAD and OPTIONS (backlog item 19)', () => {
    const routes = () => {
      const r = new Router();
      r.add('GET', '/things', 'public', 'List', () => json(200, { things: [1] }));
      r.add('POST', '/things', 'public', 'Add', () => json(201, {}));
      r.add('DELETE', '/things/{id}', 'public', 'Remove', () => new Response(null, { status: 204 }));
      return r;
    };

    it('answers HEAD like GET, without a body', async () => {
      const response = await kernel(routes()).handle(req('/things', { method: 'HEAD' }));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');
      expect(response.headers.get('X-Correlation-ID')).toBeTruthy();
      expect(await response.text()).toBe('');
    });

    it('answers OPTIONS with the allowed methods', async () => {
      const response = await kernel(routes()).handle(req('/things', { method: 'OPTIONS' }));
      expect(response.status).toBe(204);
      expect(response.headers.get('Allow')).toBe('GET, POST, HEAD, OPTIONS');
      expect((await kernel(routes()).handle(req('/things/1', { method: 'OPTIONS' }))).headers.get('Allow')).toBe('DELETE, OPTIONS');
      expect((await kernel(routes()).handle(req('/nope', { method: 'OPTIONS' }))).status).toBe(404);
    });

    it('still refuses a wrong method with 405 and lists HEAD and OPTIONS', async () => {
      const response = await kernel(routes()).handle(req('/things/1', { method: 'HEAD' }));
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('DELETE, OPTIONS');
    });
  });

  describe('request body cap', () => {
    const echo = () => {
      const r = new Router();
      r.add('POST', '/y', 'public', 'Y', async ({ body }) => json(200, await body()));
      return r;
    };
    const chunked = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += 4096) controller.enqueue(bytes.slice(at, at + 4096));
          controller.close();
        },
      });
      return req('/y', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    };

    it('accepts a body of exactly 64 KB', async () => {
      const text = JSON.stringify({ note: 'a'.repeat(MAX_BODY_BYTES - 11) });
      expect(new TextEncoder().encode(text).length).toBe(MAX_BODY_BYTES);
      expect((await kernel(echo()).handle(req('/y', { method: 'POST', body: text }))).status).toBe(200);
    });

    it('rejects a declared Content-Length over 64 KB with 413 before reading', async () => {
      const response = await kernel(echo()).handle(req('/y', { method: 'POST', body: '{}', headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } }));
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('stops reading a chunked body once it passes 64 KB', async () => {
      const response = await kernel(echo()).handle(chunked(JSON.stringify({ note: 'a'.repeat(MAX_BODY_BYTES) })));
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('decodes multi-byte characters split across chunks', async () => {
      const response = await kernel(echo()).handle(chunked(JSON.stringify({ note: 'é'.repeat(5000) })));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ note: 'é'.repeat(5000) });
    });
  });
});
