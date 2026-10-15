import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../app';
import { catalog } from './catalog';
import { buildOpenApi } from './openapi';
import { type Route, scopeOf } from './router';

/**
 * Enforces contract SS-3, SS-6, SS-7, SS-23 and SS-27 on the real route table.
 * Every later task that adds a route must keep this file passing.
 */
const OPERATION_KEYS = ['name', 'purpose', 'use_when', 'do_not_use_when', 'inputs', 'outputs', 'requires', 'related_endpoints', 'tags'];
const SERVICE_KEYS = ['domain', 'owner', 'app_url', 'category', 'industries', 'use_cases', 'capabilities', 'workflows', 'related_services'];
const CAPABILITY_KEYS = ['name', 'icon', 'description', 'does', 'best_for', 'endpoints'];
const INDUSTRIES = ['Main Database', 'Human Resources', 'Marketing', 'Sales', 'Finance', 'IT', 'Operations', 'Legal', 'Support'];

type Doc = { openapi: string; info: Record<string, any>; paths: Record<string, Record<string, any>> };
let doc: Doc;
let routes: Route[];

beforeAll(() => {
  routes = new App().router().list();
  doc = buildOpenApi(routes, { serviceId: 'planning-api', extensionKey: 'x-test' }, catalog) as Doc;
});

describe('openapi.json', () => {
  it('has the basics', () => {
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.description).toBeTruthy();
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });

  it('declares complete service metadata', () => {
    const meta = doc.info['x-test'];
    for (const key of SERVICE_KEYS) expect(meta, key).toHaveProperty(key);
    for (const key of ['industries', 'use_cases', 'capabilities', 'workflows']) expect(meta[key].length, key).toBeGreaterThan(0);
    for (const industry of meta.industries) expect(INDUSTRIES).toContain(industry);
    for (const capability of meta.capabilities) {
      for (const key of CAPABILITY_KEYS) expect(capability, `${capability.name}.${key}`).toHaveProperty(key);
      expect(capability.does.length).toBeGreaterThan(0);
      expect(capability.endpoints.length).toBeGreaterThan(0);
    }
  });

  it('gives every operation a summary and discovery metadata', () => {
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(operation.summary, `${method} ${path}`).toBeTruthy();
        for (const key of OPERATION_KEYS) expect(operation['x-test'], `${method} ${path} ${key}`).toHaveProperty(key);
        expect(operation['x-test'].use_when.length, `${method} ${path} use_when`).toBeGreaterThan(0);
        expect(operation['x-test'].tags.length, `${method} ${path} tags`).toBeGreaterThan(0);
      }
    }
  });

  it('declares the enforced scope on every protected operation and hides internal routes', () => {
    for (const route of routes) {
      if (route.access === 'internal') {
        expect(doc.paths[route.path]).toBeUndefined();
        continue;
      }
      const operation = doc.paths[route.path][route.method.toLowerCase()];
      if (route.access === 'public') expect(operation.security).toBeUndefined();
      else expect(operation.security).toEqual([{ bearerAuth: [scopeOf(route)] }]);
    }
  });

  it('keeps the catalogue and the routes in agreement', () => {
    const documented = Object.entries(doc.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`));
    const inCapabilities = catalog.capabilities.flatMap((c) => c.endpoints);
    for (const endpoint of inCapabilities) expect(documented).toContain(endpoint);
    for (const route of routes) {
      if (route.access !== 'public' && route.access !== 'internal') expect(inCapabilities).toContain(`${route.method} ${route.path}`);
    }
  });
});
