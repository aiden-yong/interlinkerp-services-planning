import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { noContent } from './responses';
import { Router, scopeOf } from './router';

function router(): Router {
  const r = new Router();
  const ok = () => noContent();
  r.add('GET', '/api/shifts', 'manager', 'List', ok);
  r.add('GET', '/api/shifts/{id}', 'manager', 'Show', ok);
  r.add('PATCH', '/api/shifts/{id}', 'manager', 'Update', ok);
  r.add('DELETE', '/api/managers/{email}', 'manager', 'Revoke', ok);
  return r;
}

function caught(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (e) {
    return e as HttpError;
  }
  throw new Error('expected an HttpError');
}

describe('Router', () => {
  it('matches path parameters and decodes them', () => {
    expect(router().match('PATCH', '/api/shifts/abc').params).toEqual({ id: 'abc' });
    expect(router().match('DELETE', '/api/managers/bo%40example.com').params).toEqual({ email: 'bo@example.com' });
  });

  it('answers unknown paths with 404', () => {
    const e = caught(() => router().match('GET', '/api/nothing'));
    expect([e.status, e.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
  });

  it('answers a wrong method on a known path with 405 and Allow', () => {
    const e = caught(() => router().match('DELETE', '/api/shifts/abc'));
    expect([e.status, e.code, e.headers.Allow]).toEqual([405, 'METHOD_NOT_ALLOWED', 'GET, PATCH']);
  });

  it('derives scopes from the method; public routes have none', () => {
    const r = router();
    r.add('GET', '/health', 'public', 'Health', () => noContent());
    expect(r.list().map(scopeOf)).toEqual(['planning:read', 'planning:read', 'planning:write', 'planning:write', null]);
  });
});
