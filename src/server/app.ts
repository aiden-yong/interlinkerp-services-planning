import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { DevIdentity } from './auth/devIdentity';
import { Gateway } from './auth/gateway';
import { GatewayAccessGuard } from './auth/guard';
import { SessionCodec } from './auth/session';
import { TokenVerifier } from './auth/tokens';
import { env, requireEnv } from './config/env';
import { type ServiceInfo, serviceInfoFromEnv } from './config/serviceInfo';
import { createDatabase, type Database } from './db/client';
import { catalog } from './http/catalog';
import { type AccessGuard, Kernel, type Logger } from './http/kernel';
import { buildOpenApi } from './http/openapi';
import type { Router } from './http/router';
import { DirectoryRepository } from './repo/directory';
import { ManagerRepository } from './repo/managers';
import { buildRouter } from './routes';
import { ClientCredentials } from './roster/clientCredentials';
import { DepartmentApi } from './roster/departments';
import { InternDatabaseRoster } from './roster/internDatabase';
import { DirectoryRefresher } from './roster/refresher';
import { type DepartmentNames, type Roster, unconfiguredRoster } from './roster/roster';
import { type Clock, systemClock } from './support/clock';
import { FetchHttpClient, type HttpClient } from './support/http';
import { PageGate } from './web/pageGate';

/** Checked before any request is served (contract SS-20). Later tasks extend this list. */
export const REQUIRED_ENV = ['SERVICE_ID', 'OPENAPI_EXTENSION_KEY', 'DATABASE_URL', 'GATEWAY_URL', 'PUBLIC_URL', 'SESSION_SECRET'];

/** Everything tests may replace. Production uses `new App()`. */
export interface AppDeps {
  organisationId?: string;
  defaultTimezone?: string;
  clock?: Clock;
  logger?: Logger;
  database?: Database;
  guard?: AccessGuard;
  http?: HttpClient;
  jwks?: JWTVerifyGetKey;
  devIdentity?: DevIdentity | null;
  roster?: Roster;
  departments?: DepartmentNames;
  cronSecret?: string | null;
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
    return this.deps.guard ?? this.once('guard', () => new GatewayAccessGuard(
      this.sessions(), this.gateway(), this.tokenVerifier(), this.managers(), this.devIdentity(), this.secureCookies(),
    ));
  }

  http(): HttpClient {
    return this.deps.http ?? this.once('http', () => new FetchHttpClient());
  }

  gatewayUrl(): string {
    return requireEnv('GATEWAY_URL').replace(/\/+$/, '');
  }

  publicUrl(): string {
    return requireEnv('PUBLIC_URL').replace(/\/+$/, '');
  }

  secureCookies(): boolean {
    return this.publicUrl().startsWith('https://');
  }

  tokenVerifier(): TokenVerifier {
    return this.once('tokenVerifier', () => new TokenVerifier(
      this.deps.jwks ?? createRemoteJWKSet(new URL(`${this.gatewayUrl()}/.well-known/jwks.json`)),
      this.gatewayUrl(),
      this.serviceInfo().serviceId,
    ));
  }

  gateway(): Gateway {
    return this.once('gateway', () => new Gateway(this.http(), this.gatewayUrl(), this.publicUrl()));
  }

  sessions(): SessionCodec {
    return this.once('sessions', () => new SessionCodec(requireEnv('SESSION_SECRET'), this.clock()));
  }

  devIdentity(): DevIdentity | null {
    return this.deps.devIdentity !== undefined ? this.deps.devIdentity : this.once('devIdentity', () => DevIdentity.fromEnv());
  }

  managers(): ManagerRepository {
    return this.once('managers', () => new ManagerRepository(this.database().db, this.organisationId()));
  }

  cronSecret(): string | null {
    return this.deps.cronSecret !== undefined ? this.deps.cronSecret : env('CRON_SECRET') ?? null;
  }

  credentials(): ClientCredentials | null {
    return this.once('credentials', () => {
      const id = env('INTERLINK_CLIENT_ID');
      const secret = env('INTERLINK_CLIENT_SECRET');
      return id && secret ? new ClientCredentials(this.http(), this.gatewayUrl(), id, secret, this.clock()) : null;
    });
  }

  roster(): Roster {
    return this.deps.roster ?? this.once('roster', () => {
      const credentials = this.credentials();
      const url = env('INTERN_DATABASE_URL');
      return credentials && url ? new InternDatabaseRoster(this.http(), credentials, url, this.log) : unconfiguredRoster;
    });
  }

  departments(): DepartmentNames {
    return this.deps.departments ?? this.once('departments', () => {
      const credentials = this.credentials();
      const url = env('DEPARTMENT_API_URL');
      return credentials && url ? new DepartmentApi(this.http(), credentials, url) : unconfiguredRoster;
    });
  }

  directory(): DirectoryRepository {
    return this.once('directory', () => new DirectoryRepository(this.database().db, this.organisationId()));
  }

  directoryRefresher(): DirectoryRefresher {
    return this.once('directoryRefresher', () => new DirectoryRefresher(this.roster(), this.departments(), this.directory(), this.clock(), this.log));
  }

  pageGate(): PageGate {
    return this.once('pageGate', () => new PageGate(
      this.gateway(), this.tokenVerifier(), this.sessions(), this.roster(), this.devIdentity(), this.publicUrl(), this.log,
    ));
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
