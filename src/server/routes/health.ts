import type { App } from '../app';
import { SERVICE_VERSION } from '../config/serviceInfo';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';

export function register(r: Router, app: App): void {
  // Contract SS-2. One trivial database ping and nothing else (performance guide §3).
  r.add('GET', '/health', 'public', 'Report whether the service and its database are reachable.', async () => {
    const database = await app.database().ping();
    return json(200, { status: database ? 'ok' : 'degraded', service: app.serviceInfo().serviceId, version: SERVICE_VERSION, checks: { database } });
  }, op('Check Health', 'Find out whether Planning is up', ['Monitoring whether the service is reachable'], ['Reading schedule data'],
    [], ['status', 'service', 'version', 'checks'], [], ['GET /openapi.json'], ['health', 'status', 'uptime']));

  r.add('GET', '/openapi.json', 'public', 'Describe every endpoint this service offers.', () =>
    new Response(app.openApiJson(), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' } }),
  op('Describe API', 'Read the API description', ['Discovering what Planning can do'], ['Checking whether the service is up'],
    [], ['openapi', 'paths'], [], ['GET /health'], ['openapi', 'docs', 'schema']));
}
