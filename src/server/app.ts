import { env, requireEnv } from './config/env';
import { type ServiceInfo, serviceInfoFromEnv } from './config/serviceInfo';
import { createDatabase, type Database } from './db/client';
import { catalog } from './http/catalog';
import { HttpError } from './http/errors';
import { type AccessGuard, Kernel, type Logger } from './http/kernel';
import { buildOpenApi } from './http/openapi';
import type { Router } from './http/router';
import { buildRouter } from './routes';
import { type Clock, systemClock } from './support/clock';

/** Checked before any request is served (contract SS-20). Later tasks extend this list. */
export const REQUIRED_ENV = ['SERVICE_ID', 'OPENAPI_EXTENSION_KEY', 'DATABASE_URL'];

/** Everything tests may replace. Production uses `new App()`. */
export interface AppDeps {
  organisationId?: string;
  defaultTimezone?: string;
  clock?: Clock;
  logger?: Logger;
  database?: Database;
  guard?: AccessGuard;
}

/**
 * The only place objects are wired together. Everything is built lazily on
 * first use, so a request only pays for what it touches.
 */
export class App {
  private readonly cache = new Map<string, unknown>();

  constructor(readonly deps: AppDeps = {}) {}

  protected once<T>(key: string, make: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key) as T;
  }

  readonly log: Logger = (line) => (this.deps.logger ?? console.error)(line);

  clock(): Clock {
    return this.deps.clock ?? systemClock;
  }

  organisationId(): string {
    return this.deps.organisationId ?? env('ORGANISATION_ID', 'default')!;
  }

  serviceInfo(): ServiceInfo {
    return this.once('serviceInfo', serviceInfoFromEnv);
  }

  database(): Database {
    return this.deps.database ?? this.once('database', () => createDatabase(requireEnv('DATABASE_URL')));
  }

  guard(): AccessGuard {
    // Replaced in Task 6. Until then nothing but public and internal routes is reachable.
    return this.deps.guard ?? this.once<AccessGuard>('guard', () => ({
      check: async (route) => {
        if (route.access === 'public' || route.access === 'internal') return { principal: null, cookies: [] };
        throw HttpError.unauthorized('Sign in through the InterlinkERP gateway first.');
      },
    }));
  }

  router(): Router {
    return this.once('router', () => buildRouter(this));
  }

  kernel(): Kernel {
    return this.once('kernel', () => new Kernel(this.router(), this.guard(), this.log));
  }

  /** Built once per process, never per request (performance guide §4). */
  openApiJson(): string {
    return this.once('openApiJson', () => JSON.stringify(buildOpenApi(this.router().list(), this.serviceInfo(), catalog)));
  }
}
