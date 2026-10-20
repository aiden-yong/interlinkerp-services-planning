import { beforeEach, expect } from 'vitest';
import { App } from '../app';
import type { Principal } from '../auth/principal';
import type { Database } from '../db/client';
import { employeeDirectory } from '../db/schema';
import { HttpError } from '../http/errors';
import type { AccessGuard } from '../http/kernel';
import { ORG, useTestDatabase } from './db';
import { FakeBadges, FakeDepartments, FakeHolidayProvider, FakeMailer, FakeRoster, FixedClock } from './fakes';

export interface Harness {
  app: App;
  database: Database;
  clock: FixedClock;
  roster: FakeRoster;
  departments: FakeDepartments;
  holidays: FakeHolidayProvider;
  mailer: FakeMailer;
  badges: FakeBadges;
  asManager(email?: string): void;
  asEmployee(ref: string | null, email?: string, isManager?: boolean): void;
  asNobody(): void;
  call(method: string, path: string, body?: unknown, query?: Record<string, string | number>): Promise<{ status: number; body: any }>;
  callAs(ref: string, email: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  addEmployee(ref: string, name: string, departmentId?: string | null, departmentName?: string | null, email?: string | null): Promise<void>;
  addRole(name: string, color?: string): Promise<string>;
}

const person = (email: string, isManager: boolean, employeeRef: string | null): Principal =>
  ({ kind: 'person', subject: `sub-${email}`, email, name: isManager ? 'Mona Manager' : 'Ana Lim', gatewayRole: 'user', employeeRef, isManager, scopes: [] });

/**
 * Drives the real kernel, routes, repositories and PostgreSQL, with fakes for
 * everything outside Planning. Call at the top of an *.int.test.ts file.
 */
export function useApiHarness(): Harness {
  const database = useTestDatabase();
  let principal: Principal | null = null;
  const guard: AccessGuard = {
    async check(route, request) {
      const override = request.headers.get('x-test-principal');
      const who = override ? (JSON.parse(override) as Principal) : principal;
      if (route.access === 'public' || route.access === 'internal') return { principal: null, cookies: [] };
      if (!who) throw HttpError.unauthorized('Not signed in.');
      if ((route.access === 'manager' || route.access === 'person-manager') && !who.isManager) throw HttpError.forbidden('Only Planning Managers can do this.');
      return { principal: who, cookies: [] };
    },
  };

  const h = {
    database,
    asManager: (email = 'mona@example.com') => {
      principal = person(email, true, null);
    },
    asEmployee: (ref: string | null, email = 'ana@example.com', isManager = false) => {
      principal = person(email, isManager, ref);
    },
    asNobody: () => {
      principal = null;
    },
    async call(method: string, path: string, body?: unknown, query: Record<string, string | number> = {}) {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const response = await h.app.kernel().handle(new Request(`http://localhost${path}${qs ? `?${qs}` : ''}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }));
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    /** Calls as an employee without changing the default principal, so two people can act at the same moment. */
    async callAs(ref: string, email: string, method: string, path: string, body?: unknown) {
      const response = await h.app.kernel().handle(new Request(`http://localhost${path}`, {
        method,
        headers: { 'x-test-principal': JSON.stringify(person(email, false, ref)), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }));
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async addEmployee(ref: string, name: string, departmentId: string | null = null, departmentName: string | null = null, email: string | null = null) {
      await database.db.insert(employeeDirectory).values({ organisationId: ORG, employeeRef: ref, displayName: name, departmentId, departmentName, status: 'Active', email, fetchedAt: h.clock.now() });
    },
    async addRole(name: string, color = '#3B82F6') {
      const { status, body } = await h.call('POST', '/api/roles', { name, color });
      expect(status, JSON.stringify(body)).toBe(201);
      return body.role.id as string;
    },
  } as Harness;

  beforeEach(() => {
    h.clock = FixedClock.at('2026-10-13T02:00:00Z');
    h.roster = new FakeRoster();
    h.departments = new FakeDepartments();
    h.holidays = new FakeHolidayProvider();
    h.mailer = new FakeMailer();
    h.badges = new FakeBadges();
    h.app = new App({
      database, organisationId: ORG, defaultTimezone: 'Asia/Kuala_Lumpur', clock: h.clock, guard, devIdentity: null,
      roster: h.roster, departments: h.departments, holidayProvider: h.holidays, logger: () => {}, publicUrl: 'https://planning.test',
      mailer: h.mailer, badges: h.badges, rateLimit: null,
    });
    h.asManager();
  });

  return h;
}
