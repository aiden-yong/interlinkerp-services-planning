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
import { HolidayProvider, nullHolidayProvider } from './holidays/provider';
import { HolidayRepository } from './repo/holidays';
import { DirectoryRepository } from './repo/directory';
import { type BadgePublisher, GatewayBadgePublisher, noBadges } from './notifications/badges';
import { DeliveryService } from './notifications/deliveryService';
import { DeliveryTrigger } from './notifications/trigger';
import { LogMailer, type Mailer, SmtpMailer } from './notifications/mailer';
import { ManagerRepository } from './repo/managers';
import { NotificationRepository } from './repo/notifications';
import { Outbox } from './repo/outbox';
import { ProfileRepository } from './repo/profiles';
import { RoleRepository } from './repo/roles';
import { SettingsRepository } from './repo/settings';
import { ShiftRepository } from './repo/shifts';
import { TimeOffRepository } from './repo/timeOff';
import { buildRouter } from './routes';
import { ConflictContext } from './scheduling/conflictContext';
import { Eligibility } from './scheduling/eligibility';
import { OpenShiftService } from './scheduling/openShiftService';
import { PublishService } from './scheduling/publishService';
import { ScheduleService } from './scheduling/scheduleService';
import { ShiftService } from './scheduling/shiftService';
import { UnitOfWork } from './scheduling/unitOfWork';
import { ClientCredentials } from './roster/clientCredentials';
import { DepartmentApi } from './roster/departments';
import { InternDatabaseRoster } from './roster/internDatabase';
import { DirectoryRefresher } from './roster/refresher';
import { type DepartmentNames, type Roster, unconfiguredRoster } from './roster/roster';
import { type Clock, systemClock } from './support/clock';
import { FetchHttpClient, type HttpClient } from './support/http';
import { isTimezone } from './support/time';
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
  holidayProvider?: HolidayProvider;
  publicUrl?: string;
  mailer?: Mailer;
  badges?: BadgePublisher;
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
      this.sessions(), this.gateway(), this.tokenVerifier(), this.managers(), this.devIdentity(), this.secureCookies(), this.roster(), this.clock(),
    ));
  }

  http(): HttpClient {
    return this.deps.http ?? this.once('http', () => new FetchHttpClient());
  }

  gatewayUrl(): string {
    return requireEnv('GATEWAY_URL').replace(/\/+$/, '');
  }

  publicUrl(): string {
    return (this.deps.publicUrl ?? requireEnv('PUBLIC_URL')).replace(/\/+$/, '');
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

  defaultTimezone(): string {
    const zone = this.deps.defaultTimezone ?? env('DEFAULT_TIMEZONE', 'UTC')!;
    return isTimezone(zone) ? zone : 'UTC';
  }

  settings(): SettingsRepository {
    return this.once('settings', () => new SettingsRepository(this.database().db, this.organisationId(), this.defaultTimezone()));
  }

  roles(): RoleRepository {
    return this.once('roles', () => new RoleRepository(this.database().db, this.organisationId()));
  }

  profiles(): ProfileRepository {
    return this.once('profiles', () => new ProfileRepository(this.database().db, this.organisationId()));
  }

  timeOff(): TimeOffRepository {
    return this.once('timeOff', () => new TimeOffRepository(this.database().db, this.organisationId()));
  }

  holidays(): HolidayRepository {
    return this.once('holidays', () => new HolidayRepository(this.database().db, this.organisationId()));
  }

  shifts(): ShiftRepository {
    return this.once('shifts', () => new ShiftRepository(this.database().db, this.organisationId()));
  }

  outbox(): Outbox {
    return this.once('outbox', () => new Outbox(this.database().db, this.organisationId()));
  }

  notifications(): NotificationRepository {
    return this.once('notifications', () => new NotificationRepository(this.database().db, this.organisationId()));
  }

  mailer(): Mailer {
    return this.deps.mailer ?? this.once('mailer', () => {
      const url = env('SMTP_URL');
      const from = env('MAIL_FROM');
      return url && from ? new SmtpMailer(url, from) : new LogMailer(this.log);
    });
  }

  badges(): BadgePublisher {
    return this.deps.badges ?? this.once('badges', () => {
      const id = env('INTERLINK_CLIENT_ID');
      const secret = env('INTERLINK_CLIENT_SECRET');
      return env('GATEWAY_BADGES') === 'on' && id && secret
        ? new GatewayBadgePublisher(this.http(), this.gatewayUrl(), this.serviceInfo().serviceId, id, secret, this.log)
        : noBadges;
    });
  }

  delivery(): DeliveryService {
    return this.once('delivery', () => new DeliveryService({
      db: this.database().db, org: this.organisationId(), directory: this.directory(), profiles: this.profiles(),
      managers: this.managers(), settings: this.settings(), clock: this.clock(), log: this.log, publicUrl: () => this.publicUrl(),
      mailer: this.mailer(), badges: this.badges(), inbox: this.notifications(),
    }));
  }

  deliveryTrigger(): DeliveryTrigger {
    return this.once('deliveryTrigger', () => new DeliveryTrigger(this.delivery(), this.clock(), this.log));
  }

  conflictContext(): ConflictContext {
    return this.once('conflictContext', () => new ConflictContext(this.shifts(), this.profiles(), this.timeOff(), this.holidays(), this.settings()));
  }

  /** Pool-backed: for reads outside a transaction. Writes use `scope.eligibility`. */
  eligibility(): Eligibility {
    return this.once('eligibility', () => new Eligibility(this.shifts(), this.profiles(), this.timeOff(), this.conflictContext()));
  }

  openShifts(): OpenShiftService {
    return this.once('openShifts', () => new OpenShiftService(
      this.shifts(), this.profiles(), this.roles(), this.directory(), this.settings(), this.eligibility(), this.unitOfWork(), this.clock(),
    ));
  }

  unitOfWork(): UnitOfWork {
    return this.once('unitOfWork', () => new UnitOfWork(this.database().db, this.organisationId(), this.defaultTimezone()));
  }

  shiftService(): ShiftService {
    return this.once('shiftService', () => new ShiftService(
      this.shifts(), this.profiles(), this.roles(), this.directory(), this.conflictContext(), this.outbox(), this.settings(), this.clock(), this.unitOfWork(),
    ));
  }

  publishService(): PublishService {
    return this.once('publishService', () => new PublishService(this.unitOfWork(), this.clock(), this.directory()));
  }

  scheduleService(): ScheduleService {
    return this.once('scheduleService', () => new ScheduleService(
      this.shifts(), this.profiles(), this.roles(), this.directory(), this.directoryRefresher(), this.timeOff(), this.holidays(), this.settings(), this.clock(),
    ));
  }

  holidayProvider(): HolidayProvider {
    return this.deps.holidayProvider ?? nullHolidayProvider;
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
      this.gateway(), this.tokenVerifier(), this.sessions(), this.roster(), this.devIdentity(), this.publicUrl(), this.log, this.clock(),
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
