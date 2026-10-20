import type { Principal } from '../auth/principal';
import type { OperationDoc } from './doc';
import { HttpError } from './errors';

/**
 * public: no auth, listed in OpenAPI (only /health and /openapi.json, contract SS-8).
 * internal: not in OpenAPI; the handler checks its own secret (cron).
 * person: any signed-in person; programs are refused.
 * manager: Planning Managers (BR-12), or programs holding the route's scope.
 * person-manager: Planning Managers only, as signed-in people; programs are refused (who manages planning is a person's decision).
 */
export type Access = 'public' | 'internal' | 'person' | 'manager' | 'person-manager';

export interface HandlerContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
  query: Record<string, string>;
  principal: Principal | null;
  body(): Promise<Record<string, unknown>>;
}

export type Handler = (ctx: HandlerContext) => Promise<Response> | Response;

export interface Route {
  method: string;
  path: string;
  access: Access;
  summary: string;
  handler: Handler;
  doc: OperationDoc | null;
}

/** Scope a program's access token must hold for this route (contract SS-7). */
export function scopeOf(route: Route): string | null {
  if (route.access === 'public' || route.access === 'internal') return null;
  return route.method === 'GET' ? 'planning:read' : 'planning:write';
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean);
  const got = path.split('/').filter(Boolean);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const name = /^\{([a-z_]+)\}$/.exec(want[i]);
    if (name) {
      try {
        params[name[1]] = decodeURIComponent(got[i]);
      } catch {
        return null;
      }
    } else if (want[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, access: Access, summary: string, handler: Handler, doc: OperationDoc | null = null): void {
    this.routes.push({ method: method.toUpperCase(), path, access, summary, handler, doc });
  }

  list(): Route[] {
    return [...this.routes];
  }

  /** Methods a path answers, HEAD and OPTIONS included (HTTP semantics, backlog item 19). Throws 404 for an unknown path. */
  allowed(path: string): string[] {
    const methods: string[] = [];
    for (const route of this.routes) if (matchPath(route.path, path) && !methods.includes(route.method)) methods.push(route.method);
    if (methods.length === 0) throw HttpError.notFound(`No route for ${path}.`);
    return [...methods, ...(methods.includes('GET') ? ['HEAD'] : []), 'OPTIONS'];
  }

  /** HEAD runs the GET route (the kernel drops the body). OPTIONS is answered by the kernel from allowed(). */
  match(method: string, path: string): { route: Route; params: Record<string, string> } {
    const wanted = method === 'HEAD' ? 'GET' : method;
    for (const route of this.routes) {
      const params = matchPath(route.path, path);
      if (params && route.method === wanted) return { route, params };
    }
    const allowed = this.allowed(path);
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed on ${path}.`, { allowed }, { Allow: allowed.join(', ') });
  }
}
