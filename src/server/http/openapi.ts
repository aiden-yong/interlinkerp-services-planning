import { SERVICE_VERSION, type ServiceInfo } from '../config/serviceInfo';
import { ERROR_CODES } from './errors';
import { type Access, type Route, scopeOf } from './router';

const SUCCESS: Record<string, string> = { GET: '200', POST: '201', PATCH: '200', DELETE: '204' };

/**
 * How each access level signs in (backlog item 19): programs send a gateway access token holding the route's scope;
 * people carry Planning's session cookie. Person-only routes refuse tokens, so they list only the cookie.
 */
export function securityFor(access: Access, scope: string | null): Record<string, string[]>[] | null {
  if (access === 'public' || access === 'internal' || !scope) return null;
  if (access === 'manager') return [{ bearerAuth: [scope] }, { cookieAuth: [] }];
  return [{ cookieAuth: [] }];
}

/**
 * Builds /openapi.json from the route table, so the scope a route declares
 * and the scope the guard enforces come from the same place (contract SS-6).
 */
export function buildOpenApi(routes: Route[], info: ServiceInfo, catalog: object): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    if (route.access === 'internal') continue;
    const params = [...route.path.matchAll(/\{([a-z_]+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const scope = scopeOf(route);
    paths[route.path] ??= {};
    paths[route.path][route.method.toLowerCase()] = {
      summary: route.summary,
      operationId: `${route.method.toLowerCase()}${route.path.replace(/[{}]/g, '').replace(/[/.-]/g, '_')}`,
      ...(params.length > 0 ? { parameters: params } : {}),
      responses: {
        [SUCCESS[route.method] ?? '200']: { description: 'Success.' },
        default: { description: 'Error envelope.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
      },
      ...(securityFor(route.access, scope) ? { security: securityFor(route.access, scope) } : {}),
      [info.extensionKey]: route.doc,
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'InterlinkERP Planning',
      version: SERVICE_VERSION,
      description: 'Plan, publish and view employee shifts for the Services department, including roles, working hours, time off and public holidays.',
      [info.extensionKey]: catalog,
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'planning_session', description: 'Set by Planning after signing in through the InterlinkERP gateway.' },
      },
      schemas: {
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'correlation_id', 'details'],
              properties: {
                code: { type: 'string', enum: [...ERROR_CODES] },
                message: { type: 'string' },
                correlation_id: { type: 'string' },
                details: { nullable: true },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
