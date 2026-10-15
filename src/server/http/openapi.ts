import { SERVICE_VERSION, type ServiceInfo } from '../config/serviceInfo';
import { type Route, scopeOf } from './router';

const SUCCESS: Record<string, string> = { GET: '200', POST: '201', PATCH: '200', DELETE: '204' };

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
        default: { description: 'Error envelope: {"error":{"code","message","correlation_id","details"}}.' },
      },
      ...(scope ? { security: [{ bearerAuth: [scope] }] } : {}),
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
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths,
  };
}
