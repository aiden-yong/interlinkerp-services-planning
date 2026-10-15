import { randomUUID } from 'node:crypto';
import type { Principal } from '../auth/principal';
import { requestContext } from '../support/requestContext';
import { HttpError } from './errors';
import { envelope, json } from './responses';
import type { Route, Router } from './router';

export interface AccessResult {
  principal: Principal | null;
  /** Set-Cookie values to add to the response. */
  cookies: string[];
}

export interface AccessGuard {
  /** Decides who is calling and whether they may use the route. Throws HttpError 401/403. */
  check(route: Route, request: Request): Promise<AccessResult>;
}

export type Logger = (line: string) => void;

/** Contract SS-4: reuse the caller's id when it is safe to echo, otherwise mint one. */
export function correlationIdFor(request: Request): string {
  const supplied = request.headers.get('x-correlation-id')?.trim() ?? '';
  return supplied.length > 0 && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied) ? supplied : randomUUID();
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === '') return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw HttpError.validation({ body: 'Request body is not valid JSON.' });
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw HttpError.validation({ body: 'Request body must be a JSON object.' });
  }
  return data as Record<string, unknown>;
}

export class Kernel {
  constructor(
    private readonly router: Router,
    private readonly guard: AccessGuard,
    private readonly log: Logger,
  ) {}

  handle(request: Request): Promise<Response> {
    const cid = correlationIdFor(request);
    return requestContext.run({ correlationId: cid }, async () => {
      let response: Response;
      try {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const { route, params } = this.router.match(request.method.toUpperCase(), path);
        const access = await this.guard.check(route, request);
        let body: Promise<Record<string, unknown>> | null = null;
        response = await route.handler({
          request,
          url,
          params,
          query: Object.fromEntries(url.searchParams),
          principal: access.principal,
          body: () => (body ??= readJsonObject(request)),
        });
        for (const cookie of access.cookies) response.headers.append('Set-Cookie', cookie);
      } catch (error) {
        if (error instanceof HttpError) {
          response = json(error.status, envelope(error.code, error.message, cid, error.details), error.headers);
        } else {
          const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
          this.log(`[planning-api] ${cid} ${detail}`);
          response = json(500, envelope('INTERNAL_ERROR', 'An unexpected error occurred.', cid, null));
        }
      }
      response.headers.set('X-Correlation-ID', cid);
      return response;
    });
  }
}
