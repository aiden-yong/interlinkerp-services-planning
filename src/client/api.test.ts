import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, query, setUnauthorizedHandler } from './api';

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
const envelope = (code: string) => ({ error: { code, message: 'Nope.', correlation_id: 'cid-1', details: { conflicts: [] } } });

describe('api', () => {
  it('returns parsed JSON, and undefined for 204', async () => {
    expect(await api('GET', '/api/me', undefined, respond(200, { a: 1 }))).toEqual({ a: 1 });
    expect(await api('DELETE', '/api/shifts/1', undefined, respond(204, null))).toBeUndefined();
  });

  it('sends JSON bodies', async () => {
    const fetchImpl = respond(201, {});
    await api('POST', '/api/roles', { name: 'Tech' }, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"name":"Tech"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('turns the error envelope into an ApiError', async () => {
    await expect(api('POST', '/api/shifts', {}, respond(409, envelope('SHIFT_CONFLICT')))).rejects.toMatchObject({
      status: 409, code: 'SHIFT_CONFLICT', correlationId: 'cid-1', details: { conflicts: [] },
    });
  });

  it('reloads the page by default on 401 so proxy.ts re-runs sign-in (Review Focus 5)', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    try {
      await expect(api('GET', '/api/schedule', undefined, respond(401, envelope('UNAUTHORIZED')))).rejects.toBeInstanceOf(ApiError);
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hands 401 to the unauthorized handler so the page can re-run sign-in (Review Focus 5)', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api('GET', '/api/me', undefined, respond(401, envelope('UNAUTHORIZED')))).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call the handler for other errors', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api('GET', '/api/me', undefined, respond(403, envelope('FORBIDDEN')))).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('copes with a non-JSON error page', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(api('GET', '/api/x', undefined, fetchImpl)).rejects.toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('builds query strings without empty values', () => {
    expect(query({ from: '2026-10-12', to: '2026-10-18', employee_ref: undefined, x: '' })).toBe('?from=2026-10-12&to=2026-10-18');
    expect(query({})).toBe('');
  });
});
