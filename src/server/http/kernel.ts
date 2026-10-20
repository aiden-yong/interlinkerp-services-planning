import { randomUUID } from 'node:crypto';
import type { Principal } from '../auth/principal';
import { requestContext } from '../support/requestContext';
import { redactAddresses } from '../support/scrub';
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

/** The largest JSON body a route will read; anything bigger gets 413 before it is buffered. */
export const MAX_BODY_BYTES = 64 * 1024;

function tooLarge(): HttpError {
  return new HttpError(413, 'PAYLOAD_TOO_LARGE', `The request body must be at most ${MAX_BODY_BYTES / 1024} KB.`);
}

/** Reads the body as text, refusing a declared or streamed size over MAX_BODY_BYTES. */
async function readCappedText(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await readCappedText(request);
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
      // Kept outside the try so an error response still carries a session the guard just refreshed (backlog item 12).
      let refreshed: string[] = [];
      try {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const method = request.method.toUpperCase();
        if (method === 'OPTIONS') return this.finish(new Response(null, { status: 204, headers: { Allow: this.router.allowed(path).join(', ') } }), [], cid, false);
        const { route, params } = this.router.match(method, path);
        const access = await this.guard.check(route, request);
        refreshed = access.cookies;
        let body: Promise<Record<string, unknown>> | null = null;
        response = await route.handler({
          request,
          url,
          params,
          query: Object.fromEntries(url.searchParams),
          principal: access.principal,
          body: () => (body ??= readJsonObject(request)),
        });
      } catch (error) {
        if (error instanceof HttpError) {
          response = json(error.status, envelope(error.code, error.message, cid, error.details), error.headers);
          // An error that sets its own cookie (signing out) wins over the refresh.
          if (response.headers.has('Set-Cookie')) refreshed = [];
        } else {
          const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
          this.log(`[planning-api] ${cid} ${redactAddresses(detail)}`);
          response = json(500, envelope('INTERNAL_ERROR', 'An unexpected error occurred.', cid, null));
        }
      }
      return this.finish(response, refreshed, cid, request.method.toUpperCase() === 'HEAD');
    });
  }

  /** The headers every response gets, in one place, errors included. HEAD keeps the GET headers and drops the body. */
  private finish(response: Response, cookies: string[], cid: string, head: boolean): Response {
    for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
    // Auth guide §7: API answers are per caller, so nothing may cache them unless a route says otherwise.
    if (!response.ok || !response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Correlation-ID', cid);
    return head ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
}
