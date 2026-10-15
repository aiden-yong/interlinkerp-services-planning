# Planning M1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first deployable version of InterlinkERP Planning. It covers:
- Gateway sign-in, and manager or employee access.
- Roles, employee planning profiles, time off and holidays.
- A shift schedule with conflict warnings.
- Publishing, and an employee "My Planning" view.

**Architecture:** One Next.js 16 App Router application on Vercel. It is split into a server half and a client half.
- **The JSON API.** It runs in Next.js route handlers, which send every request to one framework-free `Kernel` in `src/server`. The kernel owns:
  - routing, plus the contract's 404/405 error envelopes
  - the gateway access guard
  - correlation ids
  - the route table, which `/openapi.json` is generated from
- **Pages.** `src/proxy.ts`, which replaced `middleware.ts` in Next.js 16 and runs on Node.js, guards every page with the gateway sign-in flow. It answers anything else with the JSON 404 envelope.
- **Business rules.** Allocation and conflicts live in pure TypeScript modules with no database and no HTTP. They use Luxon for time-zone maths.
- **Data.** PostgreSQL through Drizzle, with SQL migrations committed to the repo. Employee names and photos come from intern-database through the gateway and are cached for at most 24 hours.
- **The UI.** React client components that call the JSON API.

**Tech Stack:**
- Node.js 22+ (local: 24), Next.js 16, React 19, TypeScript (strict)
- Drizzle ORM with `drizzle-kit`, `pg` (node-postgres), PostgreSQL 18 locally and Neon in production
- jose (JWT/JWKS), Luxon
- Vitest 3 with jsdom and React Testing Library
- Vercel, region `sin1`

**Spec:** [ListOfRequirements.md](../../../ListOfRequirements.md) (v0.2). Roadmap: [2026-10-13-planning-roadmap.md](2026-10-13-planning-roadmap.md).

**Reference material:** the sibling repo `../hr-recruitment-demo` already talks to the same gateway.
- Its `API_Template/*.md` files are the service contract. This plan cites them as "contract SS-n", "auth guide §n" and "performance guide §n". The auth guide's examples are already JavaScript; read the sections a task points at.
- Its `backend/services/RosterService.php` shows the roster lookup Task 7 reimplements.
- Copy nothing else from that repo.

## Global Constraints

- **Naming:** the ERP is **InterlinkERP**. The repo must never contain the ERP's former brand name anywhere: code, comments, docs, identifiers, cookie names or environment variable names. The gateway reads catalogue metadata from an OpenAPI extension key whose name contains that former brand. Planning reads the key name from `OPENAPI_EXTENSION_KEY` and never spells it in source.
- **Commits:** conventional types (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). No Claude attribution lines (no `Co-Authored-By`, no "Generated with Claude Code"). Work on branch `feature/m1-foundation`.
- **Code layout:**
  - `src/server/**` must never import React or anything from `src/client/**`.
  - `src/client/**` must never import `src/server/**`. It talks to the server only over HTTP.
  - Shared shapes are written once in `src/client/types.ts`, as the API's JSON contract.
  - TypeScript `strict` everywhere.
- **Database:**
  - PostgreSQL. Every instant is a `timestamptz` and is handled in code as a JS `Date` or epoch milliseconds.
  - Calendar dates are `date` columns read as `YYYY-MM-DD` strings.
  - Every table has `organisation_id`, and every query filters on it (DR-05, NFR-10).
  - Schema changes go through `npm run db:generate`. The generated SQL in `drizzle/` is committed and never edited after it has been applied anywhere.
- **API shape (contract SS-4, SS-5, SS-9–12):**
  - JSON only. Every response carries `X-Correlation-ID`, reused from the request when it is safe and minted otherwise.
  - Every non-2xx body is exactly `{"error":{"code","message","correlation_id","details"}}`.
  - Reserved codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `RESOURCE_NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405, `CONFLICT` 409, `VALIDATION_ERROR` 422, `INTERNAL_ERROR` 500.
  - POST → 201, GET/PATCH → 200, DELETE → 204 with an empty body. `DELETE` on a missing id is 404.
  - Plural nouns, no verbs in paths.
  - Error messages never contain SQL, stack traces, file paths or secrets.
- **Times on the wire:**
  - Instants in responses are ISO 8601 UTC strings: `YYYY-MM-DDTHH:MM:SSZ`.
  - Instant inputs must carry an explicit offset (`Z` or `+08:00`). Inputs without one are rejected with 422.
  - Calendar dates are `YYYY-MM-DD`.
  - Shifts are stored to the minute.
- **Auth (contract SS-6, SS-8, SS-24, SS-25; auth guide §3–§8):**
  - Public paths are only `/health` and `/openapi.json`.
  - No login screen, no logout button, no password storage.
  - Identity comes only from a verified gateway token signature.
  - The gateway session is checked on every authenticated request with no cache. It fails open only on network or server errors.
  - The session cookie is HMAC-signed, `HttpOnly`, `SameSite=Lax`, with a 15-minute TTL.
  - Every page response and auth redirect sends `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`.
  - `GATEWAY_URL` and `PUBLIC_URL` come from the environment, never from the request.
- **Who is a manager (BR-12):** gateway `role` = `admin`, or the person's gateway-verified email is in `planning_managers`. A missing or unknown role never grants manager access. Task 6 amends the spec to say "email" instead of `sub`.
- **Service identity:** `/health` returns `service` from `SERVICE_ID` (use `planning-api`) and `version` from `SERVICE_VERSION` in `src/server/config/serviceInfo.ts` (`0.1.0`). Bump it in the same commit as any API change (NFR-09): patch for fixes, minor for additions, major for breaking changes.
- **Environment variables:**
  - **App:** `APP_ENV`, `SERVICE_ID`, `OPENAPI_EXTENSION_KEY`, `ORGANISATION_ID` (default `default`), `DEFAULT_TIMEZONE` (default `UTC`)
  - **Database and gateway:** `DATABASE_URL`, `GATEWAY_URL`, `PUBLIC_URL`, `SESSION_SECRET` (≥ 32 characters)
  - **Other services:** `INTERLINK_CLIENT_ID`, `INTERLINK_CLIENT_SECRET`, `INTERN_DATABASE_URL`, `DEPARTMENT_API_URL`, `CRON_SECRET`
  - **Tests only:** `TEST_DATABASE_URL`
  - **Local development only:** `DEV_USER_EMAIL`, `DEV_USER_NAME`, `DEV_USER_ROLE`, `DEV_EMPLOYEE_REF`
  - Local values live in `.env.local`, which is git-ignored. `.env.example` documents every variable.
- **Decisions this plan makes that the spec leaves open (all OWN):**
  - A shift lasts at most 7 days.
  - The server keeps a deleted shift restorable for 30 seconds (the UI offers undo for 10).
  - Duplicating places the copy one day later unless a start time is given.
  - The schedule and My Planning accept ranges of at most 62 days.
  - Plannable roster statuses are `Onboarding`, `Active` and `Offboarding`.
  - The employee directory cache is refreshed daily by cron, and immediately when empty (with a 5-minute back-off after a failure).
  - Shift edits use optimistic concurrency through a `version` field.
- **Local ports:** Next.js dev server on `127.0.0.1:3000`, bound to loopback only. PostgreSQL on `localhost:5432`.

## Review Focus

These are the five things a real user is most likely to hit that the spec's acceptance criteria do not spell out. Each has a test in the task in brackets.

1. **Two managers edit the same shift at once.** The second save must be refused with `409 STALE_SHIFT`, not silently overwrite the first [Task 15].
2. **The roster or department service is down while the schedule loads.** The schedule still loads from Planning's own data with placeholders. It never fails or hangs (NFR-06) [Task 17].
3. **An employee leaves the roster but still has shifts.** Their shifts stay visible under an "Unknown employee" row and don't disappear [Task 17].
4. **Bad time input:** a time without an offset, 30 February, an end before the start, or a break as long as the shift. Each must give 422 with the field named, never 500 [Task 15].
5. **The session or gateway session ends while a page is open.** The next API call returns 401, and the UI reloads into the sign-in flow instead of showing broken screens [Task 19].

---

## File Structure

```
package.json  tsconfig.json  next.config.ts  vitest.config.ts  drizzle.config.ts  vercel.json
.env.example  .gitignore
drizzle/                          Generated SQL migrations (committed)
scripts/
  migrate.ts                      Applies drizzle/ to DATABASE_URL
  seed-demo.ts                    50 employees + 300 shifts for NFR-01 timing
  time-schedule.sh                Timing script for /health and /api/schedule
src/
  proxy.ts                        Next.js 16 proxy: page sign-in gate + JSON 404 for unknown paths
  app/                            Next.js App Router (thin: no logic lives here)
    layout.tsx  globals.css  page.tsx
    schedule/page.tsx  my/page.tsx  settings/[[...tab]]/page.tsx  not-on-roster/page.tsx
    health/route.ts  openapi.json/route.ts  api/[...path]/route.ts  internal/[...path]/route.ts
  server/                         Everything that runs on the server; never imports React
    app.ts                        App: builds and caches every service; tests inject fakes
    entry.ts                      handleApi(): env check + kernel; getApp() singleton
    config/   env.ts  serviceInfo.ts
    support/  clock.ts  time.ts  http.ts  requestContext.ts
    http/     errors.ts  responses.ts  router.ts  kernel.ts  input.ts  doc.ts  openapi.ts  catalog.ts
    auth/     principal.ts  tokens.ts  gateway.ts  session.ts  guard.ts  devIdentity.ts
    db/       schema.ts  client.ts
    roster/   roster.ts  internDatabase.ts  departments.ts  clientCredentials.ts  refresher.ts
    holidays/ provider.ts
    domain/   interval.ts  workingHours.ts  localDays.ts  allocation.ts  conflicts.ts   (pure)
    repo/     roles.ts  settings.ts  profiles.ts  directory.ts  timeOff.ts  holidays.ts
              managers.ts  shifts.ts  outbox.ts
    scheduling/ conflictContext.ts  shiftService.ts  scheduleService.ts  publishService.ts
    routes/   index.ts  health.ts  me.ts  roles.ts  settings.ts  employees.ts  timeOff.ts
              holidays.ts  managers.ts  shifts.ts  schedule.ts  publications.ts  myShifts.ts  cron.ts
    web/      pageGate.ts
    test/     db.ts  globalSetup.ts  fakes.ts  tokens.ts  harness.ts
  client/                         React UI; never imports src/server
    api.ts  types.ts  router.ts  AppShell.tsx  feedback.tsx
    schedule/ period.ts  tz.ts  layout.ts  rows.ts  drag.ts  shiftForm.ts
              SchedulePage.tsx  Board.tsx  ShiftDialog.tsx  testData.ts
    my/       days.ts  MyPlanningPage.tsx
    settings/ workingHoursInput.ts  SettingsPage.tsx  GeneralTab.tsx  RolesTab.tsx
              EmployeesTab.tsx  TimeOffTab.tsx  HolidaysTab.tsx  ManagersTab.tsx
Tests sit beside the code: *.test.ts(x) are unit/client tests, *.int.test.ts hit PostgreSQL.
```

**Boundaries.**
- `domain/` knows nothing about storage or HTTP. BR-01 and BR-04 live there.
- `repo/` is the only code that touches Drizzle.
- `scheduling/` combines repos and domain rules into use cases.
- `routes/*.ts` parse input, call one service or repo, and shape the JSON.
- `App` is the only place objects are wired together. Tests replace pieces through its constructor.

---
### Task 1: Project scaffold, configuration and local databases

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/server/config/env.ts`
- Test: `src/server/config/env.test.ts`

**Interfaces:**
- Produces:
  - `class ConfigError extends Error`
  - `env(key, fallback?): string | undefined` (an empty value counts as missing)
  - `requireEnv(key): string`
  - `requireAll(keys): void`
  - `loadLocalEnv(): void` (loads `.env.local` for scripts and never overrides a real variable)
- npm scripts: `dev`, `build`, `start`, `typecheck`, `test`, `test:unit`, `test:integration`, `db:generate`, `db:migrate`, `db:seed-demo`.

- [ ] **Step 1: Create the branch and the local databases**

Start from an up-to-date `main` that contains this plan:

```bash
git checkout main && git pull && git checkout -b feature/m1-foundation
```

PostgreSQL 18 is already installed and running on this machine. If the `planning` role and databases don't exist yet, create them. This asks for the `postgres` superuser password chosen at install time:

```bash
psql -U postgres -h localhost -c "CREATE ROLE planning LOGIN PASSWORD 'planning-dev-only';" -c "CREATE DATABASE planning OWNER planning;" -c "CREATE DATABASE planning_test OWNER planning;"
psql "postgres://planning:planning-dev-only@localhost:5432/planning_test" -c "select version();"
```

Expected: the second command prints `PostgreSQL 18.x`. The databases also show up in pgAdmin 4 under *Servers → PostgreSQL 18 → Databases*.

- [ ] **Step 2: Install dependencies**

```bash
npm init -y
npm install next@16 react@19 react-dom@19 drizzle-orm pg jose luxon
npm install -D typescript @types/node @types/react @types/react-dom @types/pg @types/luxon drizzle-kit tsx vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom
```

This plan was written against drizzle-orm 0.44 and drizzle-kit 0.31. If npm installs a 1.x release, read Drizzle's upgrade notes before Task 3; the APIs used here are the stable core.

Then set these fields in `package.json` and keep the dependency blocks npm wrote:

```json
{
  "name": "interlinkerp-planning",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run --project unit --project client",
    "test:integration": "vitest run --project integration",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts",
    "db:seed-demo": "tsx scripts/seed-demo.ts"
  }
}
```

- [ ] **Step 3: Add the configuration files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2023"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next dev` may adjust `jsx` and add entries the first time it runs. Keep its changes.

`next.config.ts`:

```ts
import type { NextConfig } from 'next';

// Auth guide §7: authenticated pages must never be served from the browser cache.
const noStore = [
  { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
  { key: 'Pragma', value: 'no-cache' },
  { key: 'Expires', value: '0' },
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  async headers() {
    return ['/', '/schedule', '/my', '/settings', '/settings/:path*', '/not-on-roster'].map((source) => ({ source, headers: noStore }));
  },
};

export default config;
```

`vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', environment: 'node', include: ['src/server/**/*.test.ts'], exclude: ['src/server/**/*.int.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/server/**/*.int.test.ts'],
          fileParallelism: false, // one shared test database
          globalSetup: ['src/server/test/globalSetup.ts'],
          testTimeout: 15_000,
        },
      },
      { extends: true, test: { name: 'client', environment: 'jsdom', include: ['src/client/**/*.test.{ts,tsx}'] } },
    ],
  },
});
```

`.gitignore`:

```
node_modules/
.next/
out/
.env.local
.env*.local
*.tsbuildinfo
next-env.d.ts
.vercel
```

`.env.example`:

```
# Copy to .env.local for local development. Real deployments set these in
# Vercel; .env.local never overrides a real environment variable.
APP_ENV=development
SERVICE_ID=planning-api
# The OpenAPI extension key the InterlinkERP gateway reads catalogue metadata
# from. Ask the gateway admins for the exact value; any x-... value works locally.
OPENAPI_EXTENSION_KEY=x-local
ORGANISATION_ID=default
DEFAULT_TIMEZONE=Asia/Kuala_Lumpur

DATABASE_URL=postgres://planning:planning-dev-only@localhost:5432/planning
TEST_DATABASE_URL=postgres://planning:planning-dev-only@localhost:5432/planning_test

GATEWAY_URL=https://web-omega-two-47.vercel.app
PUBLIC_URL=http://127.0.0.1:3000
# At least 32 random characters: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=

# API client issued in the gateway console (Access & roles -> API clients),
# granted intern:read and department:read.
INTERLINK_CLIENT_ID=
INTERLINK_CLIENT_SECRET=
INTERN_DATABASE_URL=https://intern-database.vercel.app
DEPARTMENT_API_URL=https://department-zeta.vercel.app

# Vercel sends "Authorization: Bearer $CRON_SECRET" to cron paths.
CRON_SECRET=

# Local development identity. Used only by `npm run dev` (NODE_ENV=development)
# with APP_ENV=development, never on Vercel, never through a proxy.
DEV_USER_EMAIL=dev@example.com
DEV_USER_NAME=Local Developer
DEV_USER_ROLE=admin
DEV_EMPLOYEE_REF=
```

Then copy it for local use and fill in `SESSION_SECRET`:

```bash
cp .env.example .env.local
```

Minimal app files, so `next build` works from the start. Task 19 replaces `page.tsx` and `globals.css`.

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Planning · InterlinkERP' };
// Every page is per-user and must not be cached (auth guide §7).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:

```tsx
export default function Home() {
  return <main>Planning</main>;
}
```

`src/app/globals.css`:

```css
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
```

- [ ] **Step 4: Write the failing test**

`src/server/config/env.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { env, requireAll, requireEnv } from './env';

afterEach(() => {
  delete process.env.PLANNING_TEST_A;
  delete process.env.PLANNING_TEST_B;
});

describe('env', () => {
  it('names the missing variable', () => {
    expect(() => requireEnv('PLANNING_TEST_A')).toThrow('Missing required environment variable PLANNING_TEST_A.');
  });

  it('lists every missing variable', () => {
    process.env.PLANNING_TEST_A = 'x';
    expect(() => requireAll(['PLANNING_TEST_A', 'PLANNING_TEST_B'])).toThrow('Missing required environment variables: PLANNING_TEST_B.');
  });

  it('treats an empty value as missing', () => {
    process.env.PLANNING_TEST_A = '';
    expect(env('PLANNING_TEST_A')).toBeUndefined();
    expect(env('PLANNING_TEST_A', 'fallback')).toBe('fallback');
  });
});
```

Run: `npx vitest run --project unit`
Expected: FAIL with `Cannot find module './env'`.

- [ ] **Step 5: Implement it**

`src/server/config/env.ts`:

```ts
/** A required setting is missing or invalid. Raised before any request is served (contract SS-20). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function env(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

export function requireEnv(key: string): string {
  const value = env(key);
  if (value === undefined) throw new ConfigError(`Missing required environment variable ${key}.`);
  return value;
}

export function requireAll(keys: string[]): void {
  const missing = keys.filter((key) => env(key) === undefined);
  if (missing.length > 0) throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}.`);
}

/** For scripts run outside Next.js. Never overrides a variable that is already set. */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local: rely on the real environment.
  }
}
```

- [ ] **Step 6: Run the tests, the type check and a build**

```bash
npx vitest run --project unit && npm run typecheck && npm run build
```

Expected: 3 tests pass, no type errors, and the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js, Vitest and environment configuration"
```

---

### Task 2: HTTP kernel, routing and the error envelope

**Files:**
- Create: `src/server/http/errors.ts`, `responses.ts`, `doc.ts`, `router.ts`, `kernel.ts`
- Create: `src/server/support/requestContext.ts`, `src/server/auth/principal.ts`
- Test: `src/server/http/router.test.ts`, `src/server/http/kernel.test.ts`

**Interfaces:**
- Produces:
  - `class HttpError extends Error { status; code; details; headers }` with static helpers: `unauthorized(msg)`, `forbidden(msg, code = 'FORBIDDEN', details = null)`, `notFound(msg)`, `conflict(code, msg, details = null)`, `validation(fields)`.
  - `json(status, body, headers = {}): Response`, `noContent(): Response`, `envelope(code, message, correlationId, details)`.
  - `interface OperationDoc` (the contract SS-27 fields).
  - `type Access = 'public' | 'internal' | 'person' | 'manager'`.
  - `interface HandlerContext { request; url; params; query; principal; body(): Promise<Record<string, unknown>> }`.
  - `type Handler = (ctx) => Promise<Response> | Response`.
  - `interface Route { method; path; access; summary; handler; doc }` and `scopeOf(route): string | null`.
  - `class Router { add(method, path, access, summary, handler, doc?); list(); match(method, path): { route, params } }`.
  - `interface AccessGuard { check(route, request): Promise<AccessResult> }`, where `AccessResult = { principal: Principal | null; cookies: string[] }`.
  - `type Logger = (line: string) => void`.
  - `class Kernel(router, guard, log)` with `.handle(request): Promise<Response>`, and `correlationIdFor(request)`.
  - `interface Principal { kind; subject; email; name; gatewayRole; employeeRef; isManager; scopes }` and `actorId(principal)`.
  - `requestContext` and `currentCorrelationId()`.

- [ ] **Step 1: Write the failing tests**

`src/server/http/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { noContent } from './responses';
import { Router, scopeOf } from './router';

function router(): Router {
  const r = new Router();
  const ok = () => noContent();
  r.add('GET', '/api/shifts', 'manager', 'List', ok);
  r.add('GET', '/api/shifts/{id}', 'manager', 'Show', ok);
  r.add('PATCH', '/api/shifts/{id}', 'manager', 'Update', ok);
  r.add('DELETE', '/api/managers/{email}', 'manager', 'Revoke', ok);
  return r;
}

function caught(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (e) {
    return e as HttpError;
  }
  throw new Error('expected an HttpError');
}

describe('Router', () => {
  it('matches path parameters and decodes them', () => {
    expect(router().match('PATCH', '/api/shifts/abc').params).toEqual({ id: 'abc' });
    expect(router().match('DELETE', '/api/managers/bo%40example.com').params).toEqual({ email: 'bo@example.com' });
  });

  it('answers unknown paths with 404', () => {
    const e = caught(() => router().match('GET', '/api/nothing'));
    expect([e.status, e.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
  });

  it('answers a wrong method on a known path with 405 and Allow', () => {
    const e = caught(() => router().match('DELETE', '/api/shifts/abc'));
    expect([e.status, e.code, e.headers.Allow]).toEqual([405, 'METHOD_NOT_ALLOWED', 'GET, PATCH']);
  });

  it('derives scopes from the method; public routes have none', () => {
    const r = router();
    r.add('GET', '/health', 'public', 'Health', () => noContent());
    expect(r.list().map(scopeOf)).toEqual(['planning:read', 'planning:read', 'planning:write', 'planning:write', null]);
  });
});
```

`src/server/http/kernel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Principal } from '../auth/principal';
import { currentCorrelationId } from '../support/requestContext';
import { HttpError } from './errors';
import { type AccessGuard, Kernel } from './kernel';
import { json } from './responses';
import { Router } from './router';

const open: AccessGuard = { check: async () => ({ principal: null, cookies: [] }) };
const kernel = (r: Router, guard: AccessGuard = open, logged: string[] = []) => new Kernel(r, guard, (line) => logged.push(line));
const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);

describe('Kernel', () => {
  it('reuses a safe correlation id and exposes it during the request', async () => {
    const r = new Router();
    r.add('GET', '/ok', 'public', 'Ok', () => json(200, { cid: currentCorrelationId() }));
    const response = await kernel(r).handle(req('/ok', { headers: { 'X-Correlation-ID': 'trace-42' } }));
    expect(response.headers.get('X-Correlation-ID')).toBe('trace-42');
    expect(await response.json()).toEqual({ cid: 'trace-42' });
  });

  it('mints a correlation id when the supplied one is unsafe', async () => {
    const response = await kernel(new Router()).handle(req('/x', { headers: { 'X-Correlation-ID': 'bad value!' } }));
    expect(response.headers.get('X-Correlation-ID')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the envelope for unrouted paths', async () => {
    const response = await kernel(new Router()).handle(req('/nope'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'RESOURCE_NOT_FOUND', message: 'No route for /nope.', correlation_id: response.headers.get('X-Correlation-ID'), details: null },
    });
  });

  it('hides unexpected errors behind a generic 500 and logs them', async () => {
    const r = new Router();
    r.add('GET', '/boom', 'public', 'Boom', () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const logged: string[] = [];
    const response = await kernel(r, open, logged).handle(req('/boom'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret_table');
    expect(logged[0]).toContain('secret_table');
  });

  it('passes the principal to the handler and appends guard cookies', async () => {
    const r = new Router();
    r.add('GET', '/me', 'person', 'Me', ({ principal }) => json(200, { who: principal?.email }));
    const guard: AccessGuard = {
      check: async () => ({ principal: { kind: 'person', subject: 's', email: 'ana@example.com' } as Principal, cookies: ['planning_session=abc; Path=/'] }),
    };
    const response = await kernel(r, guard).handle(req('/me'));
    expect(await response.json()).toEqual({ who: 'ana@example.com' });
    expect(response.headers.get('Set-Cookie')).toBe('planning_session=abc; Path=/');
  });

  it('keeps HttpError headers and rejects non-object JSON bodies', async () => {
    const r = new Router();
    r.add('GET', '/x', 'public', 'X', () => {
      throw new HttpError(401, 'UNAUTHORIZED', 'Signed out.', null, { 'Set-Cookie': 'planning_session=; Max-Age=0' });
    });
    r.add('POST', '/y', 'public', 'Y', async ({ body }) => json(200, await body()));
    expect((await kernel(r).handle(req('/x'))).headers.get('Set-Cookie')).toBe('planning_session=; Max-Age=0');
    const bad = await kernel(r).handle(req('/y', { method: 'POST', body: '[1,2]' }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.details).toEqual({ body: 'Request body must be a JSON object.' });
  });
});
```

Run: `npx vitest run --project unit`
Expected: FAIL (missing modules).

- [ ] **Step 2: Implement errors, responses, docs type, request context and principal**

`src/server/http/errors.ts`:

```ts
/** An expected failure that becomes a non-2xx response with the error envelope (contract SS-5). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static unauthorized(message: string): HttpError {
    return new HttpError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message: string, code = 'FORBIDDEN', details: unknown = null): HttpError {
    return new HttpError(403, code, message, details);
  }

  static notFound(message: string): HttpError {
    return new HttpError(404, 'RESOURCE_NOT_FOUND', message);
  }

  static conflict(code: string, message: string, details: unknown = null): HttpError {
    return new HttpError(409, code, message, details);
  }

  /** @param fields field name -> what is wrong */
  static validation(fields: Record<string, string>): HttpError {
    return new HttpError(422, 'VALIDATION_ERROR', 'The request has invalid fields.', fields);
  }
}
```

`src/server/http/responses.ts`:

```ts
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function envelope(code: string, message: string, correlationId: string, details: unknown) {
  return { error: { code, message, correlation_id: correlationId, details } };
}
```

`src/server/http/doc.ts`:

```ts
/** Endpoint discovery metadata the gateway catalogue requires (contract SS-27). */
export interface OperationDoc {
  name: string;
  purpose: string;
  use_when: string[];
  do_not_use_when: string[];
  inputs: string[];
  outputs: string[];
  requires: string[];
  related_endpoints: string[];
  tags: string[];
}

export function op(
  name: string, purpose: string, useWhen: string[], doNotUseWhen: string[],
  inputs: string[], outputs: string[], requires: string[], related: string[], tags: string[],
): OperationDoc {
  return { name, purpose, use_when: useWhen, do_not_use_when: doNotUseWhen, inputs, outputs, requires, related_endpoints: related, tags };
}
```

`src/server/support/requestContext.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request values that outbound HTTP calls forward (contract SS-4). */
export const requestContext = new AsyncLocalStorage<{ correlationId: string }>();

export function currentCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}
```

`src/server/auth/principal.ts`:

```ts
/** Who is calling: a signed-in person, or a program with a gateway access token. */
export interface Principal {
  kind: 'person' | 'client';
  subject: string;
  email: string | null;
  name: string | null;
  gatewayRole: string | null;
  employeeRef: string | null;
  isManager: boolean;
  scopes: string[];
}

/** Stored in created_by / granted_by columns. */
export function actorId(p: Principal): string {
  return p.kind === 'person' ? (p.email ?? p.subject) : `client:${p.subject}`;
}
```

- [ ] **Step 3: Implement the router and kernel**

`src/server/http/router.ts`:

```ts
import type { Principal } from '../auth/principal';
import type { OperationDoc } from './doc';
import { HttpError } from './errors';

/**
 * public: no auth, listed in OpenAPI (only /health and /openapi.json, contract SS-8).
 * internal: not in OpenAPI; the handler checks its own secret (cron).
 * person: any signed-in person; programs are refused.
 * manager: Planning Managers (BR-12), or programs holding the route's scope.
 */
export type Access = 'public' | 'internal' | 'person' | 'manager';

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

  match(method: string, path: string): { route: Route; params: Record<string, string> } {
    const allowed: string[] = [];
    for (const route of this.routes) {
      const params = matchPath(route.path, path);
      if (!params) continue;
      if (route.method === method) return { route, params };
      if (!allowed.includes(route.method)) allowed.push(route.method);
    }
    if (allowed.length > 0) {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed on ${path}.`, { allowed }, { Allow: allowed.join(', ') });
    }
    throw HttpError.notFound(`No route for ${path}.`);
  }
}
```

`src/server/http/kernel.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Principal } from '../auth/principal';
import { requestContext } from '../support/requestContext';
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

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
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
      try {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const { route, params } = this.router.match(request.method.toUpperCase(), path);
        const access = await this.guard.check(route, request);
        let body: Promise<Record<string, unknown>> | null = null;
        response = await route.handler({
          request,
          url,
          params,
          query: Object.fromEntries(url.searchParams),
          principal: access.principal,
          body: () => (body ??= readJsonObject(request)),
        });
        for (const cookie of access.cookies) response.headers.append('Set-Cookie', cookie);
      } catch (error) {
        if (error instanceof HttpError) {
          response = json(error.status, envelope(error.code, error.message, cid, error.details), error.headers);
        } else {
          const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
          this.log(`[planning-api] ${cid} ${detail}`);
          response = json(500, envelope('INTERNAL_ERROR', 'An unexpected error occurred.', cid, null));
        }
      }
      response.headers.set('X-Correlation-ID', cid);
      return response;
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project unit`
Expected: PASS (env 3, router 4, kernel 6).

- [ ] **Step 5: Commit**

```bash
git add src/server
git commit -m "feat: add HTTP kernel with routing, correlation ids and error envelope"
```

---

### Task 3: PostgreSQL schema, migrations and the test database

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/client.ts`, `drizzle.config.ts`, `scripts/migrate.ts`
- Create: `src/server/test/db.ts`, `src/server/test/globalSetup.ts`
- Generated: `drizzle/0000_*.sql`, `drizzle/meta/*`
- Test: `src/server/db/schema.int.test.ts`

**Interfaces:**
- Consumes: `loadLocalEnv` (Task 1).
- Produces:
  - Drizzle tables: `roles`, `employeeProfiles`, `employeeRoles`, `shifts`, `unavailabilities`, `publicHolidays`, `organisationSettings`, `planningManagers`, `employeeDirectory`, `notificationOutbox`.
  - `type Weekday`, `type WorkingHoursMap`.
  - `type Db` (a Drizzle node-postgres database with the schema).
  - `interface Database { db; pool; ping(): Promise<boolean>; close(): Promise<void> }` and `createDatabase(url): Database`.
  - Test helpers: `ORG = 'test-org'`, `TABLES`, `testDatabaseUrl()`, `useTestDatabase(): Database` (registers `beforeEach` truncate and `afterAll` close).

What this schema uses from PostgreSQL, worth looking up as you go:
- `timestamptz` for every instant.
- `uuid` keys.
- `jsonb` for working hours.
- `CHECK` constraints that refuse impossible rows (an end before a start, a percent outside 1–100).
- **Partial indexes** (`WHERE deleted_at IS NULL`) that index only the live shifts the schedule queries.
- An **expression index** on `lower(name)`, so role names are unique regardless of case.

- [ ] **Step 1: Write the schema**

`src/server/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, char, check, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WorkingHoursMap = Record<Weekday, [string, string][]>;

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const organisationId = () => varchar('organisation_id', { length: 64 }).notNull();
const email = (name: string) => varchar(name, { length: 254 });

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  name: varchar('name', { length: 80 }).notNull(),
  color: char('color', { length: 7 }).notNull(),
  archivedAt: instant('archived_at'),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  uniqueIndex('roles_org_lower_name_key').on(t.organisationId, sql`lower(${t.name})`),
]);

export const employeeProfiles = pgTable('employee_profiles', {
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  defaultRoleId: uuid('default_role_id'),
  timezone: varchar('timezone', { length: 64 }),
  workingHours: jsonb('working_hours').$type<WorkingHoursMap>(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.employeeRef] })]);

export const employeeRoles = pgTable('employee_roles', {
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  roleId: uuid('role_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.organisationId, t.employeeRef, t.roleId] }),
  index('employee_roles_role_idx').on(t.organisationId, t.roleId),
]);

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }),
  roleId: uuid('role_id'),
  startAt: instant('start_at').notNull(),
  endAt: instant('end_at').notNull(),
  breakMinutes: smallint('break_minutes').notNull().default(0),
  allocatedPercent: smallint('allocated_percent').notNull().default(100),
  note: text('note'),
  state: varchar('state', { length: 16 }).notNull().default('draft'),
  publishedAt: instant('published_at'),
  conflictAcknowledgedBy: email('conflict_acknowledged_by'),
  conflictAcknowledgedAt: instant('conflict_acknowledged_at'),
  version: integer('version').notNull().default(1),
  createdBy: email('created_by').notNull(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
  deletedAt: instant('deleted_at'),
  deletedBy: email('deleted_by'),
}, (t) => [
  check('shifts_end_after_start', sql`${t.endAt} > ${t.startAt}`),
  check('shifts_percent_range', sql`${t.allocatedPercent} between 1 and 100`),
  check('shifts_break_non_negative', sql`${t.breakMinutes} >= 0`),
  check('shifts_state_valid', sql`${t.state} in ('draft', 'published')`),
  index('shifts_live_time_idx').on(t.organisationId, t.startAt, t.endAt).where(sql`${t.deletedAt} is null`),
  index('shifts_live_employee_idx').on(t.organisationId, t.employeeRef, t.startAt).where(sql`${t.deletedAt} is null`),
]);

export const unavailabilities = pgTable('unavailabilities', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  startAt: instant('start_at').notNull(),
  endAt: instant('end_at').notNull(),
  reason: varchar('reason', { length: 200 }).notNull().default(''),
  createdBy: email('created_by').notNull(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  check('unavailabilities_end_after_start', sql`${t.endAt} > ${t.startAt}`),
  index('unavailabilities_employee_idx').on(t.organisationId, t.employeeRef, t.startAt),
  index('unavailabilities_time_idx').on(t.organisationId, t.startAt),
]);

export const publicHolidays = pgTable('public_holidays', {
  id: uuid('id').primaryKey(),
  organisationId: organisationId(),
  holidayDate: date('holiday_date', { mode: 'string' }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  source: varchar('source', { length: 16 }).notNull(),
  providerKey: varchar('provider_key', { length: 160 }),
  edited: boolean('edited').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
}, (t) => [
  check('public_holidays_source_valid', sql`${t.source} in ('manual', 'provider')`),
  uniqueIndex('public_holidays_provider_key').on(t.organisationId, t.providerKey),
  index('public_holidays_date_idx').on(t.organisationId, t.holidayDate),
]);

export const organisationSettings = pgTable('organisation_settings', {
  organisationId: varchar('organisation_id', { length: 64 }).primaryKey(),
  countryCode: char('country_code', { length: 2 }),
  regionCode: varchar('region_code', { length: 10 }),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  updatedAt: instant('updated_at').notNull(),
});

export const planningManagers = pgTable('planning_managers', {
  organisationId: organisationId(),
  email: email('email').notNull(),
  grantedBy: email('granted_by').notNull(),
  grantedAt: instant('granted_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.email] })]);

export const employeeDirectory = pgTable('employee_directory', {
  organisationId: organisationId(),
  employeeRef: varchar('employee_ref', { length: 64 }).notNull(),
  displayName: varchar('display_name', { length: 200 }).notNull(),
  photoUrl: varchar('photo_url', { length: 500 }),
  departmentId: varchar('department_id', { length: 64 }),
  departmentName: varchar('department_name', { length: 160 }),
  status: varchar('status', { length: 32 }).notNull(),
  fetchedAt: instant('fetched_at').notNull(),
}, (t) => [primaryKey({ columns: [t.organisationId, t.employeeRef] })]);

export const notificationOutbox = pgTable('notification_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organisationId: organisationId(),
  kind: varchar('kind', { length: 40 }).notNull(),
  employeeRef: varchar('employee_ref', { length: 64 }),
  subjectId: uuid('subject_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  deliverAfter: instant('deliver_after').notNull(),
  cancelledAt: instant('cancelled_at'),
  deliveredAt: instant('delivered_at'),
  createdAt: instant('created_at').notNull(),
}, (t) => [
  index('notification_outbox_pending_idx').on(t.organisationId, t.deliverAfter).where(sql`${t.deliveredAt} is null and ${t.cancelledAt} is null`),
  index('notification_outbox_subject_idx').on(t.organisationId, t.subjectId),
]);
```

- [ ] **Step 2: Add the client, Drizzle Kit config and migration script**

`src/server/db/client.ts`:

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  pool: Pool;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** The pool connects lazily, so /health and pages that need no data stay cheap (performance guide §3). */
export function createDatabase(url: string): Database {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 4_000, idleTimeoutMillis: 10_000 });
  return {
    db: drizzle(pool, { schema }),
    pool,
    async ping() {
      try {
        await pool.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
```

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile('.env.local');
} catch {
  // CI and Vercel use real environment variables.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
```

`scripts/migrate.ts`:

```ts
// Usage: npm run db:migrate   (applies drizzle/ to DATABASE_URL)
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadLocalEnv } from '../src/server/config/env';
import { createDatabase } from '../src/server/db/client';

loadLocalEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const database = createDatabase(url);
await migrate(database.db, { migrationsFolder: 'drizzle' });
await database.close();
console.log('Migrations applied.');
```

- [ ] **Step 3: Generate and apply the first migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: `drizzle/0000_<name>.sql` is created, and it contains `CREATE TABLE "shifts"`, the `CHECK` constraints, and `CREATE INDEX ... WHERE "deleted_at" is null`. The second command then prints `Migrations applied.`. In pgAdmin, *planning → Schemas → public → Tables* now lists the ten tables, and the `drizzle` schema holds `__drizzle_migrations`.

Read the generated SQL once. It is the real schema, and reading it is the quickest way to learn how PostgreSQL spells these features.

- [ ] **Step 4: Add the test database helpers**

`src/server/test/db.ts`:

```ts
import { afterAll, beforeEach } from 'vitest';
import { createDatabase, type Database } from '../db/client';

export const ORG = 'test-org';

export const TABLES = [
  'roles', 'employee_profiles', 'employee_roles', 'shifts', 'unavailabilities', 'public_holidays',
  'organisation_settings', 'planning_managers', 'employee_directory', 'notification_outbox',
];

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgres://planning:planning-dev-only@localhost:5432/planning_test';
}

/** One connection pool per test file, emptied before every test. Call at the top of the file. */
export function useTestDatabase(): Database {
  const database = createDatabase(testDatabaseUrl());
  beforeEach(async () => {
    await database.pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
  });
  afterAll(async () => {
    await database.close();
  });
  return database;
}
```

`src/server/test/globalSetup.ts`:

```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadLocalEnv } from '../config/env';
import { createDatabase } from '../db/client';
import { testDatabaseUrl } from './db';

/** Runs once before the integration project: brings planning_test up to the latest migration. */
export default async function setup(): Promise<void> {
  loadLocalEnv();
  const database = createDatabase(testDatabaseUrl());
  await migrate(database.db, { migrationsFolder: 'drizzle' });
  await database.close();
}
```

- [ ] **Step 5: Write the schema test**

`src/server/db/schema.int.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ORG, TABLES, useTestDatabase } from '../test/db';
import { roles, shifts } from './schema';

const database = useTestDatabase();
const now = new Date('2026-10-13T00:00:00Z');

function shift(start: string, end: string) {
  return { id: randomUUID(), organisationId: ORG, startAt: new Date(start), endAt: new Date(end), createdBy: 'test', createdAt: now, updatedAt: now };
}

/** Drizzle wraps driver errors; the PostgreSQL error code is on the error or its cause. */
async function pgErrorCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

describe('schema', () => {
  it('has every table', async () => {
    const { rows } = await database.pool.query("select table_name from information_schema.tables where table_schema = 'public'");
    expect(rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(TABLES));
  });

  it('refuses a shift that ends before it starts (CHECK constraint)', async () => {
    expect(await pgErrorCode(database.db.insert(shifts).values(shift('2026-10-13T10:00:00Z', '2026-10-13T09:00:00Z')))).toBe('23514');
  });

  it('keeps role names unique regardless of case (expression index)', async () => {
    const role = (name: string) => ({ id: randomUUID(), organisationId: ORG, name, color: '#000000', createdAt: now, updatedAt: now });
    await database.db.insert(roles).values(role('Technician'));
    expect(await pgErrorCode(database.db.insert(roles).values(role('technician')))).toBe('23505');
  });

  it('round-trips instants exactly (timestamptz)', async () => {
    await database.db.insert(shifts).values(shift('2026-10-13T01:00:00Z', '2026-10-13T09:00:00Z'));
    const [saved] = await database.db.select().from(shifts);
    expect(saved.startAt.toISOString()).toBe('2026-10-13T01:00:00.000Z');
  });
});
```

The two codes are standard PostgreSQL error codes: `23514` is `check_violation` and `23505` is `unique_violation`.

- [ ] **Step 6: Run the integration tests**

Run: `npm run test:integration`
Expected: PASS (4 tests). If the connection fails, check that the role and `planning_test` database from Task 1 Step 1 exist.

- [ ] **Step 7: Commit**

```bash
git add drizzle drizzle.config.ts scripts/migrate.ts src/server/db src/server/test
git commit -m "feat: add PostgreSQL schema, migrations and test database helpers"
```

---

### Task 4: App container, `/health`, `/openapi.json` and the route entry points

**Files:**
- Create: `src/server/config/serviceInfo.ts`, `src/server/support/clock.ts`
- Create: `src/server/http/openapi.ts`, `src/server/http/catalog.ts`
- Create: `src/server/app.ts`, `src/server/entry.ts`, `src/server/routes/index.ts`, `src/server/routes/health.ts`
- Create: `src/app/health/route.ts`, `src/app/openapi.json/route.ts`, `src/app/api/[...path]/route.ts`, `src/app/internal/[...path]/route.ts`, `vercel.json`
- Test: `src/server/routes/health.test.ts`, `src/server/http/openapi.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `SERVICE_VERSION = '0.1.0'`, `interface ServiceInfo { serviceId; extensionKey }`, `serviceInfoFromEnv()`.
  - `interface Clock { now(): Date }`, `systemClock`.
  - `buildOpenApi(routes, info, catalog)`.
  - `catalog` and `interface Capability`. Later tasks push capabilities into `catalog.capabilities`.
  - `interface AppDeps`. Its fields grow over Tasks 5–11; all are optional.
  - `class App(deps?)` with `protected once()` and getters `clock()`, `log`, `organisationId()`, `serviceInfo()`, `database()`, `guard()`, `router()`, `kernel()`, `openApiJson()`. Later tasks add getters with the same pattern.
  - `REQUIRED_ENV` (in `app.ts`, extended by later tasks), and `getApp()` and `handleApi(request)` in `entry.ts`.
  - `buildRouter(app)` in `routes/index.ts`, which runs every module in `MODULES`. Each route module exports `register(router, app)`.

- [ ] **Step 1: Write the failing tests**

`src/server/routes/health.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../app';
import { SERVICE_VERSION } from '../config/serviceInfo';
import type { Database } from '../db/client';

beforeAll(() => {
  process.env.SERVICE_ID = 'planning-api';
  process.env.OPENAPI_EXTENSION_KEY = 'x-test';
});

function appWithDatabase(up: boolean): App {
  return new App({ database: { ping: async () => up } as unknown as Database });
}

describe('GET /health', () => {
  it('is ok when the database answers', async () => {
    const response = await appWithDatabase(true).kernel().handle(new Request('http://localhost/health'));
    expect(await response.json()).toEqual({ status: 'ok', service: 'planning-api', version: SERVICE_VERSION, checks: { database: true } });
  });

  it('is degraded, still 200, when it does not', async () => {
    const response = await appWithDatabase(false).kernel().handle(new Request('http://localhost/health'));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('degraded');
  });
});
```

`src/server/http/openapi.test.ts`:

```ts
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
      if (route.access === 'person' || route.access === 'manager') expect(inCapabilities).toContain(`${route.method} ${route.path}`);
    }
  });
});
```

Run: `npx vitest run --project unit`
Expected: FAIL (missing modules).

- [ ] **Step 2: Implement service info, the clock, the catalogue and the OpenAPI builder**

`src/server/config/serviceInfo.ts`:

```ts
import { requireEnv } from './env';

/** Change in the same commit as any API change (NFR-09). */
export const SERVICE_VERSION = '0.1.0';

export interface ServiceInfo {
  serviceId: string;
  /** The OpenAPI extension key the gateway reads catalogue metadata from. */
  extensionKey: string;
}

export function serviceInfoFromEnv(): ServiceInfo {
  return { serviceId: requireEnv('SERVICE_ID'), extensionKey: requireEnv('OPENAPI_EXTENSION_KEY') };
}
```

`src/server/support/clock.ts`:

```ts
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
```

`src/server/http/catalog.ts`:

```ts
export interface Capability {
  name: string;
  icon: string;
  description: string;
  does: string[];
  best_for: string;
  endpoints: string[];
}

/**
 * Service-level catalogue metadata (contract SS-23, SS-27). Every person or
 * manager route must appear in a capability; openapi.test.ts checks this.
 */
export const catalog = {
  domain: 'Operations',
  owner: 'services-team',
  app_url: '/',
  category: 'Operations',
  industries: ['Operations', 'Human Resources'],
  use_cases: [
    'Planning weekly shifts for a services team',
    'Publishing a work schedule to employees',
    'Checking who is working when',
    'Spotting double bookings and people scheduled on leave',
  ],
  capabilities: [] as Capability[],
  workflows: [
    { name: 'Plan and publish a week', steps: ['GET /api/schedule', 'POST /api/shifts', 'PATCH /api/shifts/{id}', 'POST /api/publications'] },
  ],
  related_services: ['intern-database', 'department-api'],
};
```

`src/server/http/openapi.ts`:

```ts
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
```

- [ ] **Step 3: Implement the app container, the health routes and the entry points**

`src/server/app.ts`:

```ts
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
```

`src/server/routes/health.ts`:

```ts
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
```

`src/server/routes/index.ts`:

```ts
import type { App } from '../app';
import { Router } from '../http/router';
import * as health from './health';

/** Every route module. Later tasks add theirs to this list. */
const MODULES: { register(r: Router, app: App): void }[] = [health];

export function buildRouter(app: App): Router {
  const router = new Router();
  for (const module of MODULES) module.register(router, app);
  return router;
}
```

`src/server/entry.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { App, REQUIRED_ENV } from './app';
import { ConfigError, requireAll } from './config/env';
import { envelope, json } from './http/responses';

let app: App | undefined;

export function getApp(): App {
  return (app ??= new App());
}

/** Every API route file hands its requests to this. */
export async function handleApi(request: Request): Promise<Response> {
  try {
    requireAll(REQUIRED_ENV);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[planning-api] ${error.message}`);
    const cid = randomUUID();
    return json(500, envelope('INTERNAL_ERROR', 'The service is misconfigured. See the server log.', cid, null), { 'X-Correlation-ID': cid });
  }
  return getApp().kernel().handle(request);
}
```

The four route files are identical, because each exports every method so a wrong method gets the JSON 405 envelope instead of Next.js's HTML page. Write each of `src/app/health/route.ts`, `src/app/openapi.json/route.ts`, `src/app/api/[...path]/route.ts` and `src/app/internal/[...path]/route.ts` as:

```ts
import { handleApi } from '@/server/entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handleApi;
export const POST = handleApi;
export const PUT = handleApi;
export const PATCH = handleApi;
export const DELETE = handleApi;
```

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"]
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit`
Expected: `health.test.ts` passes. In `openapi.test.ts`, `declares complete service metadata` fails because `capabilities` is still empty; Task 6 adds the first one. The other four pass.

- [ ] **Step 5: Check the running app by hand**

```bash
npm run dev
```

In a second terminal:

```bash
curl -i http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/openapi.json | head -c 300
curl -i -X PUT http://127.0.0.1:3000/health
```

Expected:
- `/health` returns 200 `{"status":"ok","service":"planning-api",...}` with an `X-Correlation-ID` header.
- The `PUT` returns 405 with the error envelope and `Allow: GET`.

Unknown paths outside these routes still show Next.js's HTML 404 until Task 8 adds the proxy.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: serve /health and /openapi.json from the route table"
```

---

### Task 5: Gateway token verification, session check and session cookie

The auth guide (§3) recommends the maintained `jose` library for Node instead of hand-written JWT code, so signature, `exp`, `iss` and `aud` checks come from `jose`. Planning adds the `token_use` check the guide insists on. Two other choices are deliberate:
- The session check reports *unknown* separately from *live*, so the cookie is only extended when the gateway confirmed the session. An unreachable gateway then can't keep a session alive forever (auth guide §6).
- There is no default session secret and no default role.

**Files:**
- Create: `src/server/support/http.ts`, `src/server/auth/tokens.ts`, `src/server/auth/gateway.ts`, `src/server/auth/session.ts`
- Create: `src/server/test/fakes.ts`, `src/server/test/tokens.ts`
- Test: `src/server/auth/tokens.test.ts`, `src/server/auth/gateway.test.ts`, `src/server/auth/session.test.ts`

**Interfaces:**
- Consumes: `Clock`, `ConfigError`, `currentCorrelationId`.
- Produces:
  - `interface HttpResult { status: number; json: unknown; networkError: boolean }`.
  - `interface HttpClient { request(method, url, options?: { headers?, body?, timeoutMs? }): Promise<HttpResult> }` and `FetchHttpClient`.
  - `class TokenInvalid extends Error`.
  - `class TokenVerifier(keys: JWTVerifyGetKey, issuer, audience)` with `.verify(token, expectedUse: 'identity' | 'access'): Promise<Record<string, unknown>>`.
  - `type Liveness = 'live' | 'dead' | 'unknown'` and `interface SessionLiveness { liveness(sid, sub): Promise<Liveness> }`.
  - `class Gateway(http, gatewayUrl, publicUrl)` implements `SessionLiveness`, with `.authorizeUrl(returnPath)` and `.exchangeCode(code): Promise<string>`.
  - `interface SessionData { sid; sub; email; name; gatewayRole; employeeRef: string | null; expiresAt: number }` (expiry in seconds).
  - `SESSION_COOKIE = 'planning_session'`, `SESSION_TTL_SECONDS = 900`, and `class SessionCodec(secret, clock)` with `.decode(value?)`, `.issue(session, secure)` and `.clear(secure)`.
  - `readCookies(request): Record<string, string>`.
  - Test helpers:
    - `class FixedClock` with `FixedClock.at(iso)` and `.advance(seconds)`.
    - `class FakeHttpClient` with `.on(method, urlPrefix, ...results)` and a `requests` array; `reply(status, json)`.
    - `makeTestTokens(): Promise<{ keys, sign(claims?, header?) }>`, and the constants `ISSUER`, `AUDIENCE`, `KID`.
    - `cookieValue(setCookie): string`, which extracts the value from a Set-Cookie line.

- [ ] **Step 1: Add the test helpers**

`src/server/test/fakes.ts`:

```ts
import type { Clock } from '../support/clock';
import type { HttpClient, HttpResult } from '../support/http';

export class FixedClock implements Clock {
  private current: Date;

  private constructor(at: Date) {
    this.current = at;
  }

  static at(iso: string): FixedClock {
    return new FixedClock(new Date(iso));
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

export const reply = (status: number, json: unknown): HttpResult => ({ status, json, networkError: false });

/** Answers by method + URL prefix, in registration order. Unmatched requests are network failures. */
export class FakeHttpClient implements HttpClient {
  private readonly routes: { method: string; prefix: string; results: HttpResult[] }[] = [];
  readonly requests: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];

  on(method: string, prefix: string, ...results: HttpResult[]): this {
    this.routes.push({ method, prefix, results });
    return this;
  }

  async request(method: string, url: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<HttpResult> {
    this.requests.push({ method, url, headers: options.headers ?? {}, body: options.body });
    for (const route of this.routes) {
      if (route.method === method && url.startsWith(route.prefix)) return route.results.length > 1 ? route.results.shift()! : route.results[0];
    }
    return { status: 0, json: null, networkError: true };
  }
}

/** "planning_session=abc.def; Path=/; ..." -> "abc.def" */
export function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
}
```

`src/server/test/tokens.ts`:

```ts
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';

export const ISSUER = 'https://gateway.test';
export const AUDIENCE = 'planning-api';
export const KID = 'test-key';

export interface TestTokens {
  keys: JWTVerifyGetKey;
  /** Gateway-shaped token. A claim set to null is left out. */
  sign(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

export async function makeTestTokens(): Promise<TestTokens> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256' };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    async sign(claims = {}, header = {}) {
      const merged: Record<string, unknown> = {
        token_use: 'identity', sid: 'sid-1', sub: 'sub-1', email: 'ana@example.com', name: 'Ana Lim', role: 'user',
        iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300, ...claims,
      };
      const payload = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null));
      return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: KID, ...header }).sign(privateKey);
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`src/server/auth/tokens.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIENCE, ISSUER, makeTestTokens, type TestTokens } from '../test/tokens';
import { TokenInvalid, TokenVerifier } from './tokens';

let tokens: TestTokens;
let verifier: TokenVerifier;

beforeAll(async () => {
  tokens = await makeTestTokens();
  verifier = new TokenVerifier(tokens.keys, ISSUER, AUDIENCE);
});

describe('TokenVerifier', () => {
  it('returns the claims of a valid identity token', async () => {
    expect((await verifier.verify(await tokens.sign(), 'identity')).email).toBe('ana@example.com');
  });

  it('refuses an access token where an identity token is expected (token_use)', async () => {
    await expect(verifier.verify(await tokens.sign({ token_use: 'access' }), 'identity')).rejects.toThrow('Expected a "identity" token, got "access".');
  });

  it.each([
    ['expired', { exp: Math.floor(Date.now() / 1000) - 10 }, {}],
    ['wrong issuer', { iss: 'https://evil.test' }, {}],
    ['wrong audience', { aud: 'other-api' }, {}],
    ['no expiry', { exp: null }, {}],
    ['unknown key', {}, { kid: 'other' }],
  ])('refuses a token with %s', async (_label, claims, header) => {
    await expect(verifier.verify(await tokens.sign(claims, header), 'identity')).rejects.toBeInstanceOf(TokenInvalid);
  });

  it('refuses a tampered payload and garbage', async () => {
    const [h, , s] = (await tokens.sign()).split('.');
    const forged = Buffer.from(JSON.stringify({ token_use: 'identity', role: 'admin' })).toString('base64url');
    await expect(verifier.verify(`${h}.${forged}.${s}`, 'identity')).rejects.toBeInstanceOf(TokenInvalid);
    await expect(verifier.verify('abc', 'identity')).rejects.toBeInstanceOf(TokenInvalid);
  });
});
```

`src/server/auth/gateway.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeHttpClient, reply } from '../test/fakes';
import { Gateway } from './gateway';

const GW = 'https://gateway.test';
const gateway = (http: FakeHttpClient) => new Gateway(http, GW, 'https://planning.test');

describe('Gateway', () => {
  it('builds the authorize URL from configured URLs only', () => {
    expect(gateway(new FakeHttpClient()).authorizeUrl('/schedule?x=1')).toBe(`${GW}/oauth/authorize?redirect_uri=https%3A%2F%2Fplanning.test%2F&state=%2Fschedule%3Fx%3D1`);
    expect(gateway(new FakeHttpClient()).authorizeUrl('/')).not.toContain('state');
  });

  it('exchanges a code server-to-server', async () => {
    const http = new FakeHttpClient().on('POST', `${GW}/oauth/token`, reply(200, { token: 'jwt' }));
    expect(await gateway(http).exchangeCode('c-1')).toBe('jwt');
    expect(JSON.parse(http.requests[0].body!)).toEqual({ code: 'c-1', redirect_uri: 'https://planning.test/' });
  });

  it('throws when the exchange is refused', async () => {
    const http = new FakeHttpClient().on('POST', `${GW}/oauth/token`, reply(400, { error: 'bad' }));
    await expect(gateway(http).exchangeCode('c-1')).rejects.toThrow();
  });

  it('reports live, dead and unknown', async () => {
    const url = `${GW}/oauth/introspect`;
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(200, { active: true }))).liveness('s', 'u')).toBe('live');
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(200, { active: false }))).liveness('s', 'u')).toBe('dead');
    expect(await gateway(new FakeHttpClient().on('POST', url, reply(503, {}))).liveness('s', 'u')).toBe('unknown');
    expect(await gateway(new FakeHttpClient()).liveness('s', 'u')).toBe('unknown');
  });
});
```

`src/server/auth/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config/env';
import { cookieValue, FixedClock } from '../test/fakes';
import { readCookies, SessionCodec, type SessionData } from './session';

const session: SessionData = { sid: 'sid-1', sub: 'sub-1', email: 'ana@example.com', name: 'Ana Lim', gatewayRole: 'user', employeeRef: 'EMP-1', expiresAt: 0 };

function setup() {
  const clock = FixedClock.at('2026-10-13T00:00:00Z');
  return { clock, codec: new SessionCodec('0123456789abcdef0123456789abcdef', clock) };
}

describe('SessionCodec', () => {
  it('round-trips through a signed HttpOnly cookie', () => {
    const { codec } = setup();
    const cookie = codec.issue(session, true);
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=900', 'Path=/']) expect(cookie).toContain(part);
    expect(codec.decode(cookieValue(cookie))).toMatchObject({ employeeRef: 'EMP-1', gatewayRole: 'user' });
  });

  it('rejects a tampered cookie', () => {
    const { codec } = setup();
    const [, mac] = cookieValue(codec.issue(session, false)).split('.');
    const forged = Buffer.from(JSON.stringify({ ...session, gatewayRole: 'admin', expiresAt: 9e9 })).toString('base64url');
    expect(codec.decode(`${forged}.${mac}`)).toBeNull();
  });

  it('rejects an expired or missing cookie', () => {
    const { codec, clock } = setup();
    const value = cookieValue(codec.issue(session, false));
    clock.advance(901);
    expect(codec.decode(value)).toBeNull();
    expect(codec.decode(undefined)).toBeNull();
    expect(codec.decode('no-dot')).toBeNull();
  });

  it('refuses a short secret', () => {
    expect(() => new SessionCodec('too-short', FixedClock.at('2026-10-13T00:00:00Z'))).toThrow(ConfigError);
  });

  it('clears and reads cookies', () => {
    const { codec } = setup();
    expect(codec.clear(false)).toBe('planning_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(readCookies(new Request('http://x', { headers: { cookie: 'a=1; planning_return_to=%2Fsettings' } }))).toEqual({ a: '1', planning_return_to: '/settings' });
  });
});
```

Run: `npx vitest run --project unit`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement the HTTP client and token verification**

`src/server/support/http.ts`:

```ts
import { currentCorrelationId } from './requestContext';

export interface HttpResult {
  status: number;
  /** Parsed JSON body, or null when there was none or it was not JSON. */
  json: unknown;
  networkError: boolean;
}

export interface HttpClient {
  request(method: string, url: string, options?: { headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<HttpResult>;
}

/** Outbound calls to the gateway and other services. Forwards the correlation id (contract SS-4). */
export class FetchHttpClient implements HttpClient {
  async request(method: string, url: string, options: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<HttpResult> {
    const cid = currentCorrelationId();
    try {
      const response = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(cid ? { 'X-Correlation-ID': cid } : {}), ...options.headers },
        body: options.body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
        cache: 'no-store',
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, json, networkError: false };
    } catch {
      return { status: 0, json: null, networkError: true };
    }
  }
}
```

`src/server/auth/tokens.ts`:

```ts
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export class TokenInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenInvalid';
  }
}

function describe(error: unknown): string {
  if (error instanceof errors.JWTExpired) return 'Token has expired.';
  if (error instanceof errors.JWTClaimValidationFailed) return `Token claim "${error.claim}" is not valid.`;
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'Signature does not verify.';
  if (error instanceof errors.JWKSNoMatchingKey) return "No matching key in the gateway's key set.";
  if (error instanceof errors.JOSEAlgNotAllowed) return 'Unexpected algorithm.';
  return 'Malformed or unverifiable token.';
}

/**
 * Contract SS-25, auth guide §3. jose checks the RS256 signature against the
 * gateway's JWKS plus exp, iss and aud; this class adds token_use, which is
 * what stops an identity token being used as an access token and vice versa.
 */
export class TokenVerifier {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  async verify(token: string, expectedUse: 'identity' | 'access'): Promise<Record<string, unknown>> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer.replace(/\/+$/, ''),
        audience: this.audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp'],
      }));
    } catch (error) {
      throw new TokenInvalid(describe(error));
    }
    if (payload.token_use !== expectedUse) {
      throw new TokenInvalid(`Expected a "${expectedUse}" token, got "${String(payload.token_use ?? 'none')}".`);
    }
    return payload;
  }
}
```

In production, `App` creates the key source with `createRemoteJWKSet(new URL(\`${gatewayUrl}/.well-known/jwks.json\`))`. It fetches the keys once, caches them, and refetches only for an unknown key id (performance guide §5c).

- [ ] **Step 4: Implement the gateway client and the session cookie**

`src/server/auth/gateway.ts`:

```ts
import type { HttpClient } from '../support/http';

export type Liveness = 'live' | 'dead' | 'unknown';

export interface SessionLiveness {
  liveness(sid: string, sub: string): Promise<Liveness>;
}

/** Calls Planning makes to the InterlinkERP gateway (auth guide §1, §4, §5). URLs come from config only (§8). */
export class Gateway implements SessionLiveness {
  constructor(
    private readonly http: HttpClient,
    private readonly gatewayUrl: string,
    private readonly publicUrl: string,
  ) {}

  authorizeUrl(returnPath: string): string {
    const url = `${this.gatewayUrl}/oauth/authorize?redirect_uri=${encodeURIComponent(`${this.publicUrl}/`)}`;
    return returnPath && returnPath !== '/' ? `${url}&state=${encodeURIComponent(returnPath)}` : url;
  }

  /** Server-to-server code exchange (auth guide §4 step 4). Returns the identity token. */
  async exchangeCode(code: string): Promise<string> {
    const result = await this.http.request('POST', `${this.gatewayUrl}/oauth/token`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: `${this.publicUrl}/` }),
    });
    const token = (result.json as { token?: unknown } | null)?.token;
    if (result.status !== 200 || typeof token !== 'string' || token === '') {
      throw new Error(`The gateway did not accept the sign-in code (HTTP ${result.status}).`);
    }
    return token;
  }

  /** Auth guide §5: every request, no cache. Network or server trouble is 'unknown' (fail open). */
  async liveness(sid: string, sub: string): Promise<Liveness> {
    const result = await this.http.request('POST', `${this.gatewayUrl}/oauth/introspect`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, sub }),
      timeoutMs: 4_000,
    });
    if (result.networkError || result.status !== 200 || result.json === null || typeof result.json !== 'object') return 'unknown';
    return (result.json as { active?: unknown }).active ? 'live' : 'dead';
  }
}
```

`src/server/auth/session.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigError } from '../config/env';
import type { Clock } from '../support/clock';

export const SESSION_COOKIE = 'planning_session';
export const SESSION_TTL_SECONDS = 900;

/** What Planning keeps about a signed-in person. Never the identity token itself. */
export interface SessionData {
  sid: string;
  sub: string;
  email: string;
  name: string;
  gatewayRole: string;
  employeeRef: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export function readCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    try {
      out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      // Ignore a malformed cookie rather than failing the request.
    }
  }
  return out;
}

function isSession(value: unknown): value is SessionData {
  const v = value as Record<string, unknown>;
  return typeof v === 'object' && v !== null
    && ['sid', 'sub', 'email', 'name', 'gatewayRole'].every((k) => typeof v[k] === 'string')
    && (v.employeeRef === null || typeof v.employeeRef === 'string')
    && typeof v.expiresAt === 'number';
}

/** HMAC-signed, HttpOnly, 15-minute session cookie (auth guide §6). */
export class SessionCodec {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {
    if (secret.length < 32) throw new ConfigError('SESSION_SECRET must be at least 32 characters.');
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  decode(value: string | undefined): SessionData | null {
    if (!value || !value.includes('.')) return null;
    const [body, mac] = value.split('.', 2);
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let data: unknown;
    try {
      data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!isSession(data) || data.expiresAt <= Math.floor(this.clock.now().getTime() / 1000)) return null;
    return data;
  }

  /** A fresh Set-Cookie value that expires SESSION_TTL_SECONDS from now. */
  issue(session: SessionData, secure: boolean): string {
    const fresh: SessionData = { ...session, expiresAt: Math.floor(this.clock.now().getTime() / 1000) + SESSION_TTL_SECONDS };
    const body = Buffer.from(JSON.stringify(fresh)).toString('base64url');
    return cookie(`${body}.${this.sign(body)}`, SESSION_TTL_SECONDS, secure);
  }

  clear(secure: boolean): string {
    return cookie('', 0, secure);
  }
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server
git commit -m "feat: verify gateway tokens and add signed session cookie"
```

---

### Task 6: Access guard, Planning Managers and `/api/me`

**Files:**
- Create: `src/server/auth/guard.ts`, `src/server/auth/devIdentity.ts`, `src/server/repo/managers.ts`, `src/server/routes/me.ts`
- Modify: `src/server/app.ts`, `src/server/routes/index.ts`, `src/server/http/catalog.ts`, `ListOfRequirements.md`
- Test: `src/server/auth/guard.test.ts`, `src/server/repo/managers.int.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `interface ManagerDirectory { isManager(email): Promise<boolean> }`.
  - `class ManagerRepository(db, org)` implements `ManagerDirectory`, plus:
    - `.all(): Promise<{ email, granted_by, granted_at }[]>`
    - `.grant(email, by, at): Promise<boolean>` (false if already listed)
    - `.revoke(email): Promise<boolean>`, `.count(): Promise<number>`
  - `class DevIdentity(session)` with `DevIdentity.fromEnv(): DevIdentity | null`, `.allows(request): boolean` and `.session`.
  - `class GatewayAccessGuard(sessions, liveness, tokens, managers, dev, secureCookies)` implements `AccessGuard`.
  - `GET /api/me` returns `{ name, email, gateway_role, employee_ref, is_manager }`. Task 12 adds `timezone` and `organisation_timezone`.
  - `AppDeps` gains `http?: HttpClient` and `jwks?: JWTVerifyGetKey`.
  - New `App` getters: `http()`, `gatewayUrl()`, `publicUrl()`, `secureCookies()`, `tokenVerifier()`, `gateway()`, `sessions()`, `devIdentity()`, `managers()`.

**Why email and not `sub`:** BR-12 in the spec says the manager list holds the gateway `sub`. Managers grant access by picking someone from the roster, which only knows email addresses. Nobody's `sub` is known until that person signs in. The identity token's `email` claim is signed by the gateway, so keying by email still means "gateway identity". Step 1 updates the spec.

- [ ] **Step 1: Amend the spec**

In `ListOfRequirements.md`:
- Set the version row to `| Version | 0.3 (draft, reviewed) |`.
- In **BR-12**, replace ``or their gateway identity (`sub`) is in Planning's manager list`` with `or the email address in their gateway-verified identity token is in Planning's manager list`.
- In **FR-ACC-03**, replace `stored by their gateway identity` with `stored by the email address the gateway verifies at sign-in (the roster does not know gateway sub ids)`.
- In **DR-01**, replace ``Manager grant (gateway `sub`, email at time of grant, granted by, granted at)`` with `Manager grant (email, granted by, granted at)`.

- [ ] **Step 2: Write the failing tests**

`src/server/auth/guard.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors';
import { noContent } from '../http/responses';
import type { Access, Route } from '../http/router';
import { cookieValue, FixedClock } from '../test/fakes';
import { AUDIENCE, ISSUER, makeTestTokens, type TestTokens } from '../test/tokens';
import { DevIdentity } from './devIdentity';
import type { Liveness } from './gateway';
import { GatewayAccessGuard } from './guard';
import { SessionCodec, type SessionData } from './session';
import { TokenVerifier } from './tokens';

let tokens: TestTokens;
beforeAll(async () => {
  tokens = await makeTestTokens();
});

const codec = new SessionCodec('s'.repeat(32), FixedClock.at('2026-10-13T00:00:00Z'));
const route = (access: Access, method = 'GET'): Route => ({ method, path: '/api/x', access, summary: 'X', handler: () => noContent(), doc: null });

function guard(options: { liveness?: Liveness; managers?: string[]; dev?: DevIdentity | null } = {}) {
  return new GatewayAccessGuard(
    codec,
    { liveness: async () => options.liveness ?? 'live' },
    new TokenVerifier(tokens.keys, ISSUER, AUDIENCE),
    { isManager: async (email) => (options.managers ?? []).includes(email) },
    options.dev ?? null,
    true,
  );
}

function withSession(role = 'user', email = 'ana@example.com'): Request {
  const session: SessionData = { sid: 'sid-1', sub: 'sub-1', email, name: 'Ana', gatewayRole: role, employeeRef: 'EMP-1', expiresAt: 0 };
  return new Request('http://localhost/api/x', { headers: { cookie: `planning_session=${cookieValue(codec.issue(session, true))}` } });
}

async function rejection(work: Promise<unknown>): Promise<HttpError> {
  try {
    await work;
  } catch (e) {
    return e as HttpError;
  }
  throw new Error('expected a rejection');
}

describe('GatewayAccessGuard', () => {
  it('lets public routes through with no principal', async () => {
    expect((await guard().check(route('public'), new Request('http://localhost/health'))).principal).toBeNull();
  });

  it('is 401 without a session, and ignores forged identity headers', async () => {
    const forged = new Request('http://localhost/api/x', { headers: { 'x-authenticated-user': 'admin@example.com', 'x-user-role': 'admin' } });
    expect((await rejection(guard().check(route('manager'), forged))).status).toBe(401);
  });

  it('gives a live session a principal and a fresh cookie', async () => {
    const result = await guard().check(route('person'), withSession());
    expect(result.principal).toMatchObject({ kind: 'person', email: 'ana@example.com', employeeRef: 'EMP-1', isManager: false });
    expect(result.cookies).toHaveLength(1);
  });

  it('fails open on an unknown gateway answer but does not extend the session', async () => {
    const result = await guard({ liveness: 'unknown' }).check(route('person'), withSession());
    expect(result.principal).not.toBeNull();
    expect(result.cookies).toEqual([]);
  });

  it('locks immediately when the gateway session has ended, and clears the cookie', async () => {
    const e = await rejection(guard({ liveness: 'dead' }).check(route('person'), withSession()));
    expect(e.status).toBe(401);
    expect(e.headers['Set-Cookie']).toContain('Max-Age=0');
  });

  it('applies BR-12', async () => {
    expect((await rejection(guard().check(route('manager'), withSession()))).status).toBe(403);
    expect((await guard().check(route('manager'), withSession('admin'))).principal?.isManager).toBe(true);
    expect((await guard({ managers: ['ana@example.com'] }).check(route('manager'), withSession('user', 'Ana@Example.com'))).principal?.isManager).toBe(true);
    expect((await rejection(guard().check(route('manager'), withSession('')))).status).toBe(403);
  });

  it('accepts a program with the right scope and refuses the rest', async () => {
    const bearer = async (claims: Record<string, unknown>) =>
      new Request('http://localhost/api/x', { method: 'POST', headers: { authorization: `Bearer ${await tokens.sign({ token_use: 'access', sub: 'client-9', ...claims })}` } });

    const ok = await guard().check(route('manager', 'POST'), await bearer({ scope: 'planning:read planning:write' }));
    expect(ok.principal).toMatchObject({ kind: 'client', subject: 'client-9' });

    const missing = await rejection(guard().check(route('manager', 'POST'), await bearer({ scope: 'planning:read' })));
    expect([missing.status, missing.details]).toEqual([403, { required: ['planning:write'], granted: ['planning:read'] }]);

    const personOnly = await rejection(guard().check(route('person'), await bearer({ scope: 'planning:read' })));
    expect([personOnly.status, personOnly.code]).toEqual([403, 'PERSON_REQUIRED']);

    const identityAsBearer = new Request('http://localhost/api/x', { headers: { authorization: `Bearer ${await tokens.sign()}` } });
    expect((await rejection(guard().check(route('manager'), identityAsBearer))).status).toBe(401);
  });

  it('uses the dev identity only for direct loopback requests', async () => {
    const dev = new DevIdentity({ sid: 'dev', sub: 'dev:dev@example.com', email: 'dev@example.com', name: 'Dev', gatewayRole: 'admin', employeeRef: null, expiresAt: Number.MAX_SAFE_INTEGER });
    const local = new Request('http://127.0.0.1:3000/api/x', { headers: { 'x-forwarded-for': '127.0.0.1' } });
    const proxied = new Request('http://127.0.0.1:3000/api/x', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    const remoteHost = new Request('http://planning.example.com/api/x');

    expect((await guard({ dev }).check(route('manager'), local)).principal?.isManager).toBe(true);
    expect((await rejection(guard({ dev }).check(route('person'), proxied))).status).toBe(401);
    expect((await rejection(guard({ dev }).check(route('person'), remoteHost))).status).toBe(401);
  });
});
```

`src/server/repo/managers.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ORG, useTestDatabase } from '../test/db';
import { ManagerRepository } from './managers';

const database = useTestDatabase();

describe('ManagerRepository', () => {
  it('grants, lists, checks and revokes by lower-cased email', async () => {
    const repo = new ManagerRepository(database.db, ORG);
    const at = new Date('2026-10-13T00:00:00Z');

    expect(await repo.grant('Bo@Example.com', 'admin@example.com', at)).toBe(true);
    expect(await repo.grant('bo@example.com', 'admin@example.com', at)).toBe(false);
    expect(await repo.isManager('BO@example.com')).toBe(true);
    expect(await repo.all()).toEqual([{ email: 'bo@example.com', granted_by: 'admin@example.com', granted_at: '2026-10-13T00:00:00Z' }]);
    expect(await repo.count()).toBe(1);

    expect(await repo.revoke('bo@example.com')).toBe(true);
    expect(await repo.revoke('bo@example.com')).toBe(false);
    expect(await repo.isManager('bo@example.com')).toBe(false);
  });

  it('cannot see other organisations', async () => {
    await new ManagerRepository(database.db, 'other-org').grant('bo@example.com', 'x', new Date());
    expect(await new ManagerRepository(database.db, ORG).isManager('bo@example.com')).toBe(false);
  });
});
```

Run: `npx vitest run --project unit && npm run test:integration`
Expected: FAIL (missing modules).

- [ ] **Step 3: Add the shared time helpers every repository uses**

`src/server/support/time.ts`:

```ts
import { DateTime, IANAZone } from 'luxon';

/** API format: 2026-10-13T09:00:00Z */
export function iso(value: Date | number): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Epoch ms of local midnight at the start of `date` (YYYY-MM-DD) in `zone`. */
export function localMidnight(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).startOf('day').toMillis();
}

export function localDate(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toISODate()!;
}

export function isTimezone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

/** The calendar date after `date` (both YYYY-MM-DD). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Implement the manager list**

`src/server/repo/managers.ts`:

```ts
import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { planningManagers } from '../db/schema';
import { iso } from '../support/time';

export interface ManagerDirectory {
  isManager(email: string): Promise<boolean>;
}

const norm = (email: string) => email.trim().toLowerCase();

/** Planning's own manager list (BR-12, FR-ACC-03), keyed by lower-cased email. */
export class ManagerRepository implements ManagerDirectory {
  constructor(private readonly db: Db, private readonly org: string) {}

  private where(email: string) {
    return and(eq(planningManagers.organisationId, this.org), eq(planningManagers.email, norm(email)));
  }

  async isManager(email: string): Promise<boolean> {
    const rows = await this.db.select({ email: planningManagers.email }).from(planningManagers).where(this.where(email)).limit(1);
    return rows.length > 0;
  }

  async all(): Promise<{ email: string; granted_by: string; granted_at: string }[]> {
    const rows = await this.db.select().from(planningManagers).where(eq(planningManagers.organisationId, this.org)).orderBy(planningManagers.email);
    return rows.map((r) => ({ email: r.email, granted_by: r.grantedBy, granted_at: iso(r.grantedAt) }));
  }

  async grant(email: string, grantedBy: string, at: Date): Promise<boolean> {
    const inserted = await this.db.insert(planningManagers)
      .values({ organisationId: this.org, email: norm(email), grantedBy, grantedAt: at })
      .onConflictDoNothing()
      .returning({ email: planningManagers.email });
    return inserted.length === 1;
  }

  async revoke(email: string): Promise<boolean> {
    const deleted = await this.db.delete(planningManagers).where(this.where(email)).returning({ email: planningManagers.email });
    return deleted.length === 1;
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(planningManagers).where(eq(planningManagers.organisationId, this.org));
    return Number(row.n);
  }
}
```

- [ ] **Step 5: Implement the developer identity and the guard**

`src/server/auth/devIdentity.ts`:

```ts
import { env } from '../config/env';
import type { SessionData } from './session';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '[::1]']);

/**
 * Local development sign-in. 127.0.0.1 is not a redirect_uri the gateway
 * knows, so real sign-in is impossible locally. Only `next dev`
 * (NODE_ENV=development, bound to 127.0.0.1 by the dev script) with
 * APP_ENV=development, never on Vercel, and only for loopback requests.
 */
export class DevIdentity {
  constructor(readonly session: SessionData) {}

  static fromEnv(): DevIdentity | null {
    if (process.env.NODE_ENV !== 'development' || env('APP_ENV') !== 'development' || env('VERCEL') !== undefined) return null;
    const email = (env('DEV_USER_EMAIL', 'dev@example.com') ?? 'dev@example.com').toLowerCase();
    return new DevIdentity({
      sid: 'dev-session',
      sub: `dev:${email}`,
      email,
      name: env('DEV_USER_NAME', 'Local Developer')!,
      gatewayRole: env('DEV_USER_ROLE', 'user')!,
      employeeRef: env('DEV_EMPLOYEE_REF') ?? null,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
  }

  allows(request: Request): boolean {
    if (!LOOPBACK.has(new URL(request.url).hostname)) return false;
    const forwarded = request.headers.get('x-forwarded-for');
    return !forwarded || forwarded.split(',').every((ip) => LOOPBACK.has(ip.trim()));
  }
}
```

`src/server/auth/guard.ts`:

```ts
import { HttpError } from '../http/errors';
import type { AccessGuard, AccessResult } from '../http/kernel';
import { type Route, scopeOf } from '../http/router';
import type { ManagerDirectory } from '../repo/managers';
import type { DevIdentity } from './devIdentity';
import type { SessionLiveness } from './gateway';
import type { Principal } from './principal';
import { readCookies, SESSION_COOKIE, type SessionCodec, type SessionData } from './session';
import { TokenInvalid, type TokenVerifier } from './tokens';

/**
 * Who is calling, and may they use this route?
 *  - Programs send a gateway access token (contract SS-6, SS-25) and need the route's scope.
 *  - People carry Planning's session cookie, re-checked with the gateway on every request.
 * Identity never comes from any other header (auth guide §3).
 */
export class GatewayAccessGuard implements AccessGuard {
  constructor(
    private readonly sessions: SessionCodec,
    private readonly gateway: SessionLiveness,
    private readonly tokens: TokenVerifier,
    private readonly managers: ManagerDirectory,
    private readonly dev: DevIdentity | null,
    private readonly secureCookies: boolean,
  ) {}

  async check(route: Route, request: Request): Promise<AccessResult> {
    if (route.access === 'public' || route.access === 'internal') return { principal: null, cookies: [] };

    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (bearer) return { principal: await this.client(route, bearer), cookies: [] };

    const { principal, cookies } = await this.person(request);
    if (route.access === 'manager' && !principal.isManager) throw HttpError.forbidden('Only Planning Managers can do this.');
    return { principal, cookies };
  }

  private async client(route: Route, token: string): Promise<Principal> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.tokens.verify(token, 'access');
    } catch (error) {
      if (error instanceof TokenInvalid) throw HttpError.unauthorized(error.message);
      throw error;
    }
    const scopes = String(claims.scope ?? '').split(' ').filter(Boolean);
    if (route.access === 'person') throw HttpError.forbidden('This endpoint is only for signed-in people.', 'PERSON_REQUIRED');
    const required = scopeOf(route)!;
    if (!scopes.includes(required)) throw HttpError.forbidden(`This endpoint needs ${required}.`, 'FORBIDDEN', { required: [required], granted: scopes });
    return { kind: 'client', subject: String(claims.sub ?? 'unknown'), email: null, name: null, gatewayRole: null, employeeRef: null, isManager: false, scopes };
  }

  private async person(request: Request): Promise<{ principal: Principal; cookies: string[] }> {
    if (this.dev?.allows(request)) return { principal: await this.principalFor(this.dev.session), cookies: [] };

    const session = this.sessions.decode(readCookies(request)[SESSION_COOKIE]);
    if (!session) throw HttpError.unauthorized('Sign in through the InterlinkERP gateway first.');

    const liveness = await this.gateway.liveness(session.sid, session.sub);
    if (liveness === 'dead') {
      throw new HttpError(401, 'UNAUTHORIZED', 'Your InterlinkERP session has ended.', null, { 'Set-Cookie': this.sessions.clear(this.secureCookies) });
    }
    // Only extend the session when the gateway confirmed it (auth guide §6 backstop).
    const cookies = liveness === 'live' ? [this.sessions.issue(session, this.secureCookies)] : [];
    return { principal: await this.principalFor(session), cookies };
  }

  /** BR-12: gateway admin, or listed email. Anything else, including no role, is not a manager. */
  private async principalFor(session: SessionData): Promise<Principal> {
    const email = session.email.trim().toLowerCase();
    const isManager = session.gatewayRole === 'admin' || (email !== '' && (await this.managers.isManager(email)));
    return { kind: 'person', subject: session.sub, email, name: session.name, gatewayRole: session.gatewayRole, employeeRef: session.employeeRef, isManager, scopes: [] };
  }
}
```

- [ ] **Step 6: Add `/api/me`, wire `App`, and add the first capability**

`src/server/routes/me.ts`:

```ts
import type { App } from '../app';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';

export function register(r: Router, _app: App): void {
  r.add('GET', '/api/me', 'person', 'Show who is signed in and what they may do in Planning.', ({ principal: me }) =>
    json(200, { name: me?.name ?? null, email: me?.email ?? null, gateway_role: me?.gatewayRole ?? null, employee_ref: me?.employeeRef ?? null, is_manager: me?.isManager ?? false }),
  op('Show Current User', 'Find out who is signed in and whether they manage planning', ['Deciding which screens to show after sign-in'], ['Listing employees', 'Reading shifts'],
    [], ['name', 'email', 'employee_ref', 'is_manager', 'timezone'], ['Signed-in person'], ['GET /api/my/shifts', 'GET /api/schedule'],
    ['me', 'profile', 'current user', 'whoami', 'permissions']));
}
```

In `src/server/routes/index.ts`, add `import * as me from './me';` and change the list to `[health, me]`.

In `src/server/http/catalog.ts`, set `capabilities` to:

```ts
  capabilities: [
    {
      name: 'Check Access',
      icon: '🔑',
      description: 'See who is signed in and whether they can manage planning.',
      does: ['See who is signed in', 'Check if someone is a Planning Manager'],
      best_for: 'Screens that change depending on who is looking.',
      endpoints: ['GET /api/me'],
    },
  ] as Capability[],
```

In `src/server/app.ts`, make these changes:

1. Set `REQUIRED_ENV` to `['SERVICE_ID', 'OPENAPI_EXTENSION_KEY', 'DATABASE_URL', 'GATEWAY_URL', 'PUBLIC_URL', 'SESSION_SECRET']`.
2. Add to `AppDeps`:

   ```ts
     http?: HttpClient;
     jwks?: JWTVerifyGetKey;
     devIdentity?: DevIdentity | null;
   ```

3. Replace `guard()` with:

   ```ts
     guard(): AccessGuard {
       return this.deps.guard ?? this.once('guard', () => new GatewayAccessGuard(
         this.sessions(), this.gateway(), this.tokenVerifier(), this.managers(), this.devIdentity(), this.secureCookies(),
       ));
     }
   ```

4. Remove the now-unused `HttpError` import and add the imports for:
   - `createRemoteJWKSet` and `JWTVerifyGetKey` from `jose`
   - `DevIdentity`, `Gateway`, `GatewayAccessGuard`, `SessionCodec` and `TokenVerifier`
   - `ManagerRepository`, and `FetchHttpClient` and `HttpClient`

5. Add these getters:

```ts
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
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS, including `openapi.test.ts`, which now has a capability.

- [ ] **Step 8: Check by hand**

Set `SESSION_SECRET` in `.env.local` to a 64-character random value, then run `npm run dev` and:

```bash
curl -s http://127.0.0.1:3000/api/me
curl -s -H "X-Forwarded-For: 203.0.113.9" http://127.0.0.1:3000/api/me
curl -s -H "x-authenticated-user: admin@example.com" -H "X-Forwarded-For: 203.0.113.9" http://127.0.0.1:3000/api/me
```

Expected:
- The first call returns the dev identity from `.env.local`, with `"is_manager": true` when `DEV_USER_ROLE=admin`.
- The second and third calls return 401 with the error envelope. The forged header is ignored.

- [ ] **Step 9: Commit**

```bash
git add ListOfRequirements.md src/server
git commit -m "feat: enforce gateway session and Planning Manager access on every request"
```

---

### Task 7: Employee roster from intern-database, with a 24-hour directory cache

**Files:**
- Create: `src/server/roster/roster.ts`, `clientCredentials.ts`, `internDatabase.ts`, `departments.ts`, `refresher.ts`
- Create: `src/server/repo/directory.ts`, `src/server/routes/cron.ts`
- Modify: `src/server/test/fakes.ts` (add `FakeRoster`, `FakeDepartments`), `src/server/app.ts`, `src/server/routes/index.ts`, `vercel.json`
- Test: `src/server/roster/clientCredentials.test.ts`, `src/server/roster/internDatabase.test.ts`, `src/server/roster/refresher.int.test.ts`, `src/server/routes/cron.int.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `FakeHttpClient`, `Clock`, `FixedClock`, `Database`.
- Produces:
  - `interface RosterPerson { ref; name; email: string | null; photoUrl: string | null; departmentId: string | null; status }`.
  - `interface Roster { findByEmail(email): Promise<RosterPerson | null>; listPlannable(): Promise<RosterPerson[]> }`. Both throw `RosterUnavailable`.
  - `interface DepartmentNames { all(): Promise<Map<string, string>> }`.
  - `class RosterUnavailable extends Error` and `unconfiguredRoster` (implements both interfaces and always throws).
  - `class ClientCredentials(http, gatewayUrl, clientId, clientSecret, clock)` with `.token(audience): Promise<string>`.
  - `class InternDatabaseRoster(http, credentials, baseUrl)`, `PLANNABLE_STATUSES`, `toRosterPerson(row)`.
  - `class DepartmentApi(http, credentials, baseUrl)`.
  - `interface DirectoryRow { employeeRef; displayName; photoUrl; departmentId; departmentName; status }`.
  - `class DirectoryRepository(db, org)` with `.replaceAll(rows, fetchedAt)`, `.all()`, `.find(ref)`, `.isEmpty()` and `.lastFetchedAt()`.
  - `class DirectoryRefresher(roster, departments, directory, clock, log)`, `DIRECTORY_MAX_AGE_SECONDS = 86400`, `.refresh(): Promise<boolean>`, `.refreshIfEmpty(): Promise<boolean>`. Neither method ever throws.
  - `GET /internal/cron/directory`, authorised by `Authorization: Bearer $CRON_SECRET`.
  - Test fakes: `FakeRoster` (`.add(ref, name, email?, departmentId?, status?)`, `.down`) and `FakeDepartments` (`.names`, `.down`).
  - `AppDeps` gains `roster?`, `departments?` and `cronSecret?`. New `App` getters: `credentials()`, `roster()`, `departments()`, `directory()`, `directoryRefresher()`.

The intern-database contract was checked against its live `/openapi.json` on 2026-10-13:
- `GET /api/interns?email=&limit=&offset=` needs the `intern:read` scope and returns `{data: Intern[], pagination: {total}}`.
- `Intern` has `id` (uuid), `first_name`, `last_name`, `email_address`, `department_id`, `photo_url` and `status`.
- `status` is one of `Onboarding`, `Active`, `Offboarding`, `Former`, `Contract Ended`, `Resignation` or `Termination`.

`GET /api/departments` on department-api needs the `department:read` scope. Planning uses the intern `id` as `employee_ref`.

- [ ] **Step 1: Add the roster types and fakes**

`src/server/roster/roster.ts`:

```ts
export interface RosterPerson {
  ref: string;
  name: string;
  email: string | null;
  photoUrl: string | null;
  departmentId: string | null;
  status: string;
}

export class RosterUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterUnavailable';
  }
}

/** IF-02. The only code that knows where the employee roster lives (OI-03). */
export interface Roster {
  findByEmail(email: string): Promise<RosterPerson | null>;
  listPlannable(): Promise<RosterPerson[]>;
}

/** IF-03 */
export interface DepartmentNames {
  all(): Promise<Map<string, string>>;
}

const NOT_CONFIGURED = 'No InterlinkERP API client is configured (INTERLINK_CLIENT_ID / INTERN_DATABASE_URL / DEPARTMENT_API_URL).';

/** Used when no API client is configured: behaves like a roster that is down (NFR-06). */
export const unconfiguredRoster: Roster & DepartmentNames = {
  findByEmail: async () => {
    throw new RosterUnavailable(NOT_CONFIGURED);
  },
  listPlannable: async () => {
    throw new RosterUnavailable(NOT_CONFIGURED);
  },
  all: async () => {
    throw new RosterUnavailable(NOT_CONFIGURED);
  },
};
```

Append to `src/server/test/fakes.ts`:

```ts
import type { DepartmentNames, Roster, RosterPerson } from '../roster/roster';
import { RosterUnavailable } from '../roster/roster';

export class FakeRoster implements Roster {
  readonly people = new Map<string, RosterPerson>();
  down = false;

  add(ref: string, name: string, email: string | null = null, departmentId: string | null = null, status = 'Active'): RosterPerson {
    const person = { ref, name, email: email?.toLowerCase() ?? null, photoUrl: null, departmentId, status };
    this.people.set(person.email ?? ref, person);
    return person;
  }

  async findByEmail(email: string): Promise<RosterPerson | null> {
    if (this.down) throw new RosterUnavailable('roster is down');
    return this.people.get(email.toLowerCase()) ?? null;
  }

  async listPlannable(): Promise<RosterPerson[]> {
    if (this.down) throw new RosterUnavailable('roster is down');
    return [...this.people.values()];
  }
}

export class FakeDepartments implements DepartmentNames {
  names = new Map<string, string>();
  down = false;

  async all(): Promise<Map<string, string>> {
    if (this.down) throw new Error('department-api is down');
    return this.names;
  }
}
```

Move these two `import` lines to the top of `fakes.ts` with the others.

- [ ] **Step 2: Write the failing tests**

`src/server/roster/clientCredentials.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeHttpClient, FixedClock, reply } from '../test/fakes';
import { ClientCredentials } from './clientCredentials';
import { RosterUnavailable } from './roster';

describe('ClientCredentials', () => {
  it('reuses a token until a minute before it expires', async () => {
    const http = new FakeHttpClient().on('POST', 'https://gw.test/oauth/token', reply(200, { access_token: 't1', expires_in: 3600 }));
    const clock = FixedClock.at('2026-10-13T00:00:00Z');
    const cc = new ClientCredentials(http, 'https://gw.test', 'id', 'secret', clock);

    expect(await cc.token('intern-database')).toBe('t1');
    expect(await cc.token('intern-database')).toBe('t1');
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(JSON.parse(http.requests[0].body!)).toEqual({ grant_type: 'client_credentials', audience: 'intern-database' });

    clock.advance(3550);
    await cc.token('intern-database');
    expect(http.requests).toHaveLength(2);
  });

  it('throws RosterUnavailable when the gateway refuses', async () => {
    const http = new FakeHttpClient().on('POST', 'https://gw.test/oauth/token', reply(403, { error: 'nope' }));
    await expect(new ClientCredentials(http, 'https://gw.test', 'id', 's', FixedClock.at('2026-10-13T00:00:00Z')).token('x')).rejects.toBeInstanceOf(RosterUnavailable);
  });
});
```

`src/server/roster/internDatabase.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeHttpClient, FixedClock, reply } from '../test/fakes';
import { ClientCredentials } from './clientCredentials';
import { InternDatabaseRoster, toRosterPerson } from './internDatabase';
import { RosterUnavailable } from './roster';

const BASE = 'https://interns.test';

function roster(http: FakeHttpClient): InternDatabaseRoster {
  http.on('POST', 'https://gw.test/oauth/token', reply(200, { access_token: 'tok', expires_in: 3600 }));
  return new InternDatabaseRoster(http, new ClientCredentials(http, 'https://gw.test', 'id', 's', FixedClock.at('2026-10-13T00:00:00Z')), BASE);
}

const intern = (id: string, email: string, status = 'Active') => ({
  id, ref_number: `INT-${id}`, first_name: 'Ana', last_name: `Lim ${id}`, email_address: email, department_id: 'DEP-1', photo_url: 'https://img.test/a.png', status,
});

describe('InternDatabaseRoster', () => {
  it('finds a person by email, ignoring case, with a bearer token', async () => {
    const http = new FakeHttpClient().on('GET', `${BASE}/api/interns?email=`, reply(200, { data: [intern('u1', 'Ana@Example.com')] }));
    const person = await roster(http).findByEmail('ana@example.com');
    expect(person).toMatchObject({ ref: 'u1', name: 'Ana Lim u1', departmentId: 'DEP-1', photoUrl: 'https://img.test/a.png' });
    expect(http.requests[1].headers.Authorization).toBe('Bearer tok');
  });

  it('ignores rows whose email does not match', async () => {
    const http = new FakeHttpClient().on('GET', `${BASE}/api/interns?email=`, reply(200, { data: [intern('u1', 'other@example.com')] }));
    expect(await roster(http).findByEmail('ana@example.com')).toBeNull();
  });

  it('pages through the roster and keeps plannable statuses only', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => intern(`a${i}`, `a${i}@x.test`));
    const page2 = [intern('b1', 'b1@x.test', 'Former'), intern('b2', 'b2@x.test', 'Offboarding')];
    const http = new FakeHttpClient()
      .on('GET', `${BASE}/api/interns?limit=200&offset=0`, reply(200, { data: page1, pagination: { total: 202 } }))
      .on('GET', `${BASE}/api/interns?limit=200&offset=200`, reply(200, { data: page2, pagination: { total: 202 } }));
    const people = await roster(http).listPlannable();
    expect(people).toHaveLength(201);
    expect(people[200].ref).toBe('b2');
  });

  it('drops unsafe photo URLs', () => {
    expect(toRosterPerson({ ...intern('u1', 'a@x.test'), photo_url: 'javascript:alert(1)' }).photoUrl).toBeNull();
  });

  it('raises RosterUnavailable on service errors', async () => {
    const http = new FakeHttpClient().on('GET', `${BASE}/api/interns`, reply(500, {}));
    await expect(roster(http).listPlannable()).rejects.toBeInstanceOf(RosterUnavailable);
  });
});
```

`src/server/roster/refresher.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DirectoryRepository } from '../repo/directory';
import { ORG, useTestDatabase } from '../test/db';
import { FakeDepartments, FakeRoster, FixedClock } from '../test/fakes';
import { DirectoryRefresher } from './refresher';

const database = useTestDatabase();

function setup() {
  const roster = new FakeRoster();
  const departments = new FakeDepartments();
  const directory = new DirectoryRepository(database.db, ORG);
  const clock = FixedClock.at('2026-10-13T00:00:00Z');
  const refresher = new DirectoryRefresher(roster, departments, directory, clock, () => {});
  return { roster, departments, directory, clock, refresher };
}

describe('DirectoryRefresher', () => {
  it('stores people with department names', async () => {
    const { roster, departments, directory, clock, refresher } = setup();
    roster.add('u1', 'Ana Lim', 'ana@x.test', 'DEP-1');
    departments.names.set('DEP-1', 'Field Services');

    expect(await refresher.refresh()).toBe(true);
    expect(await directory.all()).toEqual([{ employeeRef: 'u1', displayName: 'Ana Lim', photoUrl: null, departmentId: 'DEP-1', departmentName: 'Field Services', status: 'Active' }]);
    expect(await directory.lastFetchedAt()).toEqual(clock.now());
  });

  it('keeps the old cache when the roster is down', async () => {
    const { roster, directory, refresher } = setup();
    roster.add('u1', 'Ana Lim', 'ana@x.test');
    await refresher.refresh();
    roster.down = true;
    expect(await refresher.refresh()).toBe(false);
    expect(await directory.all()).toHaveLength(1);
  });

  it('still refreshes people when department names are unavailable', async () => {
    const { roster, departments, directory, refresher } = setup();
    roster.add('u1', 'Ana Lim', 'ana@x.test', 'DEP-1');
    departments.down = true;
    expect(await refresher.refresh()).toBe(true);
    expect((await directory.all())[0].departmentName).toBeNull();
  });

  it('backs off for 5 minutes after a failed first load', async () => {
    const { roster, clock, refresher } = setup();
    roster.down = true;
    expect(await refresher.refreshIfEmpty()).toBe(false);
    roster.down = false;
    roster.add('u1', 'Ana Lim', 'ana@x.test');
    expect(await refresher.refreshIfEmpty()).toBe(false);
    clock.advance(301);
    expect(await refresher.refreshIfEmpty()).toBe(true);
    expect(await refresher.refreshIfEmpty()).toBe(false);
  });
});
```

`src/server/routes/cron.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { App } from '../app';
import { ORG, useTestDatabase } from '../test/db';
import { FakeDepartments, FakeRoster, FixedClock } from '../test/fakes';

const database = useTestDatabase();

function app(cronSecret: string | null): App {
  const roster = new FakeRoster();
  roster.add('u1', 'Ana Lim', 'ana@x.test');
  return new App({ database, organisationId: ORG, clock: FixedClock.at('2026-10-13T00:00:00Z'), roster, departments: new FakeDepartments(), cronSecret, guard: { check: async () => ({ principal: null, cookies: [] }) } });
}

const call = (a: App, auth?: string) => a.kernel().handle(new Request('http://localhost/internal/cron/directory', { headers: auth ? { authorization: auth } : {} }));

describe('GET /internal/cron/directory', () => {
  it('refuses a missing or wrong secret', async () => {
    expect((await call(app(null), 'Bearer x')).status).toBe(401);
    expect((await call(app('right'), 'Bearer wrong')).status).toBe(401);
    expect((await call(app('right'))).status).toBe(401);
  });

  it('refreshes the directory with the right secret', async () => {
    const response = await call(app('right'), 'Bearer right');
    expect(await response.json()).toEqual({ refreshed: true });
  });
});
```

Run: `npx vitest run`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement client credentials, the roster and departments**

`src/server/roster/clientCredentials.ts`:

```ts
import type { Clock } from '../support/clock';
import type { HttpClient } from '../support/http';
import { RosterUnavailable } from './roster';

/**
 * Service-to-service access tokens (contract SS-26), one per audience, reused
 * until a minute before expiry (performance guide §5b). Held in memory: each
 * serverless instance fetches at most one token per audience per hour.
 */
export class ClientCredentials {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly http: HttpClient,
    private readonly gatewayUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly clock: Clock,
  ) {}

  async token(audience: string): Promise<string> {
    const now = this.clock.now().getTime();
    const cached = this.cache.get(audience);
    if (cached && cached.expiresAt > now + 60_000) return cached.token;

    const result = await this.http.request('POST', `${this.gatewayUrl}/oauth/token`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}` },
      body: JSON.stringify({ grant_type: 'client_credentials', audience }),
      timeoutMs: 6_000,
    });
    const body = result.json as { access_token?: unknown; expires_in?: unknown } | null;
    if (result.status !== 200 || typeof body?.access_token !== 'string' || body.access_token === '') {
      throw new RosterUnavailable(`The gateway refused a ${audience} token (HTTP ${result.status}).`);
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.cache.set(audience, { token: body.access_token, expiresAt: now + Math.max(60, expiresIn) * 1000 });
    return body.access_token;
  }
}
```

`src/server/roster/internDatabase.ts`:

```ts
import type { HttpClient } from '../support/http';
import type { ClientCredentials } from './clientCredentials';
import { type Roster, type RosterPerson, RosterUnavailable } from './roster';

export const PLANNABLE_STATUSES = ['Onboarding', 'Active', 'Offboarding'];
const AUDIENCE = 'intern-database';
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

type Row = Record<string, unknown>;

/** Only plain https image URLs: they end up in an <img src>. */
function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\/[^\s"'<>`]+$/i.test(value)) return null;
  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

export function toRosterPerson(row: Row): RosterPerson {
  const name = `${String(row.first_name ?? '')} ${String(row.last_name ?? '')}`.trim();
  const email = String(row.email_address ?? '').trim().toLowerCase();
  const department = row.department_id;
  return {
    ref: String(row.id),
    name: name || String(row.ref_number ?? row.id),
    email: email || null,
    photoUrl: safeImageUrl(row.photo_url),
    departmentId: typeof department === 'string' && department !== '' ? department : null,
    status: String(row.status ?? ''),
  };
}

function rows(json: unknown): Row[] {
  const data = (json as { data?: unknown; items?: unknown } | null)?.data ?? (json as { items?: unknown } | null)?.items;
  return Array.isArray(data) ? data.filter((r): r is Row => typeof r === 'object' && r !== null) : [];
}

export class InternDatabaseRoster implements Roster {
  constructor(
    private readonly http: HttpClient,
    private readonly credentials: ClientCredentials,
    private readonly baseUrl: string,
  ) {}

  private async get(path: string): Promise<unknown> {
    const token = await this.credentials.token(AUDIENCE);
    const result = await this.http.request('GET', `${this.baseUrl.replace(/\/+$/, '')}${path}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 6_000 });
    if (result.status !== 200 || result.json === null) throw new RosterUnavailable(`intern-database returned HTTP ${result.status}.`);
    return result.json;
  }

  async findByEmail(email: string): Promise<RosterPerson | null> {
    const wanted = email.trim().toLowerCase();
    for (const row of rows(await this.get(`/api/interns?email=${encodeURIComponent(wanted)}&limit=5`))) {
      if (String(row.email_address ?? '').trim().toLowerCase() === wanted && row.id !== undefined) return toRosterPerson(row);
    }
    return null;
  }

  async listPlannable(): Promise<RosterPerson[]> {
    const people: RosterPerson[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const json = await this.get(`/api/interns?limit=${PAGE_SIZE}&offset=${offset}`);
      const batch = rows(json);
      for (const row of batch) {
        if (row.id !== undefined && PLANNABLE_STATUSES.includes(String(row.status))) people.push(toRosterPerson(row));
      }
      const total = Number((json as { pagination?: { total?: unknown } }).pagination?.total ?? 0);
      if (batch.length < PAGE_SIZE || offset + PAGE_SIZE >= total) break;
    }
    return people;
  }
}
```

`src/server/roster/departments.ts`:

```ts
import type { HttpClient } from '../support/http';
import type { ClientCredentials } from './clientCredentials';
import { type DepartmentNames, RosterUnavailable } from './roster';

export class DepartmentApi implements DepartmentNames {
  constructor(
    private readonly http: HttpClient,
    private readonly credentials: ClientCredentials,
    private readonly baseUrl: string,
  ) {}

  async all(): Promise<Map<string, string>> {
    const token = await this.credentials.token('department-api');
    const result = await this.http.request('GET', `${this.baseUrl.replace(/\/+$/, '')}/api/departments?limit=200`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 6_000 });
    if (result.status !== 200 || result.json === null) throw new RosterUnavailable(`department-api returned HTTP ${result.status}.`);
    const data = Array.isArray(result.json) ? result.json : (result.json as { data?: unknown }).data;
    const names = new Map<string, string>();
    for (const row of Array.isArray(data) ? data : []) {
      if (row && typeof row === 'object' && 'id' in row && typeof (row as { name?: unknown }).name === 'string') {
        names.set(String((row as { id: unknown }).id), (row as { name: string }).name);
      }
    }
    return names;
  }
}
```

- [ ] **Step 4: Implement the directory cache, the refresher and the cron route**

`src/server/repo/directory.ts`:

```ts
import { and, eq, max } from 'drizzle-orm';
import type { Db } from '../db/client';
import { employeeDirectory } from '../db/schema';

export interface DirectoryRow {
  employeeRef: string;
  displayName: string;
  photoUrl: string | null;
  departmentId: string | null;
  departmentName: string | null;
  status: string;
}

const COLUMNS = {
  employeeRef: employeeDirectory.employeeRef,
  displayName: employeeDirectory.displayName,
  photoUrl: employeeDirectory.photoUrl,
  departmentId: employeeDirectory.departmentId,
  departmentName: employeeDirectory.departmentName,
  status: employeeDirectory.status,
};

/** DR-02: display fields only, at most 24 hours old. No emails or other personal data. */
export class DirectoryRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async replaceAll(rows: DirectoryRow[], fetchedAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org));
      if (rows.length > 0) await tx.insert(employeeDirectory).values(rows.map((r) => ({ ...r, organisationId: this.org, fetchedAt })));
    });
  }

  all(): Promise<DirectoryRow[]> {
    return this.db.select(COLUMNS).from(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org)).orderBy(employeeDirectory.displayName);
  }

  async find(ref: string): Promise<DirectoryRow | null> {
    const [row] = await this.db.select(COLUMNS).from(employeeDirectory)
      .where(and(eq(employeeDirectory.organisationId, this.org), eq(employeeDirectory.employeeRef, ref))).limit(1);
    return row ?? null;
  }

  async isEmpty(): Promise<boolean> {
    const rows = await this.db.select({ ref: employeeDirectory.employeeRef }).from(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org)).limit(1);
    return rows.length === 0;
  }

  async lastFetchedAt(): Promise<Date | null> {
    const [row] = await this.db.select({ at: max(employeeDirectory.fetchedAt) }).from(employeeDirectory).where(eq(employeeDirectory.organisationId, this.org));
    return row?.at ?? null;
  }
}
```

`src/server/roster/refresher.ts`:

```ts
import type { Logger } from '../http/kernel';
import type { DirectoryRepository, DirectoryRow } from '../repo/directory';
import type { Clock } from '../support/clock';
import type { DepartmentNames, Roster } from './roster';

export const DIRECTORY_MAX_AGE_SECONDS = 86_400;
const BACKOFF_MS = 5 * 60_000;

/**
 * Keeps employee_directory fresh (DR-02). Never throws: when the roster or
 * department service is down, the old cache stays and planning goes on (NFR-06).
 */
export class DirectoryRefresher {
  private lastFailureAt = 0;

  constructor(
    private readonly roster: Roster,
    private readonly departments: DepartmentNames,
    private readonly directory: DirectoryRepository,
    private readonly clock: Clock,
    private readonly log: Logger,
  ) {}

  async refresh(): Promise<boolean> {
    let people;
    try {
      people = await this.roster.listPlannable();
    } catch (error) {
      this.log(`[planning-api] roster refresh failed: ${(error as Error).message}`);
      return false;
    }
    let names = new Map<string, string>();
    try {
      names = await this.departments.all();
    } catch (error) {
      this.log(`[planning-api] department names unavailable: ${(error as Error).message}`);
    }
    const rows: DirectoryRow[] = people.map((p) => ({
      employeeRef: p.ref, displayName: p.name, photoUrl: p.photoUrl, departmentId: p.departmentId,
      departmentName: p.departmentId ? names.get(p.departmentId) ?? null : null, status: p.status,
    }));
    try {
      await this.directory.replaceAll(rows, this.clock.now());
      return true;
    } catch (error) {
      this.log(`[planning-api] directory write failed: ${(error as Error).message}`);
      return false;
    }
  }

  /** First-use bootstrap. After a failure, waits 5 minutes before trying again so pages stay fast. */
  async refreshIfEmpty(): Promise<boolean> {
    try {
      if (!(await this.directory.isEmpty())) return false;
    } catch {
      return false;
    }
    const now = this.clock.now().getTime();
    if (now - this.lastFailureAt < BACKOFF_MS) return false;
    const ok = await this.refresh();
    this.lastFailureAt = ok ? 0 : now;
    return ok;
  }
}
```

`src/server/routes/cron.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';
import type { App } from '../app';
import { HttpError } from '../http/errors';
import { json } from '../http/responses';
import type { Router } from '../http/router';

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function register(r: Router, app: App): void {
  // Vercel cron sends "Authorization: Bearer $CRON_SECRET". Not part of the public API document.
  r.add('GET', '/internal/cron/directory', 'internal', 'Refresh the cached employee directory.', async ({ request }) => {
    const secret = app.cronSecret();
    if (!secret || !sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
      throw HttpError.unauthorized('A valid cron secret is required.');
    }
    return json(200, { refreshed: await app.directoryRefresher().refresh() });
  });
}
```

- [ ] **Step 5: Wire it into `App`, the routes and Vercel**

Add to `AppDeps`: `roster?: Roster; departments?: DepartmentNames; cronSecret?: string | null;`. Then add these getters, with matching imports:

```ts
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
      return credentials && url ? new InternDatabaseRoster(this.http(), credentials, url) : unconfiguredRoster;
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
```

In `routes/index.ts`, import `cron` and add it to `MODULES`.

`vercel.json` becomes the following. The schedule `0 18 * * *` runs at 18:00 UTC, which is 02:00 in Malaysia.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"],
  "crons": [{ "path": "/internal/cron/directory", "schedule": "0 18 * * *" }]
}
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: PASS. `openapi.test.ts` still passes because internal routes stay out of the document.

- [ ] **Step 7: Commit**

```bash
git add src/server vercel.json
git commit -m "feat: load plannable employees from intern-database with a daily directory cache"
```

---

### Task 8: Sign-in page gate and `proxy.ts`

**Files:**
- Create: `src/server/web/pageGate.ts`, `src/proxy.ts`
- Modify: `src/server/app.ts` (`pageGate()`)
- Test: `src/server/web/pageGate.test.ts`

**Interfaces:**
- Consumes: `Gateway`, `TokenVerifier`, `SessionCodec`, `readCookies`, `Roster`, `DevIdentity`, `Logger`, `REQUIRED_ENV`, `correlationIdFor`, `envelope`.
- Produces:
  - `PAGE_PATHS`, `isPagePath(path)`, `safeReturnPath(path?)`, `RETURN_COOKIE = 'planning_return_to'`.
  - `type GateResult` is one of:
    - `{ kind: 'pass'; cookies }`
    - `{ kind: 'redirect'; location; cookies }`
    - `{ kind: 'error'; status; html; cookies }`
  - `class PageGate(gateway, tokens, sessions, roster, dev, publicUrl, log)` with `.handle(request): Promise<GateResult>`.
  - `App.pageGate()`.
  - `proxy(request)` in `src/proxy.ts`. It handles every path except Next.js's static assets:
    - API paths pass straight through.
    - Page paths go through the gate.
    - Anything else gets the JSON 404 envelope (contract SS-5: unrouted paths are never HTML).

- [ ] **Step 1: Write the failing test**

`src/server/web/pageGate.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { Gateway } from '../auth/gateway';
import { SessionCodec } from '../auth/session';
import { TokenVerifier } from '../auth/tokens';
import { cookieValue, FakeHttpClient, FakeRoster, FixedClock, reply } from '../test/fakes';
import { AUDIENCE, ISSUER, makeTestTokens, type TestTokens } from '../test/tokens';
import { type GateResult, isPagePath, PageGate, safeReturnPath } from './pageGate';

const PUBLIC = 'https://planning.test';
let tokens: TestTokens;
beforeAll(async () => {
  tokens = await makeTestTokens();
});

function setup() {
  const http = new FakeHttpClient();
  const roster = new FakeRoster();
  const codec = new SessionCodec('k'.repeat(32), FixedClock.at('2026-10-13T00:00:00Z'));
  const logged: string[] = [];
  const gate = new PageGate(new Gateway(http, ISSUER, PUBLIC), new TokenVerifier(tokens.keys, ISSUER, AUDIENCE), codec, roster, null, PUBLIC, (l) => logged.push(l));
  return { http, roster, codec, logged, gate };
}

const named = (result: GateResult, name: string) => result.cookies.find((c) => c.startsWith(`${name}=`));

describe('PageGate', () => {
  it('sends a visitor without a session to the gateway, remembering where they were going', async () => {
    const { gate } = setup();
    const result = await gate.handle(new Request(`${PUBLIC}/schedule?view=week`));
    expect(result).toMatchObject({ kind: 'redirect', location: `${ISSUER}/oauth/authorize?redirect_uri=${encodeURIComponent(`${PUBLIC}/`)}&state=${encodeURIComponent('/schedule?view=week')}` });
    expect(named(result, 'planning_return_to')).toContain(encodeURIComponent('/schedule?view=week'));
  });

  it('completes sign-in: exchanges the code, verifies the token, looks up the roster', async () => {
    const { gate, http, roster, codec } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign({ email: 'Ana@Example.com' }) }));
    roster.add('u1', 'Ana Lim', 'ana@example.com');

    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1&state=%2Fschedule`));

    expect(result).toMatchObject({ kind: 'redirect', location: `${PUBLIC}/schedule` });
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))).toMatchObject({ employeeRef: 'u1', email: 'ana@example.com' });
  });

  it('falls back to the return cookie when the gateway drops state', async () => {
    const { gate, http } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign() }));
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`, { headers: { cookie: 'planning_return_to=%2Fsettings%2Froles' } }));
    expect(result).toMatchObject({ location: `${PUBLIC}/settings/roles` });
  });

  it('still signs in, without a roster reference, when the roster is down', async () => {
    const { gate, http, roster, codec, logged } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(200, { token: await tokens.sign() }));
    roster.down = true;
    const result = await gate.handle(new Request(`${PUBLIC}/?code=c-1`));
    expect(codec.decode(cookieValue(named(result, 'planning_session')!))?.employeeRef).toBeNull();
    expect(logged.length).toBeGreaterThan(0);
  });

  it('shows an error page instead of looping when the exchange fails', async () => {
    const { gate, http } = setup();
    http.on('POST', `${ISSUER}/oauth/token`, reply(400, {}));
    expect(await gate.handle(new Request(`${PUBLIC}/?code=bad`))).toMatchObject({ kind: 'error', status: 502 });
  });

  it('lets a live session through and extends it; locks an ended one', async () => {
    const { gate, http, codec } = setup();
    const cookie = `planning_session=${cookieValue(codec.issue({ sid: 's', sub: 'u', email: 'a@x', name: 'A', gatewayRole: 'user', employeeRef: null, expiresAt: 0 }, true))}`;

    http.on('POST', `${ISSUER}/oauth/introspect`, reply(200, { active: true }), reply(200, { active: false }));
    const live = await gate.handle(new Request(`${PUBLIC}/my`, { headers: { cookie } }));
    expect(live.kind).toBe('pass');
    expect(named(live, 'planning_session')).toBeDefined();

    const dead = await gate.handle(new Request(`${PUBLIC}/my`, { headers: { cookie } }));
    expect(dead.kind).toBe('redirect');
    expect(named(dead, 'planning_session')).toContain('Max-Age=0');
  });
});

describe('paths', () => {
  it('knows which paths are pages', () => {
    expect(['/', '/schedule', '/my/', '/settings', '/settings/roles', '/not-on-roster'].every(isPagePath)).toBe(true);
    expect(['/nope', '/robots.txt', '/api/me'].some(isPagePath)).toBe(false);
  });

  it.each([
    ['/schedule?x=1', '/schedule?x=1'], [null, '/'], ['https://evil.test/', '/'], ['//evil.test/x', '/'], ['/\\evil.test', '/'], ['/x\r\nSet-Cookie: a=b', '/'],
  ])('safeReturnPath(%j) is %j', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});
```

Run: `npx vitest run --project unit`
Expected: FAIL.

- [ ] **Step 2: Implement the gate**

`src/server/web/pageGate.ts`:

```ts
import type { DevIdentity } from '../auth/devIdentity';
import type { Gateway } from '../auth/gateway';
import { readCookies, SESSION_COOKIE, type SessionCodec, type SessionData } from '../auth/session';
import type { TokenVerifier } from '../auth/tokens';
import type { Logger } from '../http/kernel';
import type { Roster } from '../roster/roster';

export const RETURN_COOKIE = 'planning_return_to';
export const PAGE_PATHS = ['/', '/schedule', '/my', '/settings', '/not-on-roster'];

export type GateResult =
  | { kind: 'pass'; cookies: string[] }
  | { kind: 'redirect'; location: string; cookies: string[] }
  | { kind: 'error'; status: number; html: string; cookies: string[] };

export function isPagePath(path: string): boolean {
  const clean = path.replace(/\/+$/, '') || '/';
  return PAGE_PATHS.includes(clean) || clean.startsWith('/settings/');
}

export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) return '/';
  return path;
}

/**
 * Sign-in flow for page loads (auth guide §4, §5). A failed code exchange shows an
 * error page rather than redirecting again, so a broken gateway cannot cause a loop.
 * proxy.ts adds Cache-Control: no-store to every result (§7).
 */
export class PageGate {
  constructor(
    private readonly gateway: Gateway,
    private readonly tokens: TokenVerifier,
    private readonly sessions: SessionCodec,
    private readonly roster: Roster,
    private readonly dev: DevIdentity | null,
    private readonly publicUrl: string,
    private readonly log: Logger,
  ) {}

  private get secure(): boolean {
    return this.publicUrl.startsWith('https://');
  }

  async handle(request: Request): Promise<GateResult> {
    const url = new URL(request.url);
    const cookies = readCookies(request);
    const code = url.searchParams.get('code');
    if (code) return this.completeSignIn(url, cookies, code);

    if (this.dev?.allows(request)) return { kind: 'pass', cookies: [] };

    const session = this.sessions.decode(cookies[SESSION_COOKIE]);
    if (!session) return this.toGateway(url);

    const liveness = await this.gateway.liveness(session.sid, session.sub);
    if (liveness === 'dead') {
      const result = this.toGateway(url);
      result.cookies.push(this.sessions.clear(this.secure));
      return result;
    }
    return { kind: 'pass', cookies: liveness === 'live' ? [this.sessions.issue(session, this.secure)] : [] };
  }

  private async completeSignIn(url: URL, cookies: Record<string, string>, code: string): Promise<GateResult> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.tokens.verify(await this.gateway.exchangeCode(code), 'identity');
      if (typeof claims.sid !== 'string' || typeof claims.sub !== 'string') throw new Error('The identity token has no sid or sub.');
    } catch (error) {
      this.log(`[planning-web] sign-in failed: ${(error as Error).message}`);
      return {
        kind: 'error',
        status: 502,
        html: '<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><p>Signing in through InterlinkERP did not work. <a href="/">Try again</a>.</p>',
        cookies: [],
      };
    }

    const email = String(claims.email ?? '').trim().toLowerCase();
    let employeeRef: string | null = null;
    if (email) {
      try {
        employeeRef = (await this.roster.findByEmail(email))?.ref ?? null;
      } catch (error) {
        // Fail soft (auth guide §11): no roster match only means no My Planning yet.
        this.log(`[planning-web] roster lookup failed at sign-in: ${(error as Error).message}`);
      }
    }

    const session: SessionData = {
      sid: claims.sid as string, sub: claims.sub as string, email, name: String(claims.name ?? email),
      gatewayRole: typeof claims.role === 'string' ? claims.role : '', employeeRef, expiresAt: 0,
    };
    const returnPath = safeReturnPath(url.searchParams.get('state') ?? cookies[RETURN_COOKIE]);
    return {
      kind: 'redirect',
      location: `${this.publicUrl}${returnPath}`,
      cookies: [this.sessions.issue(session, this.secure), `${RETURN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`],
    };
  }

  private toGateway(url: URL): GateResult & { kind: 'redirect' } {
    const query = new URLSearchParams(url.searchParams);
    query.delete('code');
    query.delete('state');
    const returnPath = safeReturnPath(`${url.pathname}${query.size ? `?${query}` : ''}`);
    const cookies = returnPath === '/'
      ? []
      : [`${RETURN_COOKIE}=${encodeURIComponent(returnPath)}; Path=/; Max-Age=300; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`];
    return { kind: 'redirect', location: this.gateway.authorizeUrl(returnPath), cookies };
  }
}
```

- [ ] **Step 3: Wire `App` and add the proxy**

Add to `App`:

```ts
  pageGate(): PageGate {
    return this.once('pageGate', () => new PageGate(
      this.gateway(), this.tokenVerifier(), this.sessions(), this.roster(), this.devIdentity(), this.publicUrl(), this.log,
    ));
  }
```

`src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { REQUIRED_ENV } from '@/server/app';
import { requireAll } from '@/server/config/env';
import { getApp } from '@/server/entry';
import { correlationIdFor } from '@/server/http/kernel';
import { envelope } from '@/server/http/responses';
import { isPagePath } from '@/server/web/pageGate';

const NO_STORE: Record<string, string> = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache', Expires: '0' };

function isApiPath(path: string): boolean {
  return path === '/health' || path === '/openapi.json' || path === '/api' || path.startsWith('/api/') || path.startsWith('/internal/');
}

/** Next.js 16 proxy (formerly middleware). Runs on Node.js before every request. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  if (isApiPath(path)) return NextResponse.next();

  if (!isPagePath(path)) {
    // Contract SS-5: an unrouted path gets the JSON envelope, never an HTML page.
    const cid = correlationIdFor(request);
    return NextResponse.json(envelope('RESOURCE_NOT_FOUND', `No route for ${path}.`, cid, null), { status: 404, headers: { 'X-Correlation-ID': cid } });
  }

  try {
    requireAll(REQUIRED_ENV);
  } catch (error) {
    console.error(`[planning-web] ${(error as Error).message}`);
    return new NextResponse('<!doctype html><p>Planning is misconfigured. See the server log.</p>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
  }

  const result = await getApp().pageGate().handle(request);
  const response = result.kind === 'redirect'
    ? NextResponse.redirect(result.location, 302)
    : result.kind === 'error'
      ? new NextResponse(result.html, { status: result.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      : NextResponse.next();
  for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
  for (const cookie of result.cookies) response.headers.append('Set-Cookie', cookie);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: Run tests and check by hand**

```bash
npx vitest run && npm run typecheck && npm run dev
```

Then check:

```bash
curl -i http://127.0.0.1:3000/nope
curl -i http://127.0.0.1:3000/schedule
curl -i -H "X-Forwarded-For: 203.0.113.9" http://127.0.0.1:3000/schedule
```

Expected:
- `/nope` returns 404 with the JSON envelope.
- `/schedule` returns 200 with `Cache-Control: no-store, ...`, because the dev identity passes the gate.
- `/schedule` from a non-loopback forwarded address returns 302 to the gateway's `/oauth/authorize`.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add gateway sign-in page gate and JSON 404 for unknown paths"
```

---

### Task 9: Time intervals, working hours and local days (pure domain)

**Files:**
- Create: `src/server/domain/interval.ts`, `workingHours.ts`, `localDays.ts`
- Test: `src/server/domain/interval.test.ts`, `workingHours.test.ts`, `localDays.test.ts`

**Interfaces:**
- Consumes: `Weekday` and `WorkingHoursMap` from `db/schema.ts`. These are type-only imports, so there is no runtime link to the database.
- Produces:
  - `class Interval(start: number, end: number)` (epoch ms; throws `RangeError` unless end > start), `Interval.of(start, end)` (Date, ISO string or ms), `.overlaps()`, `.intersect(): Interval | null`, `.ms`, `.hours`.
  - `DAYS: Weekday[]`.
  - `class WorkingHoursError extends Error` (its message is safe to show the user).
  - `parseWorkingHours(data: unknown): WorkingHoursMap` (always returns all seven days, sorted).
  - `workingIntervals(hours, fromMs, toMs, zone): Interval[]`.
  - `splitByLocalDay(interval, zone): Map<string, Interval>` (local `YYYY-MM-DD` → the part of the interval on that day).

Nothing in `domain/` may import the database client, HTTP code or `App`.

- [ ] **Step 1: Write the failing tests**

`src/server/domain/interval.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Interval } from './interval';

describe('Interval', () => {
  it('must end after it starts', () => {
    expect(() => Interval.of('2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')).toThrow(RangeError);
  });

  it('treats touching intervals as not overlapping', () => {
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T10:00:00Z').overlaps(Interval.of('2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z'))).toBe(false);
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T10:01:00Z').overlaps(Interval.of('2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z'))).toBe(true);
  });

  it('intersects', () => {
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T12:00:00Z').intersect(Interval.of('2026-10-13T10:30:00Z', '2026-10-13T20:00:00Z'))?.hours).toBe(1.5);
    expect(Interval.of('2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z').intersect(Interval.of('2026-10-13T09:00:00Z', '2026-10-13T10:00:00Z'))).toBeNull();
  });
});
```

`src/server/domain/workingHours.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localMidnight } from '../support/time';
import { DAYS, parseWorkingHours, workingIntervals, WorkingHoursError } from './workingHours';

const day: [string, string][] = [['09:00', '13:00'], ['14:00', '18:00']];
const weekdays = () => parseWorkingHours({ mon: day, tue: day, wed: day, thu: day, fri: day });
const total = (list: { hours: number }[]) => list.reduce((sum, i) => sum + i.hours, 0);
const KL = 'Asia/Kuala_Lumpur';

describe('workingIntervals', () => {
  it('produces a Kuala Lumpur week', () => {
    const from = localMidnight('2026-10-12', KL); // a Monday
    const list = workingIntervals(weekdays(), from, from + 7 * 86_400_000, KL);
    expect(list).toHaveLength(10);
    expect(new Date(list[0].start).toISOString()).toBe('2026-10-12T01:00:00.000Z');
    expect(total(list)).toBe(40);
  });

  it('clips to the range', () => {
    const list = workingIntervals(weekdays(), Date.parse('2026-10-12T11:00:00+08:00'), Date.parse('2026-10-12T16:00:00+08:00'), KL);
    expect(total(list)).toBe(4);
  });

  it('gives a 25-hour day when daylight saving ends', () => {
    const ny = 'America/New_York';
    const list = workingIntervals(parseWorkingHours({ sun: [['00:00', '24:00']] }), localMidnight('2026-11-01', ny), localMidnight('2026-11-02', ny), ny);
    expect(list).toHaveLength(1);
    expect(list[0].hours).toBe(25);
  });
});

describe('parseWorkingHours', () => {
  it('returns all seven days with ranges sorted', () => {
    const hours = parseWorkingHours({ wed: [['14:00', '18:00'], ['08:00', '12:00']] });
    expect(Object.keys(hours)).toEqual(DAYS);
    expect(hours.wed).toEqual([['08:00', '12:00'], ['14:00', '18:00']]);
    expect(hours.mon).toEqual([]);
  });

  it.each([
    [{ fun: [] }, 'Unknown weekday "fun"'],
    [{ mon: 'nine to five' }, 'mon: give a list'],
    [{ mon: [['9:00', '13:00']] }, 'mon: each range'],
    [{ mon: [['13:00', '09:00']] }, 'must end after it starts'],
    [{ mon: [['09:00', '13:00'], ['12:00', '14:00']] }, 'mon: ranges overlap'],
    [{ mon: [['09:00', '25:00']] }, 'mon: each range'],
    ['not an object', 'Give an object keyed by weekday'],
  ])('rejects %j', (data, message) => {
    expect(() => parseWorkingHours(data)).toThrow(WorkingHoursError);
    expect(() => parseWorkingHours(data)).toThrow(message);
  });
});
```

`src/server/domain/localDays.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Interval } from './interval';
import { splitByLocalDay } from './localDays';

describe('splitByLocalDay', () => {
  it('splits an overnight shift at local midnight', () => {
    const days = splitByLocalDay(Interval.of('2026-10-12T22:00:00+08:00', '2026-10-13T06:00:00+08:00'), 'Asia/Kuala_Lumpur');
    expect([...days.keys()]).toEqual(['2026-10-12', '2026-10-13']);
    expect(days.get('2026-10-12')?.hours).toBe(2);
    expect(days.get('2026-10-13')?.hours).toBe(6);
  });

  it('keeps a same-day shift whole', () => {
    expect([...splitByLocalDay(Interval.of('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00'), 'Asia/Kuala_Lumpur').keys()]).toEqual(['2026-10-12']);
  });

  it('keeps the long daylight-saving day as one piece', () => {
    const days = splitByLocalDay(Interval.of('2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'), 'America/New_York');
    expect([...days.keys()]).toEqual(['2026-11-01']);
    expect(days.get('2026-11-01')?.hours).toBe(25);
  });
});
```

New York's local midnight is `04:00Z` on 1 November (still on daylight-saving time) and `05:00Z` on 2 November (on standard time).

Run: `npx vitest run --project unit`
Expected: FAIL (missing modules).

- [ ] **Step 2: Implement the three modules**

`src/server/domain/interval.ts`:

```ts
const toMs = (v: Date | number | string) => (typeof v === 'number' ? v : new Date(v).getTime());

/** A half-open span of time [start, end) in epoch milliseconds. */
export class Interval {
  constructor(readonly start: number, readonly end: number) {
    if (!(end > start)) throw new RangeError('An interval must end after it starts.');
  }

  static of(start: Date | number | string, end: Date | number | string): Interval {
    return new Interval(toMs(start), toMs(end));
  }

  overlaps(other: Interval): boolean {
    return this.start < other.end && other.start < this.end;
  }

  intersect(other: Interval): Interval | null {
    const start = Math.max(this.start, other.start);
    const end = Math.min(this.end, other.end);
    return start < end ? new Interval(start, end) : null;
  }

  get ms(): number {
    return this.end - this.start;
  }

  get hours(): number {
    return this.ms / 3_600_000;
  }
}
```

`src/server/domain/workingHours.ts`:

```ts
import { DateTime } from 'luxon';
import type { Weekday, WorkingHoursMap } from '../db/schema';
import { Interval } from './interval';

export const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export class WorkingHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkingHoursError';
  }
}

const validTime = (t: unknown): t is string => typeof t === 'string' && (t === '24:00' || /^([01]\d|2[0-3]):[0-5]\d$/.test(t));

/** FR-CFG-02: an employee's regular weekly schedule, in local wall-clock time. */
export function parseWorkingHours(data: unknown): WorkingHoursMap {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new WorkingHoursError('Give an object keyed by weekday (mon to sun).');
  const hours = Object.fromEntries(DAYS.map((d) => [d, [] as [string, string][]])) as WorkingHoursMap;
  for (const [day, ranges] of Object.entries(data)) {
    if (!DAYS.includes(day as Weekday)) throw new WorkingHoursError(`Unknown weekday "${day}"; use mon to sun.`);
    if (!Array.isArray(ranges)) throw new WorkingHoursError(`${day}: give a list of [from, to] pairs.`);
    const clean: [string, string][] = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2 || !validTime(range[0]) || !validTime(range[1])) {
        throw new WorkingHoursError(`${day}: each range is ["HH:MM", "HH:MM"] between 00:00 and 24:00.`);
      }
      if (range[0] >= range[1]) throw new WorkingHoursError(`${day}: ${range[0]}-${range[1]} must end after it starts.`);
      clean.push([range[0], range[1]]);
    }
    clean.sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 1; i < clean.length; i++) {
      if (clean[i][0] < clean[i - 1][1]) throw new WorkingHoursError(`${day}: ranges overlap.`);
    }
    hours[day as Weekday] = clean;
  }
  return hours;
}

function at(localMidnight: DateTime, hhmm: string): number {
  if (hhmm === '24:00') return localMidnight.plus({ days: 1 }).toMillis();
  const [hour, minute] = hhmm.split(':').map(Number);
  return localMidnight.set({ hour, minute }).toMillis();
}

/** Working time inside [fromMs, toMs), as intervals. Luxon handles daylight-saving days. */
export function workingIntervals(hours: WorkingHoursMap, fromMs: number, toMs: number, zone: string): Interval[] {
  const range = new Interval(fromMs, toMs);
  const out: Interval[] = [];
  const end = DateTime.fromMillis(toMs, { zone });
  for (let day = DateTime.fromMillis(fromMs, { zone }).startOf('day'); day < end; day = day.plus({ days: 1 })) {
    for (const [from, to] of hours[DAYS[day.weekday - 1]]) {
      const piece = new Interval(at(day, from), at(day, to)).intersect(range);
      if (piece) out.push(piece);
    }
  }
  return out;
}
```

`src/server/domain/localDays.ts`:

```ts
import { DateTime } from 'luxon';
import { Interval } from './interval';

/** Local date (YYYY-MM-DD) -> the part of `interval` that falls on it. */
export function splitByLocalDay(interval: Interval, zone: string): Map<string, Interval> {
  const out = new Map<string, Interval>();
  let cursor = interval.start;
  while (cursor < interval.end) {
    const local = DateTime.fromMillis(cursor, { zone });
    const nextMidnight = local.startOf('day').plus({ days: 1 }).toMillis();
    const pieceEnd = Math.min(nextMidnight, interval.end);
    out.set(local.toISODate()!, new Interval(cursor, pieceEnd));
    cursor = pieceEnd;
  }
  return out;
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run --project unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/domain
git commit -m "feat: add time interval, working hours and local day calculations"
```

---

### Task 10: Allocation (BR-04) and conflicts (BR-01) as pure rules

**Files:**
- Create: `src/server/domain/allocation.ts`, `src/server/domain/conflicts.ts`
- Test: `src/server/domain/allocation.test.ts`, `src/server/domain/conflicts.test.ts`

**Interfaces:**
- Consumes: `Interval`, `splitByLocalDay`, `parseWorkingHours`, `workingIntervals`.
- Produces:
  - `interface ShiftFacts { id; employeeRef: string | null; roleId: string | null; interval: Interval; breakMinutes; percent }`.
  - `shiftHours(f): number`.
  - `allocatedByDay(shifts, zone): Record<string, number>` and `availableByDay(working, unavailable, zone): Record<string, number>`. Both use sorted local dates and round to 2 decimals.
  - `overAllocatedDays(allocated, available | null): string[]` and `subtract(base, cuts): Interval[]`.
  - `interface Conflict { rule: 'overlap' | 'unavailable' | 'role'; message: string }`.
  - `interface UnavailableSpan { interval; kind: 'time_off' | 'holiday'; label }`.
  - `conflictsForEmployee(shifts, unavailable, employeeRoleIds): Map<string, Conflict[]>` (every shift id is a key) and `peakPercent(shift, all): number`.

The rules, from the spec:
- **BR-01:** a shift conflicts when any of these is true:
  - (a) the overlapping shifts, counting itself, add up to more than 100% at some moment;
  - (b) it overlaps time off or a public holiday;
  - (c) its role isn't one of the employee's roles. This is checked only when the employee has roles.

  Open shifts never conflict, and over-allocation is not a conflict.
- **BR-04:**
  - Allocated hours = (duration − break) × percent. Time outside working hours counts.
  - Available hours per day = working hours minus unavailability. Flexible-hours employees have no limit.
  - A day is over-allocated when allocated hours exceed available hours.
  - A shift spanning midnight counts on each day it covers, and its break is shared out in proportion to the time on each day.

- [ ] **Step 1: Write the failing tests**

`src/server/domain/allocation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localMidnight } from '../support/time';
import { allocatedByDay, availableByDay, overAllocatedDays, type ShiftFacts, shiftHours, subtract } from './allocation';
import { Interval } from './interval';
import { parseWorkingHours, workingIntervals } from './workingHours';

const KL = 'Asia/Kuala_Lumpur';
const shift = (start: string, end: string, breakMinutes = 0, percent = 100): ShiftFacts =>
  ({ id: 's1', employeeRef: 'E1', roleId: null, interval: Interval.of(start, end), breakMinutes, percent });

describe('allocation', () => {
  it('subtracts the break and applies the percentage', () => {
    expect(shiftHours(shift('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00', 60))).toBe(7);
    expect(shiftHours(shift('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00', 60, 50))).toBe(3.5);
  });

  it('counts an overnight shift on both days and shares the break', () => {
    expect(allocatedByDay([shift('2026-10-12T22:00:00+08:00', '2026-10-13T06:00:00+08:00', 60)], KL)).toEqual({ '2026-10-12': 1.75, '2026-10-13': 5.25 });
  });

  it('takes time off out of available hours', () => {
    const from = localMidnight('2026-10-12', KL);
    const working = workingIntervals(parseWorkingHours({ mon: [['09:00', '13:00'], ['14:00', '18:00']] }), from, from + 86_400_000, KL);
    expect(availableByDay(working, [Interval.of('2026-10-12T14:00:00+08:00', '2026-10-12T18:00:00+08:00')], KL)).toEqual({ '2026-10-12': 4 });
  });

  it('flags days over the available hours, including days with none', () => {
    const allocated = { '2026-10-12': 9, '2026-10-13': 2, '2026-10-17': 4 };
    expect(overAllocatedDays(allocated, { '2026-10-12': 8, '2026-10-13': 8 })).toEqual(['2026-10-12', '2026-10-17']);
    expect(overAllocatedDays(allocated, null)).toEqual([]);
  });

  it('subtracts a cut from the middle', () => {
    const pieces = subtract(Interval.of('2026-10-12T00:00:00Z', '2026-10-12T10:00:00Z'), [Interval.of('2026-10-12T04:00:00Z', '2026-10-12T06:00:00Z')]);
    expect(pieces.map((p) => p.hours)).toEqual([4, 4]);
  });
});
```

`src/server/domain/conflicts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ShiftFacts } from './allocation';
import { conflictsForEmployee, peakPercent, type UnavailableSpan } from './conflicts';
import { Interval } from './interval';

const at = (hhmm: string) => `2026-10-12T${hhmm}:00+08:00`;
const shift = (id: string, from: string, to: string, percent = 100, roleId: string | null = null): ShiftFacts =>
  ({ id, employeeRef: 'E1', roleId, interval: Interval.of(at(from), at(to)), breakMinutes: 0, percent });
const rules = (map: Map<string, { rule: string }[]>, id: string) => map.get(id)!.map((c) => c.rule);

describe('conflicts (BR-01)', () => {
  it('flags both of two full overlapping shifts', () => {
    const result = conflictsForEmployee([shift('a', '09:00', '13:00'), shift('b', '12:00', '17:00')], [], []);
    expect(rules(result, 'a')).toEqual(['overlap']);
    expect(rules(result, 'b')).toEqual(['overlap']);
  });

  it('allows two half-time shifts to overlap, and back-to-back shifts', () => {
    expect(rules(conflictsForEmployee([shift('a', '09:00', '17:00', 50), shift('b', '09:00', '17:00', 50)], [], []), 'a')).toEqual([]);
    expect(rules(conflictsForEmployee([shift('a', '09:00', '13:00'), shift('b', '13:00', '17:00')], [], []), 'a')).toEqual([]);
  });

  it('measures the peak inside the shift', () => {
    const all = [shift('a', '09:00', '17:00', 60), shift('b', '09:00', '11:00', 30), shift('c', '15:00', '17:00', 30)];
    expect(peakPercent(all[0], all)).toBe(90);
  });

  it('describes time off and holidays', () => {
    const leave: UnavailableSpan = { interval: Interval.of(at('12:00'), at('18:00')), kind: 'time_off', label: 'Medical appointment' };
    const result = conflictsForEmployee([shift('a', '09:00', '13:00'), shift('b', '08:00', '12:00')], [leave], []);
    expect(result.get('a')![0].message).toBe('The employee is on time off: Medical appointment.');
    expect(result.get('b')).toEqual([]);

    const holiday: UnavailableSpan = { interval: Interval.of(at('00:00'), at('23:59')), kind: 'holiday', label: 'Deepavali' };
    expect(conflictsForEmployee([shift('a', '09:00', '13:00')], [holiday], []).get('a')![0].message).toBe('Falls on a public holiday: Deepavali.');
  });

  it('checks the role only when the employee has roles', () => {
    const s = shift('a', '09:00', '13:00', 100, 'tech');
    expect(rules(conflictsForEmployee([s], [], ['reception']), 'a')).toEqual(['role']);
    expect(rules(conflictsForEmployee([s], [], ['tech']), 'a')).toEqual([]);
    expect(rules(conflictsForEmployee([s], [], []), 'a')).toEqual([]);
  });
});
```

Run: `npx vitest run --project unit`
Expected: FAIL.

- [ ] **Step 2: Implement the rules**

`src/server/domain/allocation.ts`:

```ts
import { Interval } from './interval';
import { splitByLocalDay } from './localDays';

/** The parts of a shift the planning rules need. */
export interface ShiftFacts {
  id: string;
  employeeRef: string | null;
  roleId: string | null;
  interval: Interval;
  breakMinutes: number;
  percent: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function sortedRounded(byDay: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, h]) => [d, round2(h)]));
}

/** BR-04: (duration - break) x percent, never negative. */
export function shiftHours(f: ShiftFacts): number {
  const paidMs = Math.max(0, f.interval.ms - f.breakMinutes * 60_000);
  return round2((paidMs / 3_600_000) * (f.percent / 100));
}

export function allocatedByDay(shifts: ShiftFacts[], zone: string): Record<string, number> {
  const byDay = new Map<string, number>();
  for (const f of shifts) {
    const paidRatio = Math.max(0, f.interval.ms - f.breakMinutes * 60_000) / f.interval.ms;
    for (const [date, piece] of splitByLocalDay(f.interval, zone)) {
      byDay.set(date, (byDay.get(date) ?? 0) + piece.hours * paidRatio * (f.percent / 100));
    }
  }
  return sortedRounded(byDay);
}

export function availableByDay(working: Interval[], unavailable: Interval[], zone: string): Record<string, number> {
  const byDay = new Map<string, number>();
  for (const interval of working) {
    for (const piece of subtract(interval, unavailable)) {
      for (const [date, part] of splitByLocalDay(piece, zone)) byDay.set(date, (byDay.get(date) ?? 0) + part.hours);
    }
  }
  return sortedRounded(byDay);
}

/** @param available null = flexible hours, never over-allocated */
export function overAllocatedDays(allocated: Record<string, number>, available: Record<string, number> | null): string[] {
  if (!available) return [];
  return Object.entries(allocated).filter(([date, hours]) => hours > (available[date] ?? 0) + 0.005).map(([date]) => date);
}

export function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let pieces = [base];
  for (const cut of cuts) {
    pieces = pieces.flatMap((piece) => {
      if (!piece.overlaps(cut)) return [piece];
      const left = cut.start > piece.start ? [new Interval(piece.start, cut.start)] : [];
      const right = cut.end < piece.end ? [new Interval(cut.end, piece.end)] : [];
      return [...left, ...right];
    });
  }
  return pieces;
}
```

`src/server/domain/conflicts.ts`:

```ts
import type { ShiftFacts } from './allocation';
import type { Interval } from './interval';

export interface Conflict {
  rule: 'overlap' | 'unavailable' | 'role';
  message: string;
}

export interface UnavailableSpan {
  interval: Interval;
  kind: 'time_off' | 'holiday';
  label: string;
}

/** Highest total allocated percentage at any moment inside `shift`, counting `shift` itself. */
export function peakPercent(shift: ShiftFacts, all: ShiftFacts[]): number {
  const events: [number, number][] = [];
  for (const other of all) {
    const overlap = other.interval.intersect(shift.interval);
    if (!overlap) continue;
    events.push([overlap.start, other.percent], [overlap.end, -other.percent]);
  }
  // At the same instant, endings (negative) come first, so back-to-back shifts never add up.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

/**
 * BR-01 for ONE employee's shifts (open shifts are never passed in).
 * @param employeeRoleIds empty = the role rule is not checked
 */
export function conflictsForEmployee(shifts: ShiftFacts[], unavailable: UnavailableSpan[], employeeRoleIds: string[]): Map<string, Conflict[]> {
  const result = new Map<string, Conflict[]>();
  for (const shift of shifts) {
    const conflicts: Conflict[] = [];
    const peak = peakPercent(shift, shifts);
    if (peak > 100) conflicts.push({ rule: 'overlap', message: `Overlaps other shifts; allocation reaches ${peak}%.` });
    const away = unavailable.find((span) => span.interval.overlaps(shift.interval));
    if (away) {
      conflicts.push({
        rule: 'unavailable',
        message: away.kind === 'holiday' ? `Falls on a public holiday: ${away.label}.` : `The employee is on time off${away.label ? `: ${away.label}` : ''}.`,
      });
    }
    if (shift.roleId && employeeRoleIds.length > 0 && !employeeRoleIds.includes(shift.roleId)) {
      conflicts.push({ rule: 'role', message: "The employee does not have this shift's role." });
    }
    result.set(shift.id, conflicts);
  }
  return result;
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run --project unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/domain
git commit -m "feat: add allocation and conflict rules"
```

---

### Task 11: Input validation, API test harness, settings and roles

**Files:**
- Create: `src/server/http/input.ts`, `src/server/support/ids.ts`
- Create: `src/server/repo/settings.ts`, `src/server/repo/roles.ts`, `src/server/routes/settings.ts`, `src/server/routes/roles.ts`
- Create: `src/server/holidays/provider.ts`, `src/server/test/harness.ts`
- Modify: `src/server/test/fakes.ts` (add `FakeHolidayProvider`), `src/server/app.ts`, `src/server/routes/index.ts`, `src/server/http/catalog.ts`
- Test: `src/server/http/input.test.ts`, `src/server/routes/settings.int.test.ts`, `src/server/routes/roles.int.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces:
  - `class Input(data)` with these methods:
    - `.has(key)`, `.raw(key)`
    - `.string(key, max, required?): string | null`
    - `.int(key, min, max, fallback?): number | null`
    - `.bool(key, fallback?): boolean`
    - `.instant(key, required?): Date | null` (UTC, truncated to the minute)
    - `.date(key, required?): string | null`
    - `.dateRange(fromKey, toKey, maxDays): [string, string] | null`
    - `.stringList(key, maxItems, required?): string[] | null`
    - `.error(key, msg)`, `.check()` (throws a 422 `HttpError`)
  - `isUuid(value): boolean` and `isUniqueViolation(error): boolean`.
  - `interface OrgSettings { country_code: string | null; region_code: string | null; timezone: string }`.
  - `class SettingsRepository(db, org, defaultTimezone)` with `.get()`, `.timezone()` and `.save(settings, now)`.
  - `interface Role { id; name; color; archived }`.
  - `class RoleRepository(db, org)` with `.all(includeArchived = true)`, `.find(id)`, `.ids(): Map<string, boolean>`, `.nameTaken(name, exceptId)`, `.create(name, color, now)` and `.update(id, fields, now)`.
  - `interface HolidayProvider { isConfigured(): boolean; holidays(year, country, region): Promise<{ key; date; name }[]> }` and `nullHolidayProvider`.
  - Endpoints:
    - `GET /api/roles` (person; `?include_archived=true` includes archived roles)
    - `POST /api/roles` and `PATCH /api/roles/{id}` (manager)
    - `GET /api/settings` and `PATCH /api/settings` (manager)
  - `useApiHarness(): Harness` with:
    - `app`, `clock` (2026-10-13T02:00:00Z, a Tuesday), `roster`, `departments`, `holidays`, `database`
    - `asManager(email?)`, `asEmployee(ref, email?)`, `asNobody()`
    - `call(method, path, body?, query?): Promise<{ status; body }>`
    - `addEmployee(ref, name, departmentId?, departmentName?)`
    - `addRole(name, color?): Promise<string>`
  - `AppDeps` gains `holidayProvider?`. New `App` getters: `defaultTimezone()`, `settings()`, `roles()`, `holidayProvider()`.

- [ ] **Step 1: Write the failing `Input` test and implement `Input`**

`src/server/http/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { Input } from './input';

function errors(input: Input): Record<string, string> {
  try {
    input.check();
    return {};
  } catch (e) {
    return (e as HttpError).details as Record<string, string>;
  }
}

describe('Input', () => {
  it('needs an offset on instants, stores UTC, and drops seconds', () => {
    const input = new Input({ a: '2026-10-13T09:00:30+08:00', b: '2026-10-13T09:00:00', c: '2026-02-30T09:00:00+08:00' });
    expect(input.instant('a')?.toISOString()).toBe('2026-10-13T01:00:00.000Z');
    expect(input.instant('b')).toBeNull();
    expect(input.instant('c')).toBeNull();
    expect(errors(input).b).toContain('time zone offset');
    expect(errors(input).c).toBe('Not a real date-time.');
  });

  it('checks required strings and lengths', () => {
    const input = new Input({ name: '  ', long: 'xxxxxx' });
    input.string('name', 10, true);
    input.string('long', 5);
    expect(errors(input)).toEqual({ name: 'This field is required.', long: 'Must be at most 5 characters.' });
  });

  it('accepts only whole numbers in range', () => {
    const input = new Input({ a: '5', b: 101, c: 50 });
    expect(input.int('a', 1, 100, 1)).toBe(1);
    input.int('b', 1, 100);
    expect(input.int('c', 1, 100)).toBe(50);
    expect(errors(input)).toEqual({ a: 'Must be a whole number.', b: 'Must be between 1 and 100.' });
  });

  it('validates dates and ranges', () => {
    expect(new Input({ from: '2026-10-12', to: '2026-10-18' }).dateRange('from', 'to', 62)).toEqual(['2026-10-12', '2026-10-18']);
    const bad = new Input({ d: '2026-13-01' });
    expect(bad.date('d')).toBeNull();
    const long = new Input({ from: '2026-01-01', to: '2026-12-31' });
    expect(long.dateRange('from', 'to', 62)).toBeNull();
    expect(errors(long)).toEqual({ to: 'The range can be at most 62 days.' });
    expect(new Input({ from: '2026-10-12', to: '2026-10-11' }).dateRange('from', 'to', 62)).toBeNull();
  });

  it('reads string lists', () => {
    const input = new Input({ ok: ['a', 'b', 'a'], bad: ['a', 3], obj: { x: 'a' } });
    expect(input.stringList('ok', 10)).toEqual(['a', 'b']);
    expect(input.stringList('bad', 10)).toBeNull();
    expect(input.stringList('obj', 10)).toBeNull();
    expect(Object.keys(errors(input))).toEqual(['bad', 'obj']);
  });
});
```

Run it (expect FAIL), then create `src/server/http/input.ts`:

```ts
import { DateTime } from 'luxon';
import { HttpError } from './errors';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads and validates one request body or query string, collecting every
 * problem so the caller gets all field errors in one 422 (contract SS-11).
 */
export class Input {
  private readonly errors: Record<string, string> = {};

  constructor(private readonly data: Record<string, unknown>) {}

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  raw(key: string): unknown {
    return this.data[key];
  }

  string(key: string, max: number, required = false): string | null {
    const value = this.data[key];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (typeof value !== 'string') {
      this.error(key, 'Must be a string.');
      return null;
    }
    const trimmed = value.trim();
    if ([...trimmed].length > max) {
      this.error(key, `Must be at most ${max} characters.`);
      return null;
    }
    return trimmed;
  }

  int(key: string, min: number, max: number, fallback: number | null = null): number | null {
    const value = this.data[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.error(key, 'Must be a whole number.');
      return fallback;
    }
    if (value < min || value > max) {
      this.error(key, `Must be between ${min} and ${max}.`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback = false): boolean {
    const value = this.data[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') {
      this.error(key, 'Must be true or false.');
      return fallback;
    }
    return value;
  }

  /** ISO 8601 with an explicit offset; returned as a UTC Date, seconds dropped. */
  instant(key: string, required = false): Date | null {
    const value = this.data[key];
    if (value === undefined || value === null || value === '') {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (typeof value !== 'string' || !INSTANT.test(value)) {
      this.error(key, 'Use an ISO 8601 date-time with a time zone offset, e.g. 2026-10-13T09:00:00+08:00.');
      return null;
    }
    const parsed = DateTime.fromISO(value, { setZone: true });
    if (!parsed.isValid || parsed.toISODate() !== value.slice(0, 10)) {
      this.error(key, 'Not a real date-time.');
      return null;
    }
    return parsed.toUTC().startOf('minute').toJSDate();
  }

  date(key: string, required = false): string | null {
    const value = this.data[key];
    if (value === undefined || value === null || value === '') {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (typeof value !== 'string' || !DATE.test(value) || DateTime.fromISO(value).toISODate() !== value) {
      this.error(key, 'Use a real date in YYYY-MM-DD format.');
      return null;
    }
    return value;
  }

  /** Inclusive [from, to]. */
  dateRange(fromKey: string, toKey: string, maxDays: number): [string, string] | null {
    const from = this.date(fromKey, true);
    const to = this.date(toKey, true);
    if (!from || !to) return null;
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days < 1) {
      this.error(toKey, `Must be on or after ${fromKey}.`);
      return null;
    }
    if (days > maxDays) {
      this.error(toKey, `The range can be at most ${maxDays} days.`);
      return null;
    }
    return [from, to];
  }

  stringList(key: string, maxItems: number, required = false): string[] | null {
    const value = this.data[key];
    if (value === undefined || value === null) {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (!Array.isArray(value) || value.length > maxItems) {
      this.error(key, `Must be a list of at most ${maxItems} strings.`);
      return null;
    }
    if (!value.every((item) => typeof item === 'string' && item !== '' && item.length <= 64)) {
      this.error(key, 'Every item must be a non-empty string of at most 64 characters.');
      return null;
    }
    return [...new Set(value as string[])];
  }

  error(key: string, message: string): void {
    this.errors[key] ??= message;
  }

  check(): void {
    if (Object.keys(this.errors).length > 0) throw HttpError.validation(this.errors);
  }
}
```

Run: `npx vitest run --project unit`
Expected: PASS.

- [ ] **Step 2: Add the small helpers, holiday provider contract and test harness**

`src/server/support/ids.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgreSQL rejects a malformed uuid with an error, so repositories check first and treat it as "not found". */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** PostgreSQL unique_violation (23505), however Drizzle wrapped it. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
```

`src/server/holidays/provider.ts`:

```ts
/** IF-06. Which provider to use is open issue OI-02; add one adapter when it is decided. */
export interface HolidayProvider {
  isConfigured(): boolean;
  /** `key` must stay the same across syncs for the same holiday. */
  holidays(year: number, countryCode: string, regionCode: string | null): Promise<{ key: string; date: string; name: string }[]>;
}

export const nullHolidayProvider: HolidayProvider = {
  isConfigured: () => false,
  holidays: async () => [],
};
```

Append to `src/server/test/fakes.ts` (with `import type { HolidayProvider } from '../holidays/provider';` at the top):

```ts
export class FakeHolidayProvider implements HolidayProvider {
  configured = false;
  list: { key: string; date: string; name: string }[] = [];
  readonly calls: [number, string, string | null][] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async holidays(year: number, country: string, region: string | null) {
    this.calls.push([year, country, region]);
    return this.list.map((h) => ({ ...h }));
  }
}
```

`src/server/test/harness.ts`:

```ts
import { beforeEach, expect } from 'vitest';
import { App } from '../app';
import type { Principal } from '../auth/principal';
import type { Database } from '../db/client';
import { employeeDirectory } from '../db/schema';
import { HttpError } from '../http/errors';
import type { AccessGuard } from '../http/kernel';
import { ORG, useTestDatabase } from './db';
import { FakeDepartments, FakeHolidayProvider, FakeRoster, FixedClock } from './fakes';

export interface Harness {
  app: App;
  database: Database;
  clock: FixedClock;
  roster: FakeRoster;
  departments: FakeDepartments;
  holidays: FakeHolidayProvider;
  asManager(email?: string): void;
  asEmployee(ref: string | null, email?: string): void;
  asNobody(): void;
  call(method: string, path: string, body?: unknown, query?: Record<string, string | number>): Promise<{ status: number; body: any }>;
  addEmployee(ref: string, name: string, departmentId?: string | null, departmentName?: string | null): Promise<void>;
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
    async check(route) {
      if (route.access === 'public' || route.access === 'internal') return { principal: null, cookies: [] };
      if (!principal) throw HttpError.unauthorized('Not signed in.');
      if (route.access === 'manager' && !principal.isManager) throw HttpError.forbidden('Only Planning Managers can do this.');
      return { principal, cookies: [] };
    },
  };

  const h = {
    database,
    asManager: (email = 'mona@example.com') => {
      principal = person(email, true, null);
    },
    asEmployee: (ref: string | null, email = 'ana@example.com') => {
      principal = person(email, false, ref);
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
    async addEmployee(ref: string, name: string, departmentId: string | null = null, departmentName: string | null = null) {
      await database.db.insert(employeeDirectory).values({ organisationId: ORG, employeeRef: ref, displayName: name, departmentId, departmentName, status: 'Active', fetchedAt: h.clock.now() });
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
    h.app = new App({
      database, organisationId: ORG, defaultTimezone: 'Asia/Kuala_Lumpur', clock: h.clock, guard, devIdentity: null,
      roster: h.roster, departments: h.departments, holidayProvider: h.holidays, logger: () => {},
    });
    h.asManager();
  });

  return h;
}
```


- [ ] **Step 3: Write the failing API tests**

`src/server/routes/settings.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

describe('settings API', () => {
  it('defaults to the configured time zone', async () => {
    expect((await h.call('GET', '/api/settings')).body.settings).toEqual({ country_code: null, region_code: null, timezone: 'Asia/Kuala_Lumpur' });
  });

  it('saves and keeps absent fields', async () => {
    await h.call('PATCH', '/api/settings', { country_code: 'MY', region_code: 'MY-10' });
    const { status, body } = await h.call('PATCH', '/api/settings', { timezone: 'Asia/Singapore' });
    expect(status).toBe(200);
    expect(body.settings).toEqual({ country_code: 'MY', region_code: 'MY-10', timezone: 'Asia/Singapore' });
  });

  it('names every invalid field', async () => {
    const { status, body } = await h.call('PATCH', '/api/settings', { country_code: 'my', timezone: 'Mars/Olympus' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['country_code', 'timezone']);
  });

  it('is for managers only', async () => {
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/settings')).status).toBe(403);
  });
});
```

`src/server/routes/roles.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

describe('roles API (FR-CFG-01)', () => {
  it('creates and lists', async () => {
    const { status, body } = await h.call('POST', '/api/roles', { name: ' Technician ', color: '#22c55e' });
    expect(status).toBe(201);
    expect(body.role).toMatchObject({ name: 'Technician', color: '#22C55E', archived: false });

    h.asEmployee('E1');
    expect((await h.call('GET', '/api/roles')).body.roles.map((r: { name: string }) => r.name)).toEqual(['Technician']);
  });

  it('refuses a duplicate name regardless of case', async () => {
    await h.addRole('Technician');
    const { status, body } = await h.call('POST', '/api/roles', { name: 'technician', color: '#000000' });
    expect([status, body.error.code]).toEqual([409, 'ROLE_NAME_TAKEN']);
  });

  it('names invalid fields', async () => {
    const { status, body } = await h.call('POST', '/api/roles', { name: '', color: 'green' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['name', 'color']);
  });

  it('renames and archives; archived roles are hidden by default', async () => {
    const id = await h.addRole('Technician');
    const { body } = await h.call('PATCH', `/api/roles/${id}`, { name: 'Field Technician', archived: true });
    expect(body.role).toMatchObject({ name: 'Field Technician', archived: true });
    expect((await h.call('GET', '/api/roles')).body.roles).toEqual([]);
    expect((await h.call('GET', '/api/roles', undefined, { include_archived: 'true' })).body.roles).toHaveLength(1);
  });

  it('returns 404, 403 and 401 where it should', async () => {
    expect((await h.call('PATCH', '/api/roles/not-a-uuid', { name: 'X' })).status).toBe(404);
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/roles', { name: 'X', color: '#000000' })).status).toBe(403);
    h.asNobody();
    expect((await h.call('GET', '/api/roles')).status).toBe(401);
  });
});
```

Run: `npm run test:integration`
Expected: FAIL (404s, and the `App` deps don't exist yet).

- [ ] **Step 4: Implement the repositories**

`src/server/repo/settings.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { organisationSettings } from '../db/schema';

export interface OrgSettings {
  country_code: string | null;
  region_code: string | null;
  timezone: string;
}

export class SettingsRepository {
  constructor(private readonly db: Db, private readonly org: string, private readonly defaultTimezone: string) {}

  async get(): Promise<OrgSettings> {
    const [row] = await this.db.select().from(organisationSettings).where(eq(organisationSettings.organisationId, this.org)).limit(1);
    return row ? { country_code: row.countryCode, region_code: row.regionCode, timezone: row.timezone } : { country_code: null, region_code: null, timezone: this.defaultTimezone };
  }

  async timezone(): Promise<string> {
    return (await this.get()).timezone;
  }

  async save(settings: OrgSettings, now: Date): Promise<void> {
    const values = { countryCode: settings.country_code, regionCode: settings.region_code, timezone: settings.timezone, updatedAt: now };
    await this.db.insert(organisationSettings).values({ organisationId: this.org, ...values })
      .onConflictDoUpdate({ target: organisationSettings.organisationId, set: values });
  }
}
```

`src/server/repo/roles.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roles } from '../db/schema';
import { isUuid } from '../support/ids';

export interface Role {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

const toRole = (r: typeof roles.$inferSelect): Role => ({ id: r.id, name: r.name, color: r.color, archived: r.archivedAt !== null });

export class RoleRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async all(includeArchived = true): Promise<Role[]> {
    const where = includeArchived ? eq(roles.organisationId, this.org) : and(eq(roles.organisationId, this.org), isNull(roles.archivedAt));
    return (await this.db.select().from(roles).where(where).orderBy(roles.name)).map(toRole);
  }

  async find(id: string): Promise<Role | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(roles).where(and(eq(roles.organisationId, this.org), eq(roles.id, id))).limit(1);
    return row ? toRole(row) : null;
  }

  /** role id -> archived */
  async ids(): Promise<Map<string, boolean>> {
    return new Map((await this.all()).map((r) => [r.id, r.archived]));
  }

  async nameTaken(name: string, exceptId: string | null): Promise<boolean> {
    const conditions = [eq(roles.organisationId, this.org), sql`lower(${roles.name}) = lower(${name})`];
    if (exceptId) conditions.push(ne(roles.id, exceptId));
    return (await this.db.select({ id: roles.id }).from(roles).where(and(...conditions)).limit(1)).length > 0;
  }

  async create(name: string, color: string, now: Date): Promise<Role> {
    const [row] = await this.db.insert(roles).values({ id: randomUUID(), organisationId: this.org, name, color, createdAt: now, updatedAt: now }).returning();
    return toRole(row);
  }

  async update(id: string, fields: { name?: string; color?: string; archived?: boolean }, now: Date): Promise<Role> {
    const [row] = await this.db.update(roles).set({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.color !== undefined ? { color: fields.color } : {}),
      ...(fields.archived !== undefined ? { archivedAt: fields.archived ? sql`coalesce(${roles.archivedAt}, ${now})` : null } : {}),
      updatedAt: now,
    }).where(and(eq(roles.organisationId, this.org), eq(roles.id, id))).returning();
    return toRole(row);
  }
}
```

- [ ] **Step 5: Implement the routes**

`src/server/routes/settings.ts`:

```ts
import type { App } from '../app';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { isTimezone } from '../support/time';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/settings', 'manager', 'Read organisation planning settings.', async () => json(200, { settings: await app.settings().get() }),
    op('Read Settings', 'See the organisation country, region and time zone', ['Showing the settings page'], ["Reading an employee's time zone"],
      [], ['settings.country_code', 'settings.region_code', 'settings.timezone'], ['Planning Manager'], ['PATCH /api/settings'],
      ['settings', 'configuration', 'time zone', 'country']));

  r.add('PATCH', '/api/settings', 'manager', 'Change organisation planning settings.', async ({ body }) => {
    const current = await app.settings().get();
    const input = new Input(await body());
    const country = input.has('country_code') ? input.string('country_code', 2) : current.country_code;
    const region = input.has('region_code') ? input.string('region_code', 10) : current.region_code;
    const timezone = input.has('timezone') ? input.string('timezone', 64, true) : current.timezone;
    if (country && !/^[A-Z]{2}$/.test(country)) input.error('country_code', 'Use a two-letter ISO country code in capitals, such as MY.');
    if (region && !/^[A-Z0-9-]{1,10}$/.test(region)) input.error('region_code', 'Use a region code such as MY-10.');
    if (timezone && !isTimezone(timezone)) input.error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
    input.check();
    await app.settings().save({ country_code: country, region_code: region, timezone: timezone! }, app.clock().now());
    return json(200, { settings: await app.settings().get() });
  }, op('Update Settings', 'Set the organisation country, region and time zone', ['Choosing which public holidays apply', 'Changing the default time zone'], ["Changing one employee's time zone"],
    ['country_code', 'region_code', 'timezone'], ['settings'], ['Planning Manager'], ['GET /api/settings', 'POST /api/holiday-syncs'],
    ['settings', 'time zone', 'country', 'region']));
}
```

`src/server/routes/roles.ts`:

```ts
import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { isUniqueViolation } from '../support/ids';

const COLOR = /^#[0-9a-fA-F]{6}$/;
const taken = (name: string) => HttpError.conflict('ROLE_NAME_TAKEN', `A role named "${name}" already exists.`);

export function register(r: Router, app: App): void {
  r.add('GET', '/api/roles', 'person', 'List the roles shifts can require.', async ({ query }) =>
    json(200, { roles: await app.roles().all(query.include_archived === 'true') }),
  op('List Roles', 'See the job roles shifts are planned for', ['Filling a role picker', 'Showing role names and colours on a schedule'], ['Finding which employees hold a role'],
    ['include_archived'], ['roles[].id', 'roles[].name', 'roles[].color', 'roles[].archived'], ['Signed-in person'], ['POST /api/roles', 'GET /api/employees'],
    ['roles', 'job roles', 'positions', 'skills']));

  r.add('POST', '/api/roles', 'manager', 'Create a role.', async ({ body }) => {
    const input = new Input(await body());
    const name = input.string('name', 80, true);
    const color = input.string('color', 7, true);
    if (color && !COLOR.test(color)) input.error('color', 'Use a hex colour such as #3B82F6.');
    input.check();
    if (await app.roles().nameTaken(name!, null)) throw taken(name!);
    try {
      return json(201, { role: await app.roles().create(name!, color!.toUpperCase(), app.clock().now()) });
    } catch (error) {
      if (isUniqueViolation(error)) throw taken(name!); // two managers creating the same name at once
      throw error;
    }
  }, op('Create Role', 'Add a job role that shifts can require', ['Setting up a new kind of work to plan'], ['Renaming an existing role'],
    ['name', 'color'], ['role'], ['Planning Manager', 'Name not already used'], ['GET /api/roles', 'PATCH /api/roles/{id}'],
    ['role', 'create role', 'add position']));

  r.add('PATCH', '/api/roles/{id}', 'manager', 'Rename, recolour or archive a role.', async ({ params, body }) => {
    const role = (await app.roles().find(params.id)) ?? (() => { throw HttpError.notFound('No role with that id.'); })();
    const input = new Input(await body());
    const fields: { name?: string; color?: string; archived?: boolean } = {};
    if (input.has('name')) fields.name = input.string('name', 80, true) ?? undefined;
    if (input.has('color')) {
      const color = input.string('color', 7, true);
      if (color && !COLOR.test(color)) input.error('color', 'Use a hex colour such as #3B82F6.');
      fields.color = color?.toUpperCase();
    }
    if (input.has('archived')) fields.archived = input.bool('archived');
    input.check();
    if (fields.name && (await app.roles().nameTaken(fields.name, role.id))) throw taken(fields.name);
    return json(200, { role: await app.roles().update(role.id, fields, app.clock().now()) });
  }, op('Update Role', 'Change or retire a role', ['Renaming a role', 'Archiving a role nobody uses any more'], ['Creating a role'],
    ['name', 'color', 'archived'], ['role'], ['Planning Manager', 'Role exists'], ['GET /api/roles'],
    ['role', 'archive role', 'rename role']));
}
```

- [ ] **Step 6: Wire `App`, the module list and the catalogue**

In `app.ts`, add `holidayProvider?: HolidayProvider;` to `AppDeps`, plus these getters:

```ts
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

  holidayProvider(): HolidayProvider {
    return this.deps.holidayProvider ?? nullHolidayProvider;
  }
```

In `routes/index.ts`, add `settings` and `roles` to `MODULES`. In `catalog.ts`, append this to `capabilities`:

```ts
    {
      name: 'Configure Planning',
      icon: '⚙️',
      description: 'Set up the roles and organisation settings planning relies on.',
      does: ['Create and archive roles', 'Set the organisation time zone and country'],
      best_for: 'Planning Managers setting Planning up for their team.',
      endpoints: ['GET /api/roles', 'POST /api/roles', 'PATCH /api/roles/{id}', 'GET /api/settings', 'PATCH /api/settings'],
    },
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server
git commit -m "feat: add roles and organisation settings APIs"
```

---

### Task 12: Employees, planning profiles, and time zone in `/api/me`

**Files:**
- Create: `src/server/repo/profiles.ts`, `src/server/routes/employees.ts`
- Modify: `src/server/routes/me.ts`, `src/server/app.ts`, `src/server/routes/index.ts`, `src/server/http/catalog.ts`
- Test: `src/server/routes/employees.int.test.ts`

**Interfaces:**
- Consumes: `DirectoryRepository`, `DirectoryRefresher`, `RoleRepository`, `SettingsRepository`, `parseWorkingHours`, `Input`.
- Produces:
  - `interface Profile { employeeRef; roleIds: string[]; defaultRoleId: string | null; timezone: string | null; workingHours: WorkingHoursMap | null }`.
  - `blankProfile(ref)`.
  - `class ProfileRepository(db, org)` with `.find(ref)` (returns a blank profile when none exists, per FR-CFG-02 AC1), `.all(): Map<string, Profile>` and `.save(profile, now)`.
  - `GET /api/employees` (manager) returns `{ employees: [{ employee_ref, name, photo_url, department_id, department_name, status, role_ids, default_role_id, timezone, effective_timezone, working_hours }] }`.
  - `PATCH /api/employees/{ref}` (manager) takes any of `role_ids`, `default_role_id`, `timezone` and `working_hours` (`null` means flexible hours).
  - `GET /api/me` adds `timezone` and `organisation_timezone`.
  - `App.profiles()`.

- [ ] **Step 1: Write the failing test**

`src/server/routes/employees.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const HOURS = { mon: [['09:00', '13:00'], ['14:00', '18:00']] };

describe('employees API (FR-CFG-02)', () => {
  it('shows a never-configured employee with no roles and flexible hours (AC1)', async () => {
    await h.addEmployee('E1', 'Ana Lim', 'DEP-1', 'Field Services');
    const { status, body } = await h.call('GET', '/api/employees');
    expect(status).toBe(200);
    expect(body.employees).toEqual([{
      employee_ref: 'E1', name: 'Ana Lim', photo_url: null, department_id: 'DEP-1', department_name: 'Field Services', status: 'Active',
      role_ids: [], default_role_id: null, timezone: null, effective_timezone: 'Asia/Kuala_Lumpur', working_hours: null,
    }]);
  });

  it('fills an empty directory from the roster on first use', async () => {
    h.roster.add('u7', 'Bo Tan', 'bo@x.test');
    expect((await h.call('GET', '/api/employees')).body.employees.map((e: { name: string }) => e.name)).toEqual(['Bo Tan']);
  });

  it('saves a profile', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const tech = await h.addRole('Technician');
    const desk = await h.addRole('Reception');
    const { status, body } = await h.call('PATCH', '/api/employees/E1', { role_ids: [tech, desk], default_role_id: tech, timezone: 'Asia/Singapore', working_hours: HOURS });
    expect(status).toBe(200);
    expect([...body.employee.role_ids].sort()).toEqual([tech, desk].sort());
    expect(body.employee).toMatchObject({ default_role_id: tech, effective_timezone: 'Asia/Singapore' });
    expect(body.employee.working_hours.mon).toEqual(HOURS.mon);
    expect(body.employee.working_hours.sun).toEqual([]);
  });

  it('keeps absent fields; null working hours means flexible', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const tech = await h.addRole('Technician');
    await h.call('PATCH', '/api/employees/E1', { role_ids: [tech], working_hours: HOURS });
    const { body } = await h.call('PATCH', '/api/employees/E1', { working_hours: null });
    expect(body.employee.role_ids).toEqual([tech]);
    expect(body.employee.working_hours).toBeNull();
  });

  it('names every invalid field', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const tech = await h.addRole('Technician');
    const { status, body } = await h.call('PATCH', '/api/employees/E1', { role_ids: ['nope'], default_role_id: tech, timezone: 'Nowhere/Land', working_hours: { mon: [['18:00', '09:00']] } });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['working_hours', 'role_ids', 'default_role_id', 'timezone']);
    expect(body.error.details.working_hours).toContain('must end after it starts');
  });

  it('is 404 for someone not on the roster and 403 for employees', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    expect((await h.call('PATCH', '/api/employees/E404', { timezone: null })).status).toBe(404);
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/employees')).status).toBe(403);
  });

  it('reports the effective time zone in /api/me', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.call('PATCH', '/api/employees/E1', { timezone: 'Asia/Singapore' });
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/me')).body).toMatchObject({ timezone: 'Asia/Singapore', organisation_timezone: 'Asia/Kuala_Lumpur' });
    h.asEmployee(null, 'visitor@example.com');
    expect((await h.call('GET', '/api/me')).body.timezone).toBe('Asia/Kuala_Lumpur');
  });
});
```

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 2: Implement the profile repository**

`src/server/repo/profiles.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { employeeProfiles, employeeRoles, type WorkingHoursMap } from '../db/schema';

export interface Profile {
  employeeRef: string;
  roleIds: string[];
  defaultRoleId: string | null;
  timezone: string | null;
  /** null = flexible hours */
  workingHours: WorkingHoursMap | null;
}

export const blankProfile = (employeeRef: string): Profile => ({ employeeRef, roleIds: [], defaultRoleId: null, timezone: null, workingHours: null });

/** FR-CFG-02. Planning-owned facts about an employee; the roster owns everything else. */
export class ProfileRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async find(ref: string): Promise<Profile> {
    const [row] = await this.db.select().from(employeeProfiles)
      .where(and(eq(employeeProfiles.organisationId, this.org), eq(employeeProfiles.employeeRef, ref))).limit(1);
    const roles = await this.db.select({ roleId: employeeRoles.roleId }).from(employeeRoles)
      .where(and(eq(employeeRoles.organisationId, this.org), eq(employeeRoles.employeeRef, ref))).orderBy(employeeRoles.roleId);
    return {
      ...blankProfile(ref),
      ...(row ? { defaultRoleId: row.defaultRoleId, timezone: row.timezone, workingHours: row.workingHours } : {}),
      roleIds: roles.map((r) => r.roleId),
    };
  }

  async all(): Promise<Map<string, Profile>> {
    const profiles = new Map<string, Profile>();
    for (const row of await this.db.select().from(employeeProfiles).where(eq(employeeProfiles.organisationId, this.org))) {
      profiles.set(row.employeeRef, { ...blankProfile(row.employeeRef), defaultRoleId: row.defaultRoleId, timezone: row.timezone, workingHours: row.workingHours });
    }
    for (const row of await this.db.select().from(employeeRoles).where(eq(employeeRoles.organisationId, this.org)).orderBy(employeeRoles.roleId)) {
      if (!profiles.has(row.employeeRef)) profiles.set(row.employeeRef, blankProfile(row.employeeRef));
      profiles.get(row.employeeRef)!.roleIds.push(row.roleId);
    }
    return profiles;
  }

  async save(profile: Profile, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const values = { defaultRoleId: profile.defaultRoleId, timezone: profile.timezone, workingHours: profile.workingHours, updatedAt: now };
      await tx.insert(employeeProfiles).values({ organisationId: this.org, employeeRef: profile.employeeRef, ...values })
        .onConflictDoUpdate({ target: [employeeProfiles.organisationId, employeeProfiles.employeeRef], set: values });
      await tx.delete(employeeRoles).where(and(eq(employeeRoles.organisationId, this.org), eq(employeeRoles.employeeRef, profile.employeeRef)));
      if (profile.roleIds.length > 0) {
        await tx.insert(employeeRoles).values(profile.roleIds.map((roleId) => ({ organisationId: this.org, employeeRef: profile.employeeRef, roleId })));
      }
    });
  }
}
```

- [ ] **Step 3: Implement the routes and extend `/api/me`**

`src/server/routes/employees.ts`:

```ts
import type { App } from '../app';
import { parseWorkingHours, WorkingHoursError } from '../domain/workingHours';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import type { DirectoryRow } from '../repo/directory';
import { blankProfile, type Profile } from '../repo/profiles';
import { isTimezone } from '../support/time';

function shape(row: DirectoryRow, profile: Profile, orgTimezone: string) {
  return {
    employee_ref: row.employeeRef,
    name: row.displayName,
    photo_url: row.photoUrl,
    department_id: row.departmentId,
    department_name: row.departmentName,
    status: row.status,
    role_ids: profile.roleIds,
    default_role_id: profile.defaultRoleId,
    timezone: profile.timezone,
    effective_timezone: profile.timezone ?? orgTimezone,
    working_hours: profile.workingHours,
  };
}

export function register(r: Router, app: App): void {
  r.add('GET', '/api/employees', 'manager', 'List plannable employees with their roles and working hours.', async () => {
    await app.directoryRefresher().refreshIfEmpty();
    const [rows, profiles, orgTimezone] = await Promise.all([app.directory().all(), app.profiles().all(), app.settings().timezone()]);
    return json(200, { employees: rows.map((row) => shape(row, profiles.get(row.employeeRef) ?? blankProfile(row.employeeRef), orgTimezone)) });
  }, op('List Employees', 'See who can be planned and how', ['Choosing who to put on a shift', 'Reviewing roles and working hours'], ['Reading shifts', 'Looking up personal details'],
    [], ['employees[].employee_ref', 'employees[].name', 'employees[].role_ids', 'employees[].working_hours'], ['Planning Manager'], ['PATCH /api/employees/{ref}', 'GET /api/schedule'],
    ['employees', 'staff', 'roster', 'team', 'people']));

  r.add('PATCH', '/api/employees/{ref}', 'manager', "Set an employee's planning roles, default role, time zone and working hours.", async ({ params, body }) => {
    const ref = params.ref;
    const row = await app.directory().find(ref);
    if (!row && !(await app.directory().isEmpty())) throw HttpError.notFound('No employee with that reference on the roster.');
    const current = await app.profiles().find(ref);
    const input = new Input(await body());

    let workingHours = current.workingHours;
    if (input.has('working_hours')) {
      const raw = input.raw('working_hours');
      try {
        workingHours = raw === null ? null : parseWorkingHours(raw);
      } catch (error) {
        if (!(error instanceof WorkingHoursError)) throw error;
        input.error('working_hours', error.message);
      }
    }
    const roleIds = input.has('role_ids') ? (input.stringList('role_ids', 50) ?? []) : current.roleIds;
    const known = await app.roles().ids();
    const unknown = roleIds.find((id) => !known.has(id));
    if (unknown) input.error('role_ids', `Unknown role ${unknown}.`);
    const defaultRoleId = input.has('default_role_id') ? input.string('default_role_id', 36) : current.defaultRoleId;
    if (defaultRoleId && !roleIds.includes(defaultRoleId)) input.error('default_role_id', "The default role must be one of the employee's roles.");
    const timezone = input.has('timezone') ? input.string('timezone', 64) : current.timezone;
    if (timezone && !isTimezone(timezone)) input.error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
    input.check();

    await app.profiles().save({ employeeRef: ref, roleIds, defaultRoleId, timezone, workingHours }, app.clock().now());
    const display = row ?? { employeeRef: ref, displayName: 'Unknown employee', photoUrl: null, departmentId: null, departmentName: null, status: 'unknown' };
    return json(200, { employee: shape(display, await app.profiles().find(ref), await app.settings().timezone()) });
  }, op('Update Planning Profile', 'Change how an employee can be planned', ['Giving someone a role', 'Setting part-time working hours', 'Marking someone as flexible hours'], ['Changing personal details on the roster'],
    ['role_ids', 'default_role_id', 'timezone', 'working_hours'], ['employee'], ['Planning Manager', 'Employee on the roster'], ['GET /api/employees', 'GET /api/roles'],
    ['working hours', 'schedule', 'roles', 'part time', 'flexible']));
}
```

The validation test expects the error keys in the order `working_hours`, `role_ids`, `default_role_id`, `timezone`. That is the order the handler checks them, so keep that order if you change it.

Replace the handler in `src/server/routes/me.ts` (it now uses `app`, so rename `_app` to `app`):

```ts
  r.add('GET', '/api/me', 'person', 'Show who is signed in and what they may do in Planning.', async ({ principal: me }) => {
    const organisationTimezone = await app.settings().timezone();
    const timezone = me?.employeeRef ? ((await app.profiles().find(me.employeeRef)).timezone ?? organisationTimezone) : organisationTimezone;
    return json(200, {
      name: me?.name ?? null, email: me?.email ?? null, gateway_role: me?.gatewayRole ?? null, employee_ref: me?.employeeRef ?? null,
      is_manager: me?.isManager ?? false, timezone, organisation_timezone: organisationTimezone,
    });
  }, op('Show Current User', 'Find out who is signed in and whether they manage planning', ['Deciding which screens to show after sign-in'], ['Listing employees', 'Reading shifts'],
    [], ['name', 'email', 'employee_ref', 'is_manager', 'timezone'], ['Signed-in person'], ['GET /api/my/shifts', 'GET /api/schedule'],
    ['me', 'profile', 'current user', 'whoami', 'permissions']));
```

- [ ] **Step 4: Wire it**

Add `profiles()` to `App` (`new ProfileRepository(this.database().db, this.organisationId())`, cached with `once`). Add `employees` to `MODULES`, and append to `capabilities`:

```ts
    {
      name: 'Manage Team Profiles',
      icon: '👥',
      description: 'See plannable employees and set their roles and working hours.',
      does: ['List the team', 'Give an employee roles', 'Set working hours or flexible hours'],
      best_for: 'Managers preparing who can be scheduled for what.',
      endpoints: ['GET /api/employees', 'PATCH /api/employees/{ref}'],
    },
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server
git commit -m "feat: add employee planning profiles and report time zone in /api/me"
```

---

### Task 13: Time off and public holidays

**Files:**
- Create: `src/server/repo/timeOff.ts`, `src/server/repo/holidays.ts`, `src/server/routes/timeOff.ts`, `src/server/routes/holidays.ts`
- Modify: `src/server/app.ts`, `src/server/routes/index.ts`, `src/server/http/catalog.ts`
- Test: `src/server/routes/timeOff.int.test.ts`, `src/server/routes/holidays.int.test.ts`

**Interfaces:**
- Consumes: `Input`, `DirectoryRepository`, `SettingsRepository`, `HolidayProvider`, `isUuid`, `iso`, `localMidnight`.
- Produces:
  - `interface TimeOff { id; employeeRef; start: Date; end: Date; reason }`.
  - `class TimeOffRepository(db, org)` with these methods:
    - `.between(from: Date, to: Date, employeeRef?)` returns records that overlap `[from, to)`
    - `.find(id)`
    - `.create(ref, start, end, reason, by, now)`
    - `.update(id, start, end, reason, now)`
    - `.delete(id): Promise<boolean>`
    - `toApi(record)`
  - `interface Holiday { id; date; name; source: 'manual' | 'provider'; hidden; edited }`.
  - `class HolidayRepository(db, org)` with these methods:
    - `.forYear(year)`
    - `.visibleBetween(fromDate, toDate): { date, name }[]` (both dates inclusive)
    - `.find(id)`
    - `.createManual(date, name, now)`
    - `.update(id, { name?, hidden? }, now)`
    - `.delete(id)`
    - `.syncFromProvider(list, now): { added, updated }`
  - Endpoints:
    - `GET /api/unavailabilities?from=&to=[&employee_ref=]`, `POST /api/unavailabilities`, `PATCH /api/unavailabilities/{id}`, `DELETE /api/unavailabilities/{id}` (all manager)
    - `GET /api/holidays?year=`, `POST /api/holidays`, `PATCH /api/holidays/{id}`, `DELETE /api/holidays/{id}`, `POST /api/holiday-syncs` (all manager)
  - `App.timeOff()`, `App.holidays()`.

Rules:
- Time off may last up to 366 days.
- Provider holidays can be renamed or hidden, but not deleted, because they would come back on the next sync.
- A sync refreshes provider holidays nobody has edited, and never changes `hidden` (FR-CFG-04 AC2).

- [ ] **Step 1: Write the failing tests**

`src/server/routes/timeOff.int.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(() => h.addEmployee('E1', 'Ana Lim'));

async function create(start = '2026-10-16T00:00:00+08:00', end = '2026-10-17T00:00:00+08:00') {
  const { status, body } = await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: start, end_at: end, reason: 'Annual leave' });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.unavailability;
}

describe('time off API (FR-CFG-03)', () => {
  it('records and lists time off overlapping a range', async () => {
    const created = await create();
    expect(created).toEqual({ id: created.id, employee_ref: 'E1', start_at: '2026-10-15T16:00:00Z', end_at: '2026-10-16T16:00:00Z', reason: 'Annual leave' });
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-12', to: '2026-10-18' })).body.unavailabilities).toHaveLength(1);
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-19', to: '2026-10-25' })).body.unavailabilities).toHaveLength(0);
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-12', to: '2026-10-18', employee_ref: 'E2' })).body.unavailabilities).toHaveLength(0);
  });

  it('names invalid fields', async () => {
    const { status, body } = await h.call('POST', '/api/unavailabilities', { employee_ref: 'E9', start_at: '2026-10-16T10:00:00+08:00', end_at: '2026-10-16T09:00:00+08:00' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['employee_ref', 'end_at']);
    expect((await h.call('GET', '/api/unavailabilities', undefined, { from: '2026-10-12' })).status).toBe(422);
  });

  it('edits and deletes', async () => {
    const { id } = await create();
    const { body } = await h.call('PATCH', `/api/unavailabilities/${id}`, { reason: 'Sick leave', end_at: '2026-10-18T00:00:00+08:00' });
    expect(body.unavailability).toMatchObject({ reason: 'Sick leave', end_at: '2026-10-17T16:00:00Z' });
    expect((await h.call('DELETE', `/api/unavailabilities/${id}`)).status).toBe(204);
    expect((await h.call('DELETE', `/api/unavailabilities/${id}`)).status).toBe(404);
  });
});
```

`src/server/routes/holidays.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const year = async () => (await h.call('GET', '/api/holidays', undefined, { year: 2026 })).body.holidays;

describe('holidays API (FR-CFG-04)', () => {
  it('adds, hides and deletes a manual holiday', async () => {
    const { status, body } = await h.call('POST', '/api/holidays', { date: '2026-11-08', name: 'Deepavali' });
    expect(status).toBe(201);
    expect(body.holiday).toEqual({ id: body.holiday.id, date: '2026-11-08', name: 'Deepavali', source: 'manual', hidden: false, edited: false });
    expect((await h.call('PATCH', `/api/holidays/${body.holiday.id}`, { hidden: true })).body.holiday.hidden).toBe(true);
    expect((await h.call('DELETE', `/api/holidays/${body.holiday.id}`)).status).toBe(204);
    expect(await year()).toEqual([]);
  });

  it('needs a provider and a country to sync', async () => {
    expect((await h.call('POST', '/api/holiday-syncs', { year: 2026 })).body.error.code).toBe('HOLIDAY_PROVIDER_NOT_CONFIGURED');
    h.holidays.configured = true;
    expect((await h.call('POST', '/api/holiday-syncs', { year: 2026 })).body.error.code).toBe('COUNTRY_NOT_SET');
  });

  it('keeps hidden and renamed holidays across a re-sync (AC2)', async () => {
    h.holidays.configured = true;
    h.holidays.list = [
      { key: 'MY-2026-11-08', date: '2026-11-08', name: 'Deepavali' },
      { key: 'MY-2026-12-25', date: '2026-12-25', name: 'Christmas' },
    ];
    await h.call('PATCH', '/api/settings', { country_code: 'MY', region_code: 'MY-10' });

    const first = await h.call('POST', '/api/holiday-syncs', { year: 2026 });
    expect([first.status, first.body]).toEqual([201, { added: 2, updated: 0 }]);
    expect(h.holidays.calls).toEqual([[2026, 'MY', 'MY-10']]);

    const [deepavali, christmas] = await year();
    await h.call('PATCH', `/api/holidays/${deepavali.id}`, { hidden: true });
    await h.call('PATCH', `/api/holidays/${christmas.id}`, { name: 'Christmas Day' });
    expect((await h.call('DELETE', `/api/holidays/${deepavali.id}`)).body.error.code).toBe('PROVIDER_HOLIDAY');

    h.holidays.list[0].name = 'Deepavali (Diwali)';
    h.holidays.list[1].name = 'Christmas (provider)';
    await h.call('POST', '/api/holiday-syncs', { year: 2026 });

    const [after1, after2] = await year();
    expect([after1.name, after1.hidden]).toEqual(['Deepavali (Diwali)', true]);
    expect(after2.name).toBe('Christmas Day');
  });

  it('names invalid fields', async () => {
    const { status, body } = await h.call('POST', '/api/holidays', { date: '2026-02-30', name: '' });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details)).toEqual(['date', 'name']);
  });
});
```

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 2: Implement the repositories**

`src/server/repo/timeOff.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { unavailabilities } from '../db/schema';
import { isUuid } from '../support/ids';
import { iso } from '../support/time';

export interface TimeOff {
  id: string;
  employeeRef: string;
  start: Date;
  end: Date;
  reason: string;
}

const toTimeOff = (r: typeof unavailabilities.$inferSelect): TimeOff => ({ id: r.id, employeeRef: r.employeeRef, start: r.startAt, end: r.endAt, reason: r.reason });

export function toApi(t: TimeOff) {
  return { id: t.id, employee_ref: t.employeeRef, start_at: iso(t.start), end_at: iso(t.end), reason: t.reason };
}

/**
 * FR-CFG-03, DR-03: personal time off stored by Planning until an HR leave
 * service exists. Everything reads time off through between(), so moving to
 * that service later means replacing this class only.
 */
export class TimeOffRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  async between(from: Date, to: Date, employeeRef?: string | null): Promise<TimeOff[]> {
    const conditions = [eq(unavailabilities.organisationId, this.org), lt(unavailabilities.startAt, to), gt(unavailabilities.endAt, from)];
    if (employeeRef) conditions.push(eq(unavailabilities.employeeRef, employeeRef));
    return (await this.db.select().from(unavailabilities).where(and(...conditions)).orderBy(unavailabilities.startAt)).map(toTimeOff);
  }

  async find(id: string): Promise<TimeOff | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(unavailabilities).where(and(eq(unavailabilities.organisationId, this.org), eq(unavailabilities.id, id))).limit(1);
    return row ? toTimeOff(row) : null;
  }

  async create(employeeRef: string, start: Date, end: Date, reason: string, by: string, now: Date): Promise<TimeOff> {
    const [row] = await this.db.insert(unavailabilities)
      .values({ id: randomUUID(), organisationId: this.org, employeeRef, startAt: start, endAt: end, reason, createdBy: by, createdAt: now, updatedAt: now })
      .returning();
    return toTimeOff(row);
  }

  async update(id: string, start: Date, end: Date, reason: string, now: Date): Promise<TimeOff> {
    const [row] = await this.db.update(unavailabilities).set({ startAt: start, endAt: end, reason, updatedAt: now })
      .where(and(eq(unavailabilities.organisationId, this.org), eq(unavailabilities.id, id))).returning();
    return toTimeOff(row);
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const deleted = await this.db.delete(unavailabilities).where(and(eq(unavailabilities.organisationId, this.org), eq(unavailabilities.id, id))).returning({ id: unavailabilities.id });
    return deleted.length === 1;
  }
}
```

`src/server/repo/holidays.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { and, between, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { publicHolidays } from '../db/schema';
import { isUuid } from '../support/ids';

export interface Holiday {
  id: string;
  date: string;
  name: string;
  source: 'manual' | 'provider';
  hidden: boolean;
  edited: boolean;
}

const toHoliday = (r: typeof publicHolidays.$inferSelect): Holiday =>
  ({ id: r.id, date: r.holidayDate, name: r.name, source: r.source as Holiday['source'], hidden: r.hidden, edited: r.edited });

/** FR-CFG-04 */
export class HolidayRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  private where(id: string) {
    return and(eq(publicHolidays.organisationId, this.org), eq(publicHolidays.id, id));
  }

  async forYear(year: number): Promise<Holiday[]> {
    const rows = await this.db.select().from(publicHolidays)
      .where(and(eq(publicHolidays.organisationId, this.org), between(publicHolidays.holidayDate, `${year}-01-01`, `${year}-12-31`)))
      .orderBy(publicHolidays.holidayDate, publicHolidays.name);
    return rows.map(toHoliday);
  }

  async visibleBetween(fromDate: string, toDate: string): Promise<{ date: string; name: string }[]> {
    return this.db.select({ date: publicHolidays.holidayDate, name: publicHolidays.name }).from(publicHolidays)
      .where(and(eq(publicHolidays.organisationId, this.org), eq(publicHolidays.hidden, false), between(publicHolidays.holidayDate, fromDate, toDate)))
      .orderBy(publicHolidays.holidayDate);
  }

  async find(id: string): Promise<Holiday | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(publicHolidays).where(this.where(id)).limit(1);
    return row ? toHoliday(row) : null;
  }

  async createManual(date: string, name: string, now: Date): Promise<Holiday> {
    const [row] = await this.db.insert(publicHolidays)
      .values({ id: randomUUID(), organisationId: this.org, holidayDate: date, name, source: 'manual', createdAt: now, updatedAt: now }).returning();
    return toHoliday(row);
  }

  async update(id: string, fields: { name?: string; hidden?: boolean }, now: Date): Promise<Holiday> {
    const [row] = await this.db.update(publicHolidays).set({
      ...(fields.name !== undefined ? { name: fields.name, edited: true } : {}),
      ...(fields.hidden !== undefined ? { hidden: fields.hidden } : {}),
      updatedAt: now,
    }).where(this.where(id)).returning();
    return toHoliday(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(publicHolidays).where(this.where(id));
  }

  /** New provider holidays are added; existing ones are refreshed unless a manager renamed them. `hidden` is never touched. */
  async syncFromProvider(list: { key: string; date: string; name: string }[], now: Date): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    for (const h of list) {
      const [existing] = await this.db.select().from(publicHolidays)
        .where(and(eq(publicHolidays.organisationId, this.org), eq(publicHolidays.providerKey, h.key))).limit(1);
      if (!existing) {
        await this.db.insert(publicHolidays).values({ id: randomUUID(), organisationId: this.org, holidayDate: h.date, name: h.name, source: 'provider', providerKey: h.key, createdAt: now, updatedAt: now });
        added++;
      } else if (!existing.edited && (existing.holidayDate !== h.date || existing.name !== h.name)) {
        await this.db.update(publicHolidays).set({ holidayDate: h.date, name: h.name, updatedAt: now }).where(eq(publicHolidays.id, existing.id));
        updated++;
      }
    }
    return { added, updated };
  }
}
```

- [ ] **Step 3: Implement the routes**

`src/server/routes/timeOff.ts`:

```ts
import type { App } from '../app';
import { actorId } from '../auth/principal';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { toApi } from '../repo/timeOff';
import { localMidnight } from '../support/time';

const MAX_MS = 366 * 86_400_000;

function checkSpan(input: Input, start: Date | null, end: Date | null): void {
  if (!start || !end) return;
  if (end <= start) input.error('end_at', 'Time off must end after it starts.');
  else if (end.getTime() - start.getTime() > MAX_MS) input.error('end_at', 'Time off can last at most 366 days.');
}

export function register(r: Router, app: App): void {
  r.add('GET', '/api/unavailabilities', 'manager', 'List time off overlapping a date range.', async ({ query }) => {
    const input = new Input(query);
    const range = input.dateRange('from', 'to', 366);
    const ref = input.string('employee_ref', 64);
    input.check();
    const zone = await app.settings().timezone();
    const records = await app.timeOff().between(new Date(localMidnight(range![0], zone)), new Date(localMidnight(range![1], zone) + 86_400_000), ref);
    return json(200, { unavailabilities: records.map(toApi) });
  }, op('List Time Off', 'See when employees are away', ['Checking who is on leave this week'], ['Listing public holidays'],
    ['from', 'to', 'employee_ref'], ['unavailabilities[]'], ['Planning Manager'], ['POST /api/unavailabilities', 'GET /api/schedule'],
    ['time off', 'leave', 'absence', 'vacation', 'unavailable']));

  r.add('POST', '/api/unavailabilities', 'manager', 'Record time off for an employee.', async ({ body, principal }) => {
    const input = new Input(await body());
    const ref = input.string('employee_ref', 64, true);
    if (ref && !(await app.directory().isEmpty()) && !(await app.directory().find(ref))) input.error('employee_ref', 'Not on the employee roster.');
    const start = input.instant('start_at', true);
    const end = input.instant('end_at', true);
    const reason = input.string('reason', 200) ?? '';
    checkSpan(input, start, end);
    input.check();
    const record = await app.timeOff().create(ref!, start!, end!, reason, principal ? actorId(principal) : 'unknown', app.clock().now());
    return json(201, { unavailability: toApi(record) });
  }, op('Record Time Off', 'Mark an employee as unavailable', ['An employee is on leave, sick or training'], ['Adding a company-wide holiday'],
    ['employee_ref', 'start_at', 'end_at', 'reason'], ['unavailability'], ['Planning Manager', 'Employee on the roster'], ['GET /api/unavailabilities'],
    ['leave', 'sick', 'time off', 'absence']));

  r.add('PATCH', '/api/unavailabilities/{id}', 'manager', 'Change recorded time off.', async ({ params, body }) => {
    const current = (await app.timeOff().find(params.id)) ?? (() => { throw HttpError.notFound('No time off with that id.'); })();
    const input = new Input(await body());
    const start = input.has('start_at') ? input.instant('start_at', true) : current.start;
    const end = input.has('end_at') ? input.instant('end_at', true) : current.end;
    const reason = input.has('reason') ? (input.string('reason', 200) ?? '') : current.reason;
    checkSpan(input, start, end);
    input.check();
    return json(200, { unavailability: toApi(await app.timeOff().update(current.id, start!, end!, reason, app.clock().now())) });
  }, op('Update Time Off', 'Correct the dates or reason of time off', ['Leave was extended or shortened'], ['Recording new time off'],
    ['start_at', 'end_at', 'reason'], ['unavailability'], ['Planning Manager'], ['GET /api/unavailabilities'],
    ['leave', 'time off', 'edit']));

  r.add('DELETE', '/api/unavailabilities/{id}', 'manager', 'Remove recorded time off.', async ({ params }) => {
    if (!(await app.timeOff().delete(params.id))) throw HttpError.notFound('No time off with that id.');
    return noContent();
  }, op('Delete Time Off', 'Remove time off recorded by mistake', ['Leave was cancelled'], ['Shortening leave'],
    ['id'], [], ['Planning Manager'], ['GET /api/unavailabilities'], ['leave', 'time off', 'cancel']));
}
```

`src/server/routes/holidays.ts`:

```ts
import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { localDate } from '../support/time';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/holidays', 'manager', 'List public holidays for a year.', async ({ query }) => {
    const year = query.year ?? localDate(app.clock().now().getTime(), await app.settings().timezone()).slice(0, 4);
    if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) throw HttpError.validation({ year: 'Use a year between 2000 and 2100.' });
    return json(200, { holidays: await app.holidays().forYear(Number(year)) });
  }, op('List Holidays', 'See the public holidays planning respects', ['Reviewing the holiday calendar'], ['Listing personal leave'],
    ['year'], ['holidays[]'], ['Planning Manager'], ['POST /api/holidays', 'POST /api/holiday-syncs'], ['holidays', 'public holiday', 'calendar']));

  r.add('POST', '/api/holidays', 'manager', 'Add a public holiday by hand.', async ({ body }) => {
    const input = new Input(await body());
    const date = input.date('date', true);
    const name = input.string('name', 160, true);
    input.check();
    return json(201, { holiday: await app.holidays().createManual(date!, name!, app.clock().now()) });
  }, op('Add Holiday', 'Add a holiday the provider does not know', ['A state or company holiday is missing'], ['Loading a whole year of holidays'],
    ['date', 'name'], ['holiday'], ['Planning Manager'], ['GET /api/holidays'], ['holiday', 'add holiday', 'company holiday']));

  r.add('PATCH', '/api/holidays/{id}', 'manager', 'Rename, hide or show a public holiday.', async ({ params, body }) => {
    const holiday = (await app.holidays().find(params.id)) ?? (() => { throw HttpError.notFound('No holiday with that id.'); })();
    const input = new Input(await body());
    const name = input.has('name') ? (input.string('name', 160, true) ?? undefined) : undefined;
    const hidden = input.has('hidden') ? input.bool('hidden') : undefined;
    input.check();
    return json(200, { holiday: await app.holidays().update(holiday.id, { name, hidden }, app.clock().now()) });
  }, op('Update Holiday', 'Rename or hide a holiday', ['The organisation works on a public holiday', 'Correcting a holiday name'], ['Adding a holiday'],
    ['name', 'hidden'], ['holiday'], ['Planning Manager'], ['GET /api/holidays'], ['holiday', 'hide holiday', 'rename']));

  r.add('DELETE', '/api/holidays/{id}', 'manager', 'Delete a manually added public holiday.', async ({ params }) => {
    const holiday = (await app.holidays().find(params.id)) ?? (() => { throw HttpError.notFound('No holiday with that id.'); })();
    if (holiday.source === 'provider') throw HttpError.conflict('PROVIDER_HOLIDAY', 'Holidays from the provider would come back on the next sync. Hide this holiday instead.');
    await app.holidays().delete(holiday.id);
    return noContent();
  }, op('Delete Holiday', 'Remove a holiday added by hand', ['A manual holiday was added by mistake'], ['Removing a provider holiday (hide it instead)'],
    ['id'], [], ['Planning Manager', 'Holiday was added by hand'], ['PATCH /api/holidays/{id}'], ['holiday', 'delete holiday']));

  r.add('POST', '/api/holiday-syncs', 'manager', 'Load a year of public holidays from the holiday provider.', async ({ body }) => {
    const input = new Input(await body());
    const year = input.int('year', 2000, 2100);
    if (year === null) input.error('year', 'This field is required.');
    input.check();
    if (!app.holidayProvider().isConfigured()) {
      throw HttpError.conflict('HOLIDAY_PROVIDER_NOT_CONFIGURED', 'No public holiday provider is configured yet (open issue OI-02). Add holidays by hand for now.');
    }
    const settings = await app.settings().get();
    if (!settings.country_code) throw HttpError.conflict('COUNTRY_NOT_SET', 'Set the organisation country in settings before syncing holidays.');
    const list = await app.holidayProvider().holidays(year!, settings.country_code, settings.region_code);
    return json(201, await app.holidays().syncFromProvider(list, app.clock().now()));
  }, op('Sync Holidays', "Load public holidays for the organisation's country and region", ['Starting a new year', 'After changing the country or region'], ['Adding one holiday by hand'],
    ['year'], ['added', 'updated'], ['Planning Manager', 'Country set in settings', 'Holiday provider configured'], ['PATCH /api/settings', 'GET /api/holidays'],
    ['holidays', 'sync', 'import', 'public holidays']));
}
```

- [ ] **Step 4: Wire it**

Add `timeOff()` (`TimeOffRepository`) and `holidays()` (`HolidayRepository`) to `App`, cached with `once`. Add `timeOff` and `holidays` to `MODULES`, and append to `capabilities`:

```ts
    {
      name: 'Track Time Off',
      icon: '🏖️',
      description: 'Record when people are away and which public holidays apply.',
      does: ['Record leave for an employee', 'Add, hide or sync public holidays'],
      best_for: 'Keeping the schedule from planning people who are away.',
      endpoints: [
        'GET /api/unavailabilities', 'POST /api/unavailabilities', 'PATCH /api/unavailabilities/{id}', 'DELETE /api/unavailabilities/{id}',
        'GET /api/holidays', 'POST /api/holidays', 'PATCH /api/holidays/{id}', 'DELETE /api/holidays/{id}', 'POST /api/holiday-syncs',
      ],
    },
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server
git commit -m "feat: record time off and manage public holidays"
```

---

### Task 14: Planning Manager list API (FR-ACC-03)

**Files:**
- Create: `src/server/routes/managers.ts`
- Modify: `src/server/routes/index.ts`, `src/server/http/catalog.ts`
- Test: `src/server/routes/managers.int.test.ts`

**Interfaces:**
- Consumes: `ManagerRepository` (Task 6), `Roster` (Task 7), `Input`, `actorId`.
- Produces:
  - `GET /api/managers` returns `{ managers, note }`.
  - `POST /api/managers {email}` returns 201 for a new grant, 200 if the person already had one, 422 if they're not on the roster, and 503 `ROSTER_UNAVAILABLE` if the roster can't be reached.
  - `DELETE /api/managers/{email}[?confirm=true]` returns 204, 404 if the person isn't listed, or 409 `LAST_MANAGER`. The 409 applies when a non-admin removes themselves while they are the only listed manager.

- [ ] **Step 1: Write the failing test**

`src/server/routes/managers.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();

describe('managers API (FR-ACC-03)', () => {
  it('grants once and lists', async () => {
    h.roster.add('u1', 'Bo Tan', 'bo@example.com');
    expect((await h.call('POST', '/api/managers', { email: 'Bo@Example.com' })).status).toBe(201);
    const again = await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    expect(again.status).toBe(200);
    expect(again.body.manager).toEqual({ email: 'bo@example.com', granted_by: 'mona@example.com', granted_at: '2026-10-13T02:00:00Z' });
    expect((await h.call('GET', '/api/managers')).body.managers.map((m: { email: string }) => m.email)).toEqual(['bo@example.com']);
  });

  it('only grants people on the roster', async () => {
    expect((await h.call('POST', '/api/managers', { email: 'ghost@example.com' })).body.error.details.email).toBe('This email is not on the employee roster.');
    expect((await h.call('POST', '/api/managers', { email: 'not-an-email' })).status).toBe(422);
    h.roster.down = true;
    const down = await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    expect([down.status, down.body.error.code]).toEqual([503, 'ROSTER_UNAVAILABLE']);
  });

  it('revokes', async () => {
    h.roster.add('u1', 'Bo Tan', 'bo@example.com');
    await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    expect((await h.call('DELETE', '/api/managers/bo%40example.com')).status).toBe(204);
    expect((await h.call('DELETE', '/api/managers/bo%40example.com')).status).toBe(404);
  });

  it('warns the last listed manager before they remove themselves (AC3)', async () => {
    h.roster.add('u1', 'Bo Tan', 'bo@example.com');
    await h.call('POST', '/api/managers', { email: 'bo@example.com' });
    h.asManager('bo@example.com');
    expect((await h.call('DELETE', '/api/managers/bo%40example.com')).body.error.code).toBe('LAST_MANAGER');
    expect((await h.call('DELETE', '/api/managers/bo%40example.com', undefined, { confirm: 'true' })).status).toBe(204);
  });

  it('is for managers only', async () => {
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/managers')).status).toBe(403);
  });
});
```

The harness's manager principal has gateway role `user`, so the last-manager warning applies to it. A gateway `admin` is never warned; the guard tests in Task 6 already cover admins.

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 2: Implement the routes**

`src/server/routes/managers.ts`:

```ts
import type { App } from '../app';
import { actorId } from '../auth/principal';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json, noContent } from '../http/responses';
import type { Router } from '../http/router';
import { RosterUnavailable } from '../roster/roster';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function register(r: Router, app: App): void {
  r.add('GET', '/api/managers', 'manager', 'List people granted Planning Manager access.', async () =>
    json(200, { managers: await app.managers().all(), note: 'InterlinkERP gateway admins are always Planning Managers and are not listed here.' }),
  op('List Planning Managers', 'See who can manage planning', ['Reviewing who has manager access'], ['Listing employees'],
    [], ['managers[].email', 'managers[].granted_by', 'managers[].granted_at'], ['Planning Manager'], ['POST /api/managers', 'DELETE /api/managers/{email}'],
    ['managers', 'permissions', 'access', 'admins']));

  r.add('POST', '/api/managers', 'manager', 'Grant Planning Manager access to someone on the roster.', async ({ body, principal }) => {
    const input = new Input(await body());
    const raw = input.string('email', 254, true);
    if (raw && !EMAIL.test(raw)) input.error('email', 'Not a valid email address.');
    input.check();
    const email = raw!.toLowerCase();

    let person;
    try {
      person = await app.roster().findByEmail(email);
    } catch (error) {
      if (error instanceof RosterUnavailable) throw new HttpError(503, 'ROSTER_UNAVAILABLE', 'The employee roster cannot be reached right now. Try again shortly.');
      throw error;
    }
    if (!person) throw HttpError.validation({ email: 'This email is not on the employee roster.' });

    const created = await app.managers().grant(email, principal ? actorId(principal) : 'unknown', app.clock().now());
    const grant = (await app.managers().all()).find((m) => m.email === email);
    return json(created ? 201 : 200, { manager: grant });
  }, op('Grant Manager Access', 'Let someone plan and publish shifts', ['A new supervisor needs to plan shifts'], ['Giving someone a planning role'],
    ['email'], ['manager'], ['Planning Manager', 'Person is on the employee roster'], ['GET /api/managers'], ['grant', 'permission', 'manager', 'access']));

  r.add('DELETE', '/api/managers/{email}', 'manager', 'Revoke Planning Manager access.', async ({ params, query, principal }) => {
    const email = params.email.trim().toLowerCase();
    if (!(await app.managers().isManager(email))) throw HttpError.notFound('That person is not on the Planning Manager list.');
    const removingSelf = principal?.email === email && principal.gatewayRole !== 'admin';
    if (removingSelf && (await app.managers().count()) === 1 && query.confirm !== 'true') {
      throw HttpError.conflict('LAST_MANAGER', 'You are the last listed Planning Manager. After this, only gateway admins can manage planning. Repeat with ?confirm=true to continue.');
    }
    await app.managers().revoke(email);
    return noContent();
  }, op('Revoke Manager Access', 'Stop someone managing planning', ['A supervisor changes team or leaves'], ['Removing an employee from the roster'],
    ['email', 'confirm'], [], ['Planning Manager', 'Person is listed'], ['GET /api/managers'], ['revoke', 'remove manager', 'permission']));
}
```

- [ ] **Step 3: Wire it**

Add `managers` to `MODULES`. In `catalog.ts`, extend the "Check Access" capability:
- add `'GET /api/managers', 'POST /api/managers', 'DELETE /api/managers/{email}'` to its `endpoints`;
- add `'Grant or revoke Planning Manager access'` to its `does`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server
git commit -m "feat: let managers grant and revoke Planning Manager access"
```

---

### Task 15: Create, read and edit shifts, with conflict warnings and a notification outbox

**Files:**
- Create: `src/server/repo/shifts.ts`, `src/server/repo/outbox.ts`
- Create: `src/server/scheduling/conflictContext.ts`, `src/server/scheduling/shiftService.ts`, `src/server/routes/shifts.ts`
- Modify: `src/server/app.ts`, `src/server/routes/index.ts`, `src/server/http/catalog.ts`
- Test: `src/server/routes/shifts.int.test.ts`

**Interfaces:**
- Consumes: domain (Tasks 9–10), `Input`, repositories from Tasks 7 and 11–13.
- Produces:
  - `interface ShiftRecord { id; employeeRef; roleId; start: Date; end: Date; breakMinutes; percent; note; state: 'draft' | 'published'; publishedAt; ackBy; ackAt; version; createdBy; deletedAt }`.
  - `factsOf(shift): ShiftFacts`, `shiftToApi(shift, conflicts = [])`, `shiftToMyApi(shift)`.
  - `class ShiftRepository(db, org)` with these methods:
    - `.find(id, withDeleted = false)`
    - `.overlapping(from, to)`, `.forEmployeeOverlapping(ref, from, to)`
    - `.insert(shift, now)`
    - `.update(shift, expectedVersion, now): Promise<boolean>`
    - `.softDelete(id, by, now)`, `.restore(id, now)`
    - `.publish(ids, now): Promise<ShiftRecord[]>`
    - `.publishedForEmployee(ref, from, to)`
  - `class Outbox(db, org)` with `.add(kind, employeeRef, subjectId, payload, deliverAfter, now)`, `.cancelPending(kind, subjectId, now): Promise<number>` and `.all()`. Kinds used in M1: `schedule_published`, `shift_changed`, `shift_assigned`, `shift_unassigned`, `shift_deleted`.
  - `class ConflictContext(shifts, profiles, timeOff, holidays, settings)` with `.conflictsFor(shift): Promise<Conflict[]>`, `.timezoneFor(profile): Promise<string>`, and the static `ConflictContext.spans(timeOff, holidays, zone): UnavailableSpan[]`.
  - `class ShiftService(shifts, profiles, roles, directory, context, outbox, clock)`, with `MAX_DURATION_MS` (7 days) and `UNDO_MS` (30 s). It has `.create(body, by)` and `.update(id, body, by)`, each returning `{ shift, conflicts }`. Task 16 adds `.delete()` and `.restore()`.
  - Endpoints:
    - `POST /api/shifts` returns 201 `{shift}`.
    - `GET /api/shifts/{id}` returns `{shift}`.
    - `PATCH /api/shifts/{id}` requires `version` and returns `{shift}`.
    - Errors: 409 `SHIFT_CONFLICT` with `details.conflicts`, 409 `STALE_SHIFT`, 422.
  - Shift JSON: `{ id, employee_ref, role_id, start_at, end_at, break_minutes, allocated_percent, allocated_hours, note, state, published_at, version, conflicts: [{rule, message}], conflict_acknowledged }`.

- [ ] **Step 1: Write the failing test**

`src/server/routes/shifts.int.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { shifts } from '../db/schema';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
  await h.addEmployee('E2', 'Bo Tan');
});

const create = (overrides: Record<string, unknown> = {}) =>
  h.call('POST', '/api/shifts', { employee_ref: 'E1', start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00', break_minutes: 60, ...overrides });

async function created(overrides: Record<string, unknown> = {}) {
  const { status, body } = await create(overrides);
  expect(status, JSON.stringify(body)).toBe(201);
  return body.shift;
}

const markPublished = (id: string) => h.database.db.update(shifts).set({ state: 'published', publishedAt: h.clock.now() }).where(eq(shifts.id, id));
const outbox = () => new Outbox(h.database.db, ORG).all();

describe('shifts API', () => {
  it('makes an open draft shift from times alone (FR-SHF-01 AC1)', async () => {
    const { status, body } = await h.call('POST', '/api/shifts', { start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T13:00:00+08:00' });
    expect(status).toBe(201);
    expect(body.shift).toMatchObject({ employee_ref: null, state: 'draft', start_at: '2026-10-14T01:00:00Z', allocated_percent: 100, allocated_hours: 4, version: 1, conflicts: [] });
  });

  it("uses the employee's default role unless a role is sent (FR-SHF-01 AC2)", async () => {
    const tech = await h.addRole('Technician');
    await h.call('PATCH', '/api/employees/E1', { role_ids: [tech], default_role_id: tech });
    expect((await created()).role_id).toBe(tech);
    expect((await created({ role_id: null, start_at: '2026-10-15T09:00:00+08:00', end_at: '2026-10-15T17:00:00+08:00' })).role_id).toBeNull();
  });

  it('accepts an overnight shift as one shift (FR-SHF-04)', async () => {
    const shift = await created({ start_at: '2026-10-14T22:00:00+08:00', end_at: '2026-10-15T06:00:00+08:00', break_minutes: 0 });
    expect([shift.start_at, shift.end_at, shift.allocated_hours]).toEqual(['2026-10-14T14:00:00Z', '2026-10-14T22:00:00Z', 8]);
  });

  it('names every bad field instead of failing (Review Focus 4)', async () => {
    const archived = await h.addRole('Old');
    await h.call('PATCH', `/api/roles/${archived}`, { archived: true });
    const { status, body } = await h.call('POST', '/api/shifts', {
      employee_ref: 'E404', role_id: archived, start_at: '2026-10-14T09:00:00', end_at: '2026-02-30T10:00:00+08:00', allocated_percent: 0,
    });
    expect(status).toBe(422);
    expect(Object.keys(body.error.details).sort()).toEqual(['allocated_percent', 'employee_ref', 'end_at', 'role_id', 'start_at']);
    expect((await create({ end_at: '2026-10-14T08:00:00+08:00' })).body.error.details.end_at).toBe('The shift must end after it starts.');
    expect((await create({ break_minutes: 480 })).body.error.details.break_minutes).toBe('The break must be shorter than the shift.');
    expect((await create({ end_at: '2026-10-22T09:00:00+08:00' })).body.error.details.end_at).toBe('A shift can last at most 7 days.');
  });

  it('warns about time off and saves when acknowledged (FR-SHF-09 AC1)', async () => {
    await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: '2026-10-16T00:00:00+08:00', end_at: '2026-10-17T00:00:00+08:00', reason: 'Annual leave' });
    const friday = { start_at: '2026-10-16T09:00:00+08:00', end_at: '2026-10-16T17:00:00+08:00' };
    const refused = await create(friday);
    expect([refused.status, refused.body.error.code, refused.body.error.details.conflicts[0].rule]).toEqual([409, 'SHIFT_CONFLICT', 'unavailable']);
    const saved = await created({ ...friday, acknowledge_conflicts: true });
    expect(saved.conflict_acknowledged).toBe(true);
    expect(saved.conflicts[0].message).toBe('The employee is on time off: Annual leave.');
  });

  it('treats an overlapping full-time shift as a conflict', async () => {
    await created();
    const { status, body } = await create({ start_at: '2026-10-14T16:00:00+08:00', end_at: '2026-10-14T20:00:00+08:00', break_minutes: 0 });
    expect([status, body.error.details.conflicts[0].rule]).toEqual([409, 'overlap']);
  });

  it('moves a shift and refuses a stale edit (Review Focus 1)', async () => {
    const shift = await created();
    const moved = await h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, start_at: '2026-10-15T09:00:00+08:00', end_at: '2026-10-15T18:00:00+08:00' });
    expect([moved.status, moved.body.shift.start_at, moved.body.shift.version]).toEqual([200, '2026-10-15T01:00:00Z', 2]);

    const stale = await h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, note: 'Bring keys' });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'STALE_SHIFT']);
    expect((await h.call('PATCH', `/api/shifts/${shift.id}`, { note: 'no version' })).status).toBe(422);
  });

  it('tells both employees when a published shift is reassigned (FR-SHF-03 AC1, BR-11)', async () => {
    const shift = await created();
    await markPublished(shift.id);
    const { status, body } = await h.call('PATCH', `/api/shifts/${shift.id}`, { version: 1, employee_ref: 'E2' });
    expect([status, body.shift.state]).toEqual([200, 'published']);
    expect((await outbox()).map((r) => [r.kind, r.employee_ref])).toEqual([['shift_unassigned', 'E1'], ['shift_assigned', 'E2']]);
  });

  it('notifies about published changes only', async () => {
    const draft = await created();
    await h.call('PATCH', `/api/shifts/${draft.id}`, { version: 1, note: 'x' });
    expect(await outbox()).toEqual([]);

    const published = await created({ start_at: '2026-10-20T09:00:00+08:00', end_at: '2026-10-20T17:00:00+08:00' });
    await markPublished(published.id);
    await h.call('PATCH', `/api/shifts/${published.id}`, { version: 1, note: 'Bring keys' });
    const [row] = await outbox();
    expect([row.kind, row.payload]).toEqual(['shift_changed', { shift_id: published.id, changed: ['note'] }]);
  });

  it('reads one shift and 404s on unknown ids; employees cannot plan', async () => {
    const shift = await created();
    expect((await h.call('GET', `/api/shifts/${shift.id}`)).body.shift.id).toBe(shift.id);
    expect((await h.call('GET', '/api/shifts/nope')).status).toBe(404);
    expect((await h.call('PATCH', '/api/shifts/nope', { version: 1 })).status).toBe(404);
    h.asEmployee('E1');
    expect((await create()).status).toBe(403);
  });
});
```

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 2: Implement the shift repository and outbox**

`src/server/repo/shifts.ts`:

```ts
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { shifts } from '../db/schema';
import { type ShiftFacts, shiftHours } from '../domain/allocation';
import type { Conflict } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import { isUuid } from '../support/ids';
import { iso } from '../support/time';

export interface ShiftRecord {
  id: string;
  employeeRef: string | null;
  roleId: string | null;
  start: Date;
  end: Date;
  breakMinutes: number;
  percent: number;
  note: string | null;
  state: 'draft' | 'published';
  publishedAt: Date | null;
  ackBy: string | null;
  ackAt: Date | null;
  version: number;
  createdBy: string;
  deletedAt: Date | null;
}

const toRecord = (r: typeof shifts.$inferSelect): ShiftRecord => ({
  id: r.id, employeeRef: r.employeeRef, roleId: r.roleId, start: r.startAt, end: r.endAt, breakMinutes: r.breakMinutes, percent: r.allocatedPercent,
  note: r.note, state: r.state as ShiftRecord['state'], publishedAt: r.publishedAt, ackBy: r.conflictAcknowledgedBy, ackAt: r.conflictAcknowledgedAt,
  version: r.version, createdBy: r.createdBy, deletedAt: r.deletedAt,
});

export function factsOf(s: ShiftRecord): ShiftFacts {
  return { id: s.id, employeeRef: s.employeeRef, roleId: s.roleId, interval: Interval.of(s.start, s.end), breakMinutes: s.breakMinutes, percent: s.percent };
}

export function shiftToApi(s: ShiftRecord, conflicts: Conflict[] = []) {
  return {
    id: s.id, employee_ref: s.employeeRef, role_id: s.roleId, start_at: iso(s.start), end_at: iso(s.end),
    break_minutes: s.breakMinutes, allocated_percent: s.percent, allocated_hours: shiftHours(factsOf(s)), note: s.note,
    state: s.state, published_at: s.publishedAt ? iso(s.publishedAt) : null, version: s.version,
    conflicts, conflict_acknowledged: s.ackAt !== null,
  };
}

/** What an employee sees of their own published shift (FR-MYP-01). */
export function shiftToMyApi(s: ShiftRecord) {
  return { id: s.id, role_id: s.roleId, start_at: iso(s.start), end_at: iso(s.end), break_minutes: s.breakMinutes, allocated_hours: shiftHours(factsOf(s)), note: s.note };
}

export class ShiftRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  private live() {
    return and(eq(shifts.organisationId, this.org), isNull(shifts.deletedAt));
  }

  async find(id: string, withDeleted = false): Promise<ShiftRecord | null> {
    if (!isUuid(id)) return null;
    const scope = withDeleted ? eq(shifts.organisationId, this.org) : this.live();
    const [row] = await this.db.select().from(shifts).where(and(scope, eq(shifts.id, id))).limit(1);
    return row ? toRecord(row) : null;
  }

  /** Live shifts overlapping [from, to), open shifts included. Served by the partial index shifts_live_time_idx. */
  async overlapping(from: Date, to: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts).where(and(this.live(), lt(shifts.startAt, to), gt(shifts.endAt, from))).orderBy(shifts.startAt, shifts.id);
    return rows.map(toRecord);
  }

  async forEmployeeOverlapping(ref: string, from: Date, to: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts)
      .where(and(this.live(), eq(shifts.employeeRef, ref), lt(shifts.startAt, to), gt(shifts.endAt, from))).orderBy(shifts.startAt, shifts.id);
    return rows.map(toRecord);
  }

  async insert(s: ShiftRecord, now: Date): Promise<void> {
    await this.db.insert(shifts).values({
      id: s.id, organisationId: this.org, employeeRef: s.employeeRef, roleId: s.roleId, startAt: s.start, endAt: s.end,
      breakMinutes: s.breakMinutes, allocatedPercent: s.percent, note: s.note, state: s.state, publishedAt: s.publishedAt,
      conflictAcknowledgedBy: s.ackBy, conflictAcknowledgedAt: s.ackAt, version: s.version, createdBy: s.createdBy, createdAt: now, updatedAt: now,
    });
  }

  /** Saves only if nobody else saved since `expectedVersion` (optimistic concurrency); bumps the version. */
  async update(s: ShiftRecord, expectedVersion: number, now: Date): Promise<boolean> {
    const updated = await this.db.update(shifts).set({
      employeeRef: s.employeeRef, roleId: s.roleId, startAt: s.start, endAt: s.end, breakMinutes: s.breakMinutes, allocatedPercent: s.percent,
      note: s.note, conflictAcknowledgedBy: s.ackBy, conflictAcknowledgedAt: s.ackAt, version: expectedVersion + 1, updatedAt: now,
    }).where(and(this.live(), eq(shifts.id, s.id), eq(shifts.version, expectedVersion))).returning({ id: shifts.id });
    return updated.length === 1;
  }

  async softDelete(id: string, by: string, now: Date): Promise<void> {
    await this.db.update(shifts).set({ deletedAt: now, deletedBy: by, updatedAt: now }).where(and(this.live(), eq(shifts.id, id)));
  }

  async restore(id: string, now: Date): Promise<void> {
    await this.db.update(shifts).set({ deletedAt: null, deletedBy: null, updatedAt: now }).where(and(eq(shifts.organisationId, this.org), eq(shifts.id, id)));
  }

  /** Publishes the listed drafts; deleted, already-published and unknown ids are skipped. Rows are locked so two publishes cannot overlap. */
  async publish(ids: string[], now: Date): Promise<ShiftRecord[]> {
    const valid = ids.filter(isUuid);
    if (valid.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const drafts = await tx.select({ id: shifts.id }).from(shifts)
        .where(and(this.live(), eq(shifts.state, 'draft'), inArray(shifts.id, valid))).orderBy(shifts.startAt, shifts.id).for('update');
      if (drafts.length === 0) return [];
      const published = await tx.update(shifts).set({ state: 'published', publishedAt: now, updatedAt: now })
        .where(and(eq(shifts.organisationId, this.org), inArray(shifts.id, drafts.map((d) => d.id)))).returning();
      return published.map(toRecord).sort((a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id));
    });
  }

  async publishedForEmployee(ref: string, from: Date, to: Date): Promise<ShiftRecord[]> {
    const rows = await this.db.select().from(shifts)
      .where(and(this.live(), eq(shifts.employeeRef, ref), eq(shifts.state, 'published'), lt(shifts.startAt, to), gt(shifts.endAt, from)))
      .orderBy(shifts.startAt);
    return rows.map(toRecord);
  }
}
```

`src/server/repo/outbox.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notificationOutbox } from '../db/schema';
import { iso } from '../support/time';

/**
 * Notifications waiting to be delivered. M1 only records them; M2 adds
 * delivery (roadmap). Writing them in the same request as the change means
 * nothing is lost when delivery is added.
 */
export class Outbox {
  constructor(private readonly db: Db, private readonly org: string) {}

  async add(kind: string, employeeRef: string | null, subjectId: string | null, payload: Record<string, unknown>, deliverAfter: Date, now: Date): Promise<void> {
    await this.db.insert(notificationOutbox).values({ organisationId: this.org, kind, employeeRef, subjectId, payload, deliverAfter, createdAt: now });
  }

  async cancelPending(kind: string, subjectId: string, now: Date): Promise<number> {
    const cancelled = await this.db.update(notificationOutbox).set({ cancelledAt: now })
      .where(and(eq(notificationOutbox.organisationId, this.org), eq(notificationOutbox.kind, kind), eq(notificationOutbox.subjectId, subjectId),
        isNull(notificationOutbox.deliveredAt), isNull(notificationOutbox.cancelledAt)))
      .returning({ id: notificationOutbox.id });
    return cancelled.length;
  }

  async all() {
    const rows = await this.db.select().from(notificationOutbox).where(eq(notificationOutbox.organisationId, this.org)).orderBy(notificationOutbox.id);
    return rows.map((r) => ({ kind: r.kind, employee_ref: r.employeeRef, subject_id: r.subjectId, payload: r.payload, deliver_after: iso(r.deliverAfter), cancelled: r.cancelledAt !== null }));
  }
}
```

- [ ] **Step 3: Implement conflict context and the shift service**

`src/server/scheduling/conflictContext.ts`:

```ts
import { type Conflict, conflictsForEmployee, type UnavailableSpan } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import type { HolidayRepository } from '../repo/holidays';
import type { Profile, ProfileRepository } from '../repo/profiles';
import type { SettingsRepository } from '../repo/settings';
import { factsOf, type ShiftRecord, type ShiftRepository } from '../repo/shifts';
import type { TimeOff, TimeOffRepository } from '../repo/timeOff';
import { localDate, localMidnight, nextDay } from '../support/time';

/** Loads what BR-01 needs for one shift and runs the pure detector. */
export class ConflictContext {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly timeOff: TimeOffRepository,
    private readonly holidays: HolidayRepository,
    private readonly settings: SettingsRepository,
  ) {}

  /** Conflicts the shift would have if saved as given. Open shifts never conflict. */
  async conflictsFor(candidate: ShiftRecord): Promise<Conflict[]> {
    if (!candidate.employeeRef) return [];
    const profile = await this.profiles.find(candidate.employeeRef);
    const zone = await this.timezoneFor(profile);
    const [others, away, holidays] = await Promise.all([
      this.shifts.forEmployeeOverlapping(candidate.employeeRef, candidate.start, candidate.end),
      this.timeOff.between(candidate.start, candidate.end, candidate.employeeRef),
      this.holidays.visibleBetween(localDate(candidate.start.getTime(), zone), localDate(candidate.end.getTime(), zone)),
    ]);
    const facts = [...others.filter((s) => s.id !== candidate.id).map(factsOf), factsOf(candidate)];
    return conflictsForEmployee(facts, ConflictContext.spans(away, holidays, zone), profile.roleIds).get(candidate.id) ?? [];
  }

  async timezoneFor(profile: Profile): Promise<string> {
    return profile.timezone ?? (await this.settings.timezone());
  }

  /** Time off plus visible holidays (whole local days in `zone`, so 23- and 25-hour days are right) as spans for the detector. */
  static spans(timeOff: TimeOff[], holidays: { date: string; name: string }[], zone: string): UnavailableSpan[] {
    return [
      ...timeOff.map((t): UnavailableSpan => ({ interval: Interval.of(t.start, t.end), kind: 'time_off', label: t.reason })),
      ...holidays.map((h): UnavailableSpan => ({
        interval: new Interval(localMidnight(h.date, zone), localMidnight(nextDay(h.date), zone)),
        kind: 'holiday',
        label: h.name,
      })),
    ];
  }
}
```

`src/server/scheduling/shiftService.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { actorId, type Principal } from '../auth/principal';
import type { Conflict } from '../domain/conflicts';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import type { DirectoryRepository } from '../repo/directory';
import type { Outbox } from '../repo/outbox';
import type { ProfileRepository } from '../repo/profiles';
import type { RoleRepository } from '../repo/roles';
import type { ShiftRecord, ShiftRepository } from '../repo/shifts';
import type { Clock } from '../support/clock';
import type { ConflictContext } from './conflictContext';

export const MAX_DURATION_MS = 7 * 86_400_000;
export const UNDO_MS = 30_000;

const NOTIFY_FIELDS: [keyof ShiftRecord, string][] = [
  ['employeeRef', 'employee'], ['roleId', 'role'], ['start', 'start'], ['end', 'end'], ['breakMinutes', 'break'], ['percent', 'allocation'], ['note', 'note'],
];
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const stale = () => HttpError.conflict('STALE_SHIFT', 'Someone else changed this shift since you loaded it. Reload and try again.');

/** FR-SHF-*, BR-01/02/11. Managers are warned about conflicts, never blocked (FR-SHF-09). */
export class ShiftService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly roles: RoleRepository,
    private readonly directory: DirectoryRepository,
    private readonly context: ConflictContext,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
  ) {}

  async create(body: Record<string, unknown>, by: Principal): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const input = new Input(body);
    const employeeRef = input.string('employee_ref', 64);
    await this.validateEmployee(input, employeeRef);
    let roleId = input.has('role_id') ? input.string('role_id', 36) : null;
    if (!input.has('role_id') && employeeRef) roleId = (await this.profiles.find(employeeRef)).defaultRoleId; // FR-SHF-01 AC2
    await this.validateRole(input, roleId);
    const start = input.instant('start_at', true);
    const end = input.instant('end_at', true);
    const breakMinutes = input.int('break_minutes', 0, 1440, 0)!;
    const percent = input.int('allocated_percent', 1, 100, 100)!;
    const note = input.string('note', 2000);
    const acknowledged = input.bool('acknowledge_conflicts');
    validateTimes(input, start, end, breakMinutes);
    input.check();

    const now = this.clock.now();
    const draft: ShiftRecord = {
      id: randomUUID(), employeeRef, roleId, start: start!, end: end!, breakMinutes, percent, note, state: 'draft', publishedAt: null,
      ackBy: null, ackAt: null, version: 1, createdBy: actorId(by), deletedAt: null,
    };
    const { shift, conflicts } = await this.guardConflicts(draft, acknowledged, by, now);
    await this.shifts.insert(shift, now);
    return { shift, conflicts };
  }

  async update(id: string, body: Record<string, unknown>, by: Principal): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const current = (await this.shifts.find(id)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    const input = new Input(body);
    const version = input.int('version', 1, Number.MAX_SAFE_INTEGER);
    if (version === null) input.error('version', 'Send the version you last loaded, so edits made by someone else are not overwritten.');

    const next: ShiftRecord = { ...current };
    if (input.has('employee_ref')) {
      next.employeeRef = input.string('employee_ref', 64);
      if (next.employeeRef !== current.employeeRef) await this.validateEmployee(input, next.employeeRef);
    }
    if (input.has('role_id')) {
      next.roleId = input.string('role_id', 36);
      if (next.roleId !== current.roleId) await this.validateRole(input, next.roleId);
    }
    if (input.has('start_at')) next.start = input.instant('start_at', true) ?? current.start;
    if (input.has('end_at')) next.end = input.instant('end_at', true) ?? current.end;
    if (input.has('break_minutes')) next.breakMinutes = input.int('break_minutes', 0, 1440, current.breakMinutes)!;
    if (input.has('allocated_percent')) next.percent = input.int('allocated_percent', 1, 100, current.percent)!;
    if (input.has('note')) next.note = input.string('note', 2000);
    const acknowledged = input.bool('acknowledge_conflicts');
    validateTimes(input, next.start, next.end, next.breakMinutes);
    input.check();

    if (version !== current.version) throw stale();
    const now = this.clock.now();
    const { shift, conflicts } = await this.guardConflicts(next, acknowledged, by, now);
    if (!(await this.shifts.update(shift, current.version, now))) throw stale();
    const saved = (await this.shifts.find(id))!;
    if (current.state === 'published') await this.notifyChange(current, saved, now); // BR-11: stays published; employees are told
    return { shift: saved, conflicts };
  }

  private async guardConflicts(shift: ShiftRecord, acknowledged: boolean, by: Principal, now: Date): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const conflicts = await this.context.conflictsFor(shift);
    if (conflicts.length === 0) return { shift: { ...shift, ackBy: null, ackAt: null }, conflicts };
    if (!acknowledged) {
      throw HttpError.conflict('SHIFT_CONFLICT', 'This shift breaks a planning rule. Send acknowledge_conflicts: true to save it anyway.', { conflicts });
    }
    return { shift: { ...shift, ackBy: actorId(by), ackAt: now }, conflicts };
  }

  private async notifyChange(before: ShiftRecord, after: ShiftRecord, now: Date): Promise<void> {
    const changed = NOTIFY_FIELDS.filter(([field]) => !same(before[field], after[field])).map(([, label]) => label);
    if (changed.length === 0) return;
    if (before.employeeRef !== after.employeeRef) {
      if (before.employeeRef) await this.outbox.add('shift_unassigned', before.employeeRef, after.id, { shift_id: after.id }, now, now);
      if (after.employeeRef) await this.outbox.add('shift_assigned', after.employeeRef, after.id, { shift_id: after.id }, now, now);
      return;
    }
    if (after.employeeRef) await this.outbox.add('shift_changed', after.employeeRef, after.id, { shift_id: after.id, changed }, now, now);
  }

  private async validateEmployee(input: Input, employeeRef: string | null): Promise<void> {
    // An empty directory means the roster could not be loaded yet; never block planning on that (NFR-06).
    if (employeeRef && !(await this.directory.isEmpty()) && !(await this.directory.find(employeeRef))) {
      input.error('employee_ref', 'Not on the employee roster.');
    }
  }

  private async validateRole(input: Input, roleId: string | null): Promise<void> {
    if (!roleId) return;
    const role = await this.roles.find(roleId);
    if (!role) input.error('role_id', 'Unknown role.');
    else if (role.archived) input.error('role_id', 'This role is archived.');
  }
}

function validateTimes(input: Input, start: Date | null, end: Date | null, breakMinutes: number): void {
  if (!start || !end) return;
  if (end <= start) {
    input.error('end_at', 'The shift must end after it starts.');
    return;
  }
  const ms = end.getTime() - start.getTime();
  if (ms > MAX_DURATION_MS) input.error('end_at', 'A shift can last at most 7 days.');
  if (breakMinutes * 60_000 >= ms) input.error('break_minutes', 'The break must be shorter than the shift.');
}
```


- [ ] **Step 4: Implement the routes and wire them**

`src/server/routes/shifts.ts`:

```ts
import type { App } from '../app';
import type { Principal } from '../auth/principal';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { shiftToApi } from '../repo/shifts';

export const actor = (p: Principal | null): Principal => p ?? (() => { throw HttpError.unauthorized('Sign in through the InterlinkERP gateway first.'); })();

export function register(r: Router, app: App): void {
  r.add('POST', '/api/shifts', 'manager', 'Create a draft shift, or duplicate an existing one.', async ({ body, principal }) => {
    const { shift, conflicts } = await app.shiftService().create(await body(), actor(principal));
    return json(201, { shift: shiftToApi(shift, conflicts) });
  }, op('Create Shift', 'Plan a block of work for an employee or as an open shift', ['Adding a shift to the schedule', 'Copying a shift with duplicate_of'], ['Moving an existing shift'],
    ['employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts', 'duplicate_of'],
    ['shift', 'shift.conflicts'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'POST /api/publications'],
    ['shift', 'schedule', 'plan', 'roster', 'rota', 'create']));

  r.add('GET', '/api/shifts/{id}', 'manager', 'Read one shift with its current conflicts.', async ({ params }) => {
    const shift = (await app.shifts().find(params.id)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    return json(200, { shift: shiftToApi(shift, await app.conflictContext().conflictsFor(shift)) });
  }, op('Read Shift', 'See one shift in detail', ['Opening a shift to edit it'], ['Listing a week of shifts'],
    ['id'], ['shift'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'GET /api/schedule'], ['shift', 'details']));

  r.add('PATCH', '/api/shifts/{id}', 'manager', 'Move, resize, reassign or edit a shift.', async ({ params, body, principal }) => {
    const { shift, conflicts } = await app.shiftService().update(params.id, await body(), actor(principal));
    return json(200, { shift: shiftToApi(shift, conflicts) });
  }, op('Update Shift', "Change a shift's time, employee, role or details", ['Dragging a shift to another day or person', 'Changing the note'], ['Creating a shift'],
    ['version', 'employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts'],
    ['shift'], ['Planning Manager', 'Latest version of the shift'], ['GET /api/shifts/{id}'], ['move', 'reassign', 'edit shift', 'resize']));
}
```

Add these `App` getters (each cached with `once`):
- `shifts()`: `new ShiftRepository(db, org)`
- `outbox()`: `new Outbox(db, org)`
- `conflictContext()`: `new ConflictContext(this.shifts(), this.profiles(), this.timeOff(), this.holidays(), this.settings())`
- `shiftService()`: `new ShiftService(this.shifts(), this.profiles(), this.roles(), this.directory(), this.conflictContext(), this.outbox(), this.clock())`

Add `shifts` to `MODULES`, then append to `capabilities`:

```ts
    {
      name: 'Plan Shifts',
      icon: '🗓️',
      description: 'Create and change shifts, with warnings when a shift breaks a planning rule.',
      does: ['Create a shift', 'Move or reassign a shift', 'Duplicate or delete a shift', 'Undo a deletion'],
      best_for: 'Managers building and adjusting the team schedule.',
      endpoints: ['POST /api/shifts', 'GET /api/shifts/{id}', 'PATCH /api/shifts/{id}'],
    },
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server
git commit -m "feat: create and edit shifts with conflict warnings and change notifications"
```

---

### Task 16: Delete with undo, and duplicate

**Files:**
- Modify: `src/server/scheduling/shiftService.ts` (`delete`, `restore`, `duplicate`; `create` hands `duplicate_of` to `duplicate`)
- Modify: `src/server/routes/shifts.ts` (two routes), `src/server/http/catalog.ts`
- Test: `src/server/routes/shiftDeletion.int.test.ts`

**Interfaces:**
- Consumes: Task 15.
- Produces:
  - `ShiftService.delete(id, by)` and `.restore(id, by): Promise<ShiftRecord>`.
  - `POST /api/shifts {duplicate_of, start_at?, acknowledge_conflicts?}` makes a copy. Without `start_at`, the copy is one day later.
  - `DELETE /api/shifts/{id}` returns 204.
  - `POST /api/shift-restorations {shift_id}` returns 201 `{shift}`, 404, or 409 `UNDO_EXPIRED`.
  - Deleting a published, assigned shift queues `shift_deleted` with `deliver_after = now + 30s`. Restoring cancels it (FR-SHF-07 AC1, FR-NTF-02).

- [ ] **Step 1: Write the failing test**

`src/server/routes/shiftDeletion.int.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { shifts } from '../db/schema';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(() => h.addEmployee('E1', 'Ana Lim'));
const outbox = () => new Outbox(h.database.db, ORG).all();

async function shift(published = false) {
  const { body } = await h.call('POST', '/api/shifts', { employee_ref: 'E1', start_at: '2026-10-14T09:00:00+08:00', end_at: '2026-10-14T17:00:00+08:00' });
  if (published) await h.database.db.update(shifts).set({ state: 'published' }).where(eq(shifts.id, body.shift.id));
  return body.shift;
}

describe('delete, undo and duplicate', () => {
  it('deletes a draft without telling anyone', async () => {
    const s = await shift();
    expect((await h.call('DELETE', `/api/shifts/${s.id}`)).status).toBe(204);
    expect((await h.call('GET', `/api/shifts/${s.id}`)).status).toBe(404);
    expect(await outbox()).toEqual([]);
    expect((await h.call('DELETE', `/api/shifts/${s.id}`)).status).toBe(404);
  });

  it('undo within the window restores the shift and cancels the notice (FR-SHF-07 AC1)', async () => {
    const s = await shift(true);
    await h.call('DELETE', `/api/shifts/${s.id}`);
    expect((await outbox())[0]).toMatchObject({ kind: 'shift_deleted', deliver_after: '2026-10-13T02:00:30Z', cancelled: false });

    h.clock.advance(10);
    const { status, body } = await h.call('POST', '/api/shift-restorations', { shift_id: s.id });
    expect([status, body.shift.id]).toEqual([201, s.id]);
    expect((await h.call('GET', `/api/shifts/${s.id}`)).status).toBe(200);
    expect((await outbox())[0].cancelled).toBe(true);
  });

  it('refuses undo after the window and for shifts that were not deleted', async () => {
    const s = await shift();
    expect((await h.call('POST', '/api/shift-restorations', { shift_id: s.id })).status).toBe(404);
    await h.call('DELETE', `/api/shifts/${s.id}`);
    h.clock.advance(31);
    expect((await h.call('POST', '/api/shift-restorations', { shift_id: s.id })).body.error.code).toBe('UNDO_EXPIRED');
  });

  it('duplicates to the next day as a draft', async () => {
    const s = await shift(true);
    const { status, body } = await h.call('POST', '/api/shifts', { duplicate_of: s.id });
    expect(status).toBe(201);
    expect(body.shift).toMatchObject({ state: 'draft', employee_ref: 'E1', start_at: '2026-10-15T01:00:00Z', end_at: '2026-10-15T09:00:00Z' });
    expect(body.shift.id).not.toBe(s.id);
  });

  it('warns when the copy lands on top of the original', async () => {
    const s = await shift();
    const clash = { duplicate_of: s.id, start_at: '2026-10-14T10:00:00+08:00' };
    expect((await h.call('POST', '/api/shifts', clash)).body.error.code).toBe('SHIFT_CONFLICT');
    const { status, body } = await h.call('POST', '/api/shifts', { ...clash, acknowledge_conflicts: true });
    expect([status, body.shift.start_at, body.shift.end_at]).toEqual([201, '2026-10-14T02:00:00Z', '2026-10-14T10:00:00Z']);
  });

  it('404s when duplicating a missing shift', async () => {
    expect((await h.call('POST', '/api/shifts', { duplicate_of: 'nope' })).status).toBe(404);
  });
});
```

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 2: Add delete, restore and duplicate to the service**

In `ShiftService.create`, add this as the first statement after `const input = new Input(body);`:

```ts
    if (input.has('duplicate_of')) return this.duplicate(input, by);
```

Add these methods to `ShiftService` (and `import { iso } from '../support/time';`):

```ts
  async delete(id: string, by: Principal): Promise<void> {
    const shift = (await this.shifts.find(id)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    const now = this.clock.now();
    await this.shifts.softDelete(id, actorId(by), now);
    if (shift.state === 'published' && shift.employeeRef) {
      // Sent only after the undo window, so an undone deletion never reaches the employee (FR-NTF-02).
      await this.outbox.add('shift_deleted', shift.employeeRef, shift.id, { shift_id: shift.id, start_at: iso(shift.start), end_at: iso(shift.end) },
        new Date(now.getTime() + UNDO_MS), now);
    }
  }

  async restore(id: string, _by: Principal): Promise<ShiftRecord> {
    const shift = await this.shifts.find(id, true);
    if (!shift || !shift.deletedAt) throw HttpError.notFound('No deleted shift with that id.');
    const now = this.clock.now();
    if (now.getTime() - shift.deletedAt.getTime() > UNDO_MS) throw HttpError.conflict('UNDO_EXPIRED', 'This deletion can no longer be undone.');
    await this.shifts.restore(id, now);
    await this.outbox.cancelPending('shift_deleted', id, now);
    return (await this.shifts.find(id))!;
  }

  private async duplicate(input: Input, by: Principal): Promise<{ shift: ShiftRecord; conflicts: Conflict[] }> {
    const sourceId = input.string('duplicate_of', 36, true);
    const start = input.instant('start_at');
    const acknowledged = input.bool('acknowledge_conflicts');
    input.check();
    const source = (await this.shifts.find(sourceId!)) ?? (() => { throw HttpError.notFound('No shift with that id.'); })();
    const offset = start ? start.getTime() - source.start.getTime() : 86_400_000;
    const now = this.clock.now();
    const copy: ShiftRecord = {
      ...source, id: randomUUID(), start: new Date(source.start.getTime() + offset), end: new Date(source.end.getTime() + offset),
      state: 'draft', publishedAt: null, version: 1, createdBy: actorId(by), deletedAt: null,
    };
    const result = await this.guardConflicts(copy, acknowledged, by, now);
    await this.shifts.insert(result.shift, now);
    return result;
  }
```

- [ ] **Step 3: Add the routes**

Append to `register` in `src/server/routes/shifts.ts` (import `Input` and `noContent`):

```ts
  r.add('DELETE', '/api/shifts/{id}', 'manager', 'Delete a shift (can be undone for 30 seconds).', async ({ params, principal }) => {
    await app.shiftService().delete(params.id, actor(principal));
    return noContent();
  }, op('Delete Shift', 'Remove a shift from the schedule', ['A shift is no longer needed'], ['Giving a shift to someone else (reassign it instead)'],
    ['id'], [], ['Planning Manager'], ['POST /api/shift-restorations'], ['delete', 'remove shift', 'cancel shift']));

  r.add('POST', '/api/shift-restorations', 'manager', 'Undo a shift deletion made in the last 30 seconds.', async ({ body, principal }) => {
    const input = new Input(await body());
    const id = input.string('shift_id', 36, true);
    input.check();
    const shift = await app.shiftService().restore(id!, actor(principal));
    return json(201, { shift: shiftToApi(shift, await app.conflictContext().conflictsFor(shift)) });
  }, op('Undo Shift Deletion', 'Bring back a shift that was just deleted', ['A shift was deleted by mistake'], ['Restoring a shift deleted long ago'],
    ['shift_id'], ['shift'], ['Planning Manager', 'Deleted less than 30 seconds ago'], ['DELETE /api/shifts/{id}'], ['undo', 'restore', 'undelete']));
```

Add `'DELETE /api/shifts/{id}', 'POST /api/shift-restorations'` to the "Plan Shifts" capability's `endpoints`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server
git commit -m "feat: delete shifts with undo and duplicate shifts"
```

---

### Task 17: The schedule read model

**Files:**
- Create: `src/server/scheduling/scheduleService.ts`, `src/server/routes/schedule.ts`
- Modify: `src/server/app.ts`, `src/server/routes/index.ts`, `src/server/http/catalog.ts`
- Test: `src/server/routes/schedule.int.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 7–16.
- Produces:
  - `MAX_RANGE_DAYS = 62`.
  - `class ScheduleService(shifts, profiles, roles, directory, refresher, timeOff, holidays, settings, clock)` with `.build(fromDate, toDate)`.
  - `GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` (manager). Dates are inclusive and in the organisation's time zone. The response is:

```json
{
  "period": {"from": "2026-10-12", "to": "2026-10-18", "timezone": "Asia/Kuala_Lumpur", "from_at": "2026-10-11T16:00:00Z", "to_at": "2026-10-18T16:00:00Z"},
  "directory_stale": false,
  "roles": [{"id": "", "name": "", "color": "", "archived": false}],
  "employees": [{
    "employee_ref": "E1", "name": "Ana Lim", "photo_url": null, "department_id": null, "department_name": null,
    "status": "Active", "on_roster": true, "role_ids": [], "default_role_id": null, "timezone": "Asia/Kuala_Lumpur",
    "flexible": false, "allocated_hours": 8, "available_hours": 40, "over_allocated_days": [],
    "working_intervals": [{"start_at": "", "end_at": ""}],
    "unavailable": [{"start_at": "", "end_at": "", "kind": "time_off|holiday", "label": ""}]
  }],
  "shifts": ["<shift JSON from Task 15, including open shifts>"]
}
```

How the response is built:
- **Employee rows:** every directory employee, plus anyone who has a visible shift but is no longer in the directory (shown as "Unknown employee", `on_roster: false`). Rows are sorted by name.
- **Conflicts** use a window 7 days wider on each side, so overlaps with shifts just outside the period are still found.
- **Hours** cover only the period's local days, in the employee's time zone.
- **Query count** is fixed and doesn't grow with the number of employees (NFR-01).

- [ ] **Step 1: Write the failing test**

`src/server/routes/schedule.int.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { employeeDirectory } from '../db/schema';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
const WEEK = { from: '2026-10-12', to: '2026-10-18' };

async function week() {
  const { status, body } = await h.call('GET', '/api/schedule', undefined, WEEK);
  expect(status, JSON.stringify(body)).toBe(200);
  return body;
}

const row = (schedule: { employees: any[] }, ref: string) => schedule.employees.find((e: { employee_ref: string }) => e.employee_ref === ref);

async function shift(ref: string | null, start: string, end: string, ack = false) {
  const { status, body } = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: start, end_at: end, acknowledge_conflicts: ack });
  expect(status, JSON.stringify(body)).toBe(201);
}

describe('GET /api/schedule', () => {
  it('gives every employee a row and includes open shifts (FR-SCH-01 AC1, FR-SCH-02)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await h.addEmployee('E2', 'Bo Tan');
    await shift(null, '2026-10-14T09:00:00+08:00', '2026-10-14T13:00:00+08:00');
    const schedule = await week();
    expect(schedule.employees.map((e: { name: string }) => e.name)).toEqual(['Ana Lim', 'Bo Tan']);
    expect(schedule.shifts.map((s: { employee_ref: string | null }) => s.employee_ref)).toEqual([null]);
    expect(schedule.period).toEqual({ from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Kuala_Lumpur', from_at: '2026-10-11T16:00:00Z', to_at: '2026-10-18T16:00:00Z' });
  });

  it('reports hours, markers and conflicts (FR-SCH-07, 08, 09; BR-03, BR-04)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    const day = [['09:00', '13:00'], ['14:00', '18:00']];
    await h.call('PATCH', '/api/employees/E1', { working_hours: { mon: day, tue: day, wed: day, thu: day, fri: day } });
    await h.call('POST', '/api/unavailabilities', { employee_ref: 'E1', start_at: '2026-10-16T00:00:00+08:00', end_at: '2026-10-17T00:00:00+08:00', reason: 'Annual leave' });
    await h.call('POST', '/api/holidays', { date: '2026-10-15', name: 'Company Day' });
    await shift('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    await shift('E1', '2026-10-17T09:00:00+08:00', '2026-10-17T13:00:00+08:00'); // Saturday: outside hours is not a conflict (BR-03)
    await shift('E1', '2026-10-16T09:00:00+08:00', '2026-10-16T12:00:00+08:00', true);

    const schedule = await week();
    const ana = row(schedule, 'E1');
    expect(ana).toMatchObject({ flexible: false, allocated_hours: 15, available_hours: 24, over_allocated_days: ['2026-10-16', '2026-10-17'] });
    expect(ana.working_intervals).toHaveLength(10);
    expect(ana.unavailable.map((u: { kind: string }) => u.kind).sort()).toEqual(['holiday', 'time_off']);

    const byStart = Object.fromEntries(schedule.shifts.map((s: { start_at: string }) => [s.start_at, s]));
    expect(byStart['2026-10-17T01:00:00Z'].conflicts).toEqual([]);
    expect(byStart['2026-10-16T01:00:00Z'].conflicts[0].rule).toBe('unavailable');
    expect(byStart['2026-10-16T01:00:00Z'].conflict_acknowledged).toBe(true);
  });

  it('shows flexible-hours employees without availability', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    expect(row(await week(), 'E1')).toMatchObject({ flexible: true, available_hours: null, over_allocated_days: [] });
  });

  it('keeps shifts of someone who left the roster visible (Review Focus 3)', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shift('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    await h.database.db.delete(employeeDirectory).where(eq(employeeDirectory.employeeRef, 'E1'));
    await h.addEmployee('E2', 'Bo Tan');
    expect(row(await week(), 'E1')).toMatchObject({ name: 'Unknown employee', on_roster: false });
  });

  it('still loads while the roster is down (Review Focus 2, NFR-06)', async () => {
    h.roster.down = true;
    await shift('E9', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
    const schedule = await week();
    expect(schedule.directory_stale).toBe(true);
    expect(schedule.employees.map((e: { employee_ref: string }) => e.employee_ref)).toEqual(['E9']);
  });

  it('finds a conflict with a shift just outside the period', async () => {
    await h.addEmployee('E1', 'Ana Lim');
    await shift('E1', '2026-10-18T20:00:00+08:00', '2026-10-19T04:00:00+08:00');
    await shift('E1', '2026-10-19T00:00:00+08:00', '2026-10-19T08:00:00+08:00', true);
    expect((await week()).shifts[0].conflicts[0].rule).toBe('overlap');
  });

  it('validates the range and is for managers only', async () => {
    expect((await h.call('GET', '/api/schedule', undefined, { from: '2026-10-12' })).status).toBe(422);
    expect((await h.call('GET', '/api/schedule', undefined, { from: '2026-01-01', to: '2026-12-31' })).status).toBe(422);
    h.asEmployee('E1');
    expect((await h.call('GET', '/api/schedule', undefined, WEEK)).status).toBe(403);
  });
});
```

The numbers in the hours test:
- Allocated hours: Wednesday 8 + Friday 3 + Saturday 4 = 15.
- Available hours: 40 − 8 (Thursday holiday) − 8 (Friday leave) = 24.
- Over-allocated days: Friday (3 > 0) and Saturday (4 > 0). Wednesday is exactly at its limit (8 of 8), so it is not over.

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 2: Implement the service and route**

`src/server/scheduling/scheduleService.ts`:

```ts
import { allocatedByDay, availableByDay, overAllocatedDays } from '../domain/allocation';
import { type Conflict, conflictsForEmployee } from '../domain/conflicts';
import { Interval } from '../domain/interval';
import { workingIntervals } from '../domain/workingHours';
import type { DirectoryRepository, DirectoryRow } from '../repo/directory';
import type { HolidayRepository } from '../repo/holidays';
import { blankProfile, type ProfileRepository } from '../repo/profiles';
import type { RoleRepository } from '../repo/roles';
import type { SettingsRepository } from '../repo/settings';
import { factsOf, type ShiftRecord, type ShiftRepository, shiftToApi } from '../repo/shifts';
import type { TimeOff, TimeOffRepository } from '../repo/timeOff';
import { DIRECTORY_MAX_AGE_SECONDS, type DirectoryRefresher } from '../roster/refresher';
import type { Clock } from '../support/clock';
import { iso, localDate, localMidnight, nextDay } from '../support/time';
import { ConflictContext } from './conflictContext';

export const MAX_RANGE_DAYS = 62;
const CONTEXT_MARGIN_MS = 7 * 86_400_000; // the longest possible shift

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (byDay: Record<string, number>) => round2(Object.values(byDay).reduce((a, b) => a + b, 0));

/** Everything the schedule screen needs, in a fixed number of queries (FR-SCH-01..09, NFR-01). */
export class ScheduleService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly profiles: ProfileRepository,
    private readonly roles: RoleRepository,
    private readonly directory: DirectoryRepository,
    private readonly refresher: DirectoryRefresher,
    private readonly timeOff: TimeOffRepository,
    private readonly holidays: HolidayRepository,
    private readonly settings: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async build(fromDate: string, toDate: string) {
    const orgZone = await this.settings.timezone();
    const from = localMidnight(fromDate, orgZone);
    const to = localMidnight(nextDay(toDate), orgZone);
    const period = new Interval(from, to);
    const wideFrom = new Date(from - CONTEXT_MARGIN_MS);
    const wideTo = new Date(to + CONTEXT_MARGIN_MS);

    await this.refresher.refreshIfEmpty();
    const [directoryRows, profiles, allShifts, timeOffRows, holidays, roles, lastFetched] = await Promise.all([
      this.directory.all(),
      this.profiles.all(),
      this.shifts.overlapping(wideFrom, wideTo),
      this.timeOff.between(wideFrom, wideTo),
      this.holidays.visibleBetween(localDate(wideFrom.getTime(), orgZone), localDate(wideTo.getTime(), orgZone)),
      this.roles.all(),
      this.directory.lastFetchedAt(),
    ]);

    const directory = new Map<string, DirectoryRow>(directoryRows.map((d) => [d.employeeRef, d]));
    const visible = allShifts.filter((s) => s.start.getTime() < to && s.end.getTime() > from);
    const byEmployee = groupBy(allShifts.filter((s) => s.employeeRef), (s) => s.employeeRef!);
    const awayByEmployee = groupBy(timeOffRows, (t: TimeOff) => t.employeeRef);
    const refs = [...new Set([...directory.keys(), ...visible.flatMap((s) => (s.employeeRef ? [s.employeeRef] : []))])];

    const conflicts = new Map<string, Conflict[]>();
    const employees = refs.map((ref) => {
      const profile = profiles.get(ref) ?? blankProfile(ref);
      const zone = profile.timezone ?? orgZone;
      const mine = byEmployee.get(ref) ?? [];
      const facts = mine.map(factsOf);
      const spans = ConflictContext.spans(awayByEmployee.get(ref) ?? [], holidays, zone);
      for (const [id, list] of conflictsForEmployee(facts, spans, profile.roleIds)) conflicts.set(id, list);

      const working = profile.workingHours ? workingIntervals(profile.workingHours, from, to, zone) : [];
      const periodSpans = spans.filter((s) => s.interval.overlaps(period));
      const available = profile.workingHours ? availableByDay(working, periodSpans.map((s) => s.interval), zone) : null;
      const firstDay = localDate(from, zone);
      const endDay = localDate(to, zone);
      const allocated = Object.fromEntries(Object.entries(allocatedByDay(facts, zone)).filter(([d]) => d >= firstDay && d < endDay));
      const d = directory.get(ref);

      return {
        employee_ref: ref,
        name: d?.displayName ?? 'Unknown employee',
        photo_url: d?.photoUrl ?? null,
        department_id: d?.departmentId ?? null,
        department_name: d?.departmentName ?? null,
        status: d?.status ?? 'unknown',
        on_roster: d !== undefined,
        role_ids: profile.roleIds,
        default_role_id: profile.defaultRoleId,
        timezone: zone,
        flexible: profile.workingHours === null,
        allocated_hours: sum(allocated),
        available_hours: available ? sum(available) : null,
        over_allocated_days: overAllocatedDays(allocated, available),
        working_intervals: working.map((i) => ({ start_at: iso(i.start), end_at: iso(i.end) })),
        unavailable: periodSpans.map((s) => ({ start_at: iso(s.interval.start), end_at: iso(s.interval.end), kind: s.kind, label: s.label })),
      };
    });
    employees.sort((a, b) => a.name.localeCompare(b.name) || a.employee_ref.localeCompare(b.employee_ref));

    return {
      period: { from: fromDate, to: toDate, timezone: orgZone, from_at: iso(from), to_at: iso(to) },
      directory_stale: !lastFetched || this.clock.now().getTime() - lastFetched.getTime() > DIRECTORY_MAX_AGE_SECONDS * 1000,
      roles,
      employees,
      shifts: visible.map((s: ShiftRecord) => shiftToApi(s, conflicts.get(s.id) ?? [])),
    };
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}
```

`src/server/routes/schedule.ts`:

```ts
import type { App } from '../app';
import { op } from '../http/doc';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { MAX_RANGE_DAYS } from '../scheduling/scheduleService';

export function register(r: Router, app: App): void {
  r.add('GET', '/api/schedule', 'manager', 'Read the schedule for a date range: employees, hours, time off and shifts with conflicts.', async ({ query }) => {
    const input = new Input(query);
    const range = input.dateRange('from', 'to', MAX_RANGE_DAYS);
    input.check();
    return json(200, await app.scheduleService().build(range![0], range![1]));
  }, op('Read Schedule', 'See who is planned when, and where the problems are', ['Showing the planning board', 'Checking a week before publishing'], ["Reading one employee's own published shifts"],
    ['from', 'to'], ['period', 'employees[]', 'shifts[]', 'roles[]'], ['Planning Manager'], ['POST /api/shifts', 'POST /api/publications'],
    ['schedule', 'roster', 'rota', 'planning board', 'gantt', 'calendar']));
}
```

Add `scheduleService()` to `App`, cached, with the nine dependencies in constructor order. Add `schedule` to `MODULES`. Then update the "Plan Shifts" capability:
- add `'GET /api/schedule'` to its `endpoints`;
- add `'See the schedule for a week or month'` to its `does`.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server
git commit -m "feat: serve the schedule with hours, time off and conflicts"
```

---

### Task 18: Publishing and My Planning data

**Files:**
- Create: `src/server/scheduling/publishService.ts`, `src/server/routes/publications.ts`, `src/server/routes/myShifts.ts`
- Modify: `src/server/app.ts`, `src/server/routes/index.ts`, `src/server/http/catalog.ts`
- Test: `src/server/routes/publishing.int.test.ts`

**Interfaces:**
- Consumes: `ShiftRepository.publish`, `ShiftRepository.publishedForEmployee`, `Outbox`, `ProfileRepository`, `SettingsRepository`, `RoleRepository`.
- Produces:
  - `class PublishService(shifts, outbox, clock)` with `.publish(body): Promise<{ published; employees_notified }>`.
  - `POST /api/publications {shift_ids}` (manager) returns 201. It writes one `schedule_published` outbox row per employee, with `payload.shift_ids` in start order.
  - `GET /api/my/shifts?from=&to=` (person) returns `{ timezone, from, to, roles, shifts: [shiftToMyApi] }`. It returns 403 `NOT_ON_ROSTER` when the signed-in person has no `employee_ref`.

- [ ] **Step 1: Write the failing test**

`src/server/routes/publishing.int.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Outbox } from '../repo/outbox';
import { ORG } from '../test/db';
import { useApiHarness } from '../test/harness';

const h = useApiHarness();
beforeEach(async () => {
  await h.addEmployee('E1', 'Ana Lim');
  await h.addEmployee('E2', 'Bo Tan');
});

async function shift(ref: string | null, day: string): Promise<string> {
  const { status, body } = await h.call('POST', '/api/shifts', { employee_ref: ref, start_at: `${day}T09:00:00+08:00`, end_at: `${day}T17:00:00+08:00` });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.shift.id;
}

describe('publishing (FR-PUB-01, FR-PUB-02) and My Planning (FR-MYP-01)', () => {
  it('publishes and queues one notice per employee', async () => {
    const ids = [await shift('E1', '2026-10-14'), await shift('E1', '2026-10-15'), await shift('E2', '2026-10-14'), await shift(null, '2026-10-16')];
    const { status, body } = await h.call('POST', '/api/publications', { shift_ids: ids });
    expect([status, body]).toEqual([201, { published: 4, employees_notified: 2 }]);

    const rows = await new Outbox(h.database.db, ORG).all();
    expect(rows.map((r) => r.employee_ref).sort()).toEqual(['E1', 'E2']);
    expect(rows.find((r) => r.employee_ref === 'E1')!.payload).toEqual({ shift_ids: [ids[0], ids[1]] });
    expect((await h.call('GET', `/api/shifts/${ids[0]}`)).body.shift.state).toBe('published');
    expect((await h.call('POST', '/api/publications', { shift_ids: ids })).body).toEqual({ published: 0, employees_notified: 0 });
  });

  it('needs a non-empty list', async () => {
    expect((await h.call('POST', '/api/publications', { shift_ids: [] })).status).toBe(422);
    expect((await h.call('POST', '/api/publications', {})).status).toBe(422);
  });

  it('shows employees only their own published, live shifts', async () => {
    const mine = await shift('E1', '2026-10-14');
    const draft = await shift('E1', '2026-10-15');
    const theirs = await shift('E2', '2026-10-14');
    const deleted = await shift('E1', '2026-10-16');
    await h.call('POST', '/api/publications', { shift_ids: [mine, theirs, deleted] });
    await h.call('DELETE', `/api/shifts/${deleted}`);

    h.asEmployee('E1');
    const { status, body } = await h.call('GET', '/api/my/shifts', undefined, { from: '2026-10-12', to: '2026-10-18' });
    expect(status).toBe(200);
    expect(body.shifts.map((s: { id: string }) => s.id)).toEqual([mine]);
    expect(body.shifts.map((s: { id: string }) => s.id)).not.toContain(draft);
    expect(body.timezone).toBe('Asia/Kuala_Lumpur');
    expect(Object.keys(body.shifts[0])).toEqual(['id', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_hours', 'note']);
  });

  it('turns away people who are not on the roster, and stops employees publishing', async () => {
    h.asEmployee(null, 'visitor@example.com');
    expect((await h.call('GET', '/api/my/shifts', undefined, { from: '2026-10-12', to: '2026-10-18' })).body.error.code).toBe('NOT_ON_ROSTER');
    h.asEmployee('E1');
    expect((await h.call('POST', '/api/publications', { shift_ids: ['x'] })).status).toBe(403);
  });
});
```

Run: `npm run test:integration`
Expected: FAIL.

- [ ] **Step 2: Implement publishing and My Planning**

`src/server/scheduling/publishService.ts`:

```ts
import { Input } from '../http/input';
import type { Outbox } from '../repo/outbox';
import type { ShiftRepository } from '../repo/shifts';
import type { Clock } from '../support/clock';

/** FR-PUB-01, FR-NTF-01 (delivery arrives in M2). */
export class PublishService {
  constructor(private readonly shifts: ShiftRepository, private readonly outbox: Outbox, private readonly clock: Clock) {}

  async publish(body: Record<string, unknown>): Promise<{ published: number; employees_notified: number }> {
    const input = new Input(body);
    const ids = input.stringList('shift_ids', 1000, true);
    if (ids && ids.length === 0) input.error('shift_ids', 'List at least one shift.');
    input.check();

    const now = this.clock.now();
    const published = await this.shifts.publish(ids!, now);
    const byEmployee = new Map<string, string[]>();
    for (const shift of published) {
      if (!shift.employeeRef) continue;
      if (!byEmployee.has(shift.employeeRef)) byEmployee.set(shift.employeeRef, []);
      byEmployee.get(shift.employeeRef)!.push(shift.id);
    }
    for (const [ref, shiftIds] of byEmployee) await this.outbox.add('schedule_published', ref, null, { shift_ids: shiftIds }, now, now);
    return { published: published.length, employees_notified: byEmployee.size };
  }
}
```

`src/server/routes/publications.ts`:

```ts
import type { App } from '../app';
import { op } from '../http/doc';
import { json } from '../http/responses';
import type { Router } from '../http/router';

export function register(r: Router, app: App): void {
  r.add('POST', '/api/publications', 'manager', 'Publish draft shifts and notify the employees concerned.', async ({ body }) =>
    json(201, await app.publishService().publish(await body())),
  op('Publish Shifts', 'Make draft shifts visible to employees and tell them', ["A week's plan is ready to share"], ['Changing a shift that is already published'],
    ['shift_ids'], ['published', 'employees_notified'], ['Planning Manager'], ['GET /api/schedule', 'GET /api/my/shifts'],
    ['publish', 'send schedule', 'release', 'notify']));
}
```

`src/server/routes/myShifts.ts`:

```ts
import type { App } from '../app';
import { op } from '../http/doc';
import { HttpError } from '../http/errors';
import { Input } from '../http/input';
import { json } from '../http/responses';
import type { Router } from '../http/router';
import { shiftToMyApi } from '../repo/shifts';
import { MAX_RANGE_DAYS } from '../scheduling/scheduleService';
import { localMidnight, nextDay } from '../support/time';

export function register(r: Router, app: App): void {
  // FR-MYP-01, FR-PUB-02: published shifts only, and only the signed-in employee's.
  r.add('GET', '/api/my/shifts', 'person', "List the signed-in employee's published shifts.", async ({ query, principal }) => {
    if (!principal?.employeeRef) throw HttpError.forbidden('You are not on the planning roster.', 'NOT_ON_ROSTER');
    const input = new Input(query);
    const range = input.dateRange('from', 'to', MAX_RANGE_DAYS);
    input.check();
    const zone = (await app.profiles().find(principal.employeeRef)).timezone ?? (await app.settings().timezone());
    const [shifts, roles] = await Promise.all([
      app.shifts().publishedForEmployee(principal.employeeRef, new Date(localMidnight(range![0], zone)), new Date(localMidnight(nextDay(range![1]), zone))),
      app.roles().all(),
    ]);
    return json(200, { timezone: zone, from: range![0], to: range![1], roles, shifts: shifts.map(shiftToMyApi) });
  }, op('My Shifts', 'See my own published schedule', ['An employee checks when they work'], ['A manager reviewing the whole team'],
    ['from', 'to'], ['timezone', 'shifts[]', 'roles[]'], ['Signed-in person on the roster'], ['GET /api/me'],
    ['my schedule', 'my shifts', 'when do I work', 'my roster']));
}
```

- [ ] **Step 3: Wire it**

Add `publishService()` (`new PublishService(this.shifts(), this.outbox(), this.clock())`) to `App`. Add `publications` and `myShifts` to `MODULES`, and append to `capabilities`:

```ts
    {
      name: 'Share Schedules',
      icon: '📣',
      description: 'Publish planned shifts and let employees see their own.',
      does: ['Publish a week of shifts', 'See my own shifts'],
      best_for: 'Getting the plan from the manager to the team.',
      endpoints: ['POST /api/publications', 'GET /api/my/shifts'],
    },
```

- [ ] **Step 4: Run the whole backend suite**

Run: `npm run test:unit && npm run test:integration && npm run typecheck`
Expected: PASS, with 0 failures and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server
git commit -m "feat: publish shifts and serve employees their own published schedule"
```

---

### Task 19: React app shell, API client and screen access

**Files:**
- Create: `src/client/types.ts`, `src/client/api.ts`, `src/client/router.ts`, `src/client/feedback.tsx`, `src/client/AppShell.tsx`
- Replace: `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/app/schedule/page.tsx`, `src/app/my/page.tsx`, `src/app/settings/[[...tab]]/page.tsx`, `src/app/not-on-roster/page.tsx`
- Create (placeholders replaced in Tasks 20, 22, 23): `src/client/schedule/SchedulePage.tsx`, `src/client/my/MyPlanningPage.tsx`, `src/client/settings/SettingsPage.tsx`
- Test: `src/client/api.test.ts`, `src/client/router.test.ts`

**Interfaces:**
- Consumes: `GET /api/me` (Tasks 6, 12).
- Produces:
  - `api<T>(method, path, body?, fetchImpl?): Promise<T>`. Non-2xx responses throw `ApiError { status, code, message, details, correlationId }`. A 401 calls the unauthorized handler, which by default reloads the page so `proxy.ts` sends the browser to sign-in (Review Focus 5).
  - `setUnauthorizedHandler(fn)` and `query(params): string`.
  - `type Screen = 'home' | 'schedule' | 'my' | 'settings' | 'not-on-roster'`.
  - `landingPath(me)` and `access(screen, me)`, which returns `'ok'`, `'forbidden'`, `'not-on-roster'` or `{ redirect }`.
  - `<FeedbackProvider>` and `useFeedback()`, which gives `{ toast(message, action?, ms?), confirm(title, lines, label): Promise<boolean> }`, plus `<Modal title onClose>`.
  - `<AppShell screen>{(me) => ...}</AppShell>`.
  - Page components: `SchedulePage({ me })`, `MyPlanningPage({ me })`, `SettingsPage({ me, tab })`.
  - All JSON shapes live in `types.ts`.

FR-ACC-02: employees land on My Planning, and managers land on Schedule. The app has no sign-out button, because sign-out happens only at the gateway (auth guide §5).

- [ ] **Step 1: Write the failing tests**

`src/client/api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, query, setUnauthorizedHandler } from './api';

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
const envelope = (code: string) => ({ error: { code, message: 'Nope.', correlation_id: 'cid-1', details: { conflicts: [] } } });

describe('api', () => {
  it('returns parsed JSON, and undefined for 204', async () => {
    expect(await api('GET', '/api/me', undefined, respond(200, { a: 1 }))).toEqual({ a: 1 });
    expect(await api('DELETE', '/api/shifts/1', undefined, respond(204, null))).toBeUndefined();
  });

  it('sends JSON bodies', async () => {
    const fetchImpl = respond(201, {});
    await api('POST', '/api/roles', { name: 'Tech' }, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"name":"Tech"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('turns the error envelope into an ApiError', async () => {
    await expect(api('POST', '/api/shifts', {}, respond(409, envelope('SHIFT_CONFLICT')))).rejects.toMatchObject({
      status: 409, code: 'SHIFT_CONFLICT', correlationId: 'cid-1', details: { conflicts: [] },
    });
  });

  it('hands 401 to the unauthorized handler so the page can re-run sign-in (Review Focus 5)', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api('GET', '/api/me', undefined, respond(401, envelope('UNAUTHORIZED')))).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('copes with a non-JSON error page', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(api('GET', '/api/x', undefined, fetchImpl)).rejects.toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('builds query strings without empty values', () => {
    expect(query({ from: '2026-10-12', to: '2026-10-18', employee_ref: undefined, x: '' })).toBe('?from=2026-10-12&to=2026-10-18');
    expect(query({})).toBe('');
  });
});
```

`src/client/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { access, landingPath } from './router';
import type { Me } from './types';

const me = (over: Partial<Me>): Me => ({
  name: 'Ana', email: 'ana@example.com', gateway_role: 'user', employee_ref: null, is_manager: false,
  timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur', ...over,
});

describe('screen access (FR-ACC-02)', () => {
  it('lands managers on the schedule, employees on My Planning, others on a message', () => {
    expect(landingPath(me({ is_manager: true, employee_ref: 'E1' }))).toBe('/schedule');
    expect(landingPath(me({ employee_ref: 'E1' }))).toBe('/my');
    expect(landingPath(me({}))).toBe('/not-on-roster');
    expect(access('home', me({ employee_ref: 'E1' }))).toEqual({ redirect: '/my' });
  });

  it('keeps employees out of manager screens', () => {
    expect(access('schedule', me({ employee_ref: 'E1' }))).toBe('forbidden');
    expect(access('settings', me({ employee_ref: 'E1' }))).toBe('forbidden');
    expect(access('schedule', me({ is_manager: true }))).toBe('ok');
  });

  it('needs a roster reference for My Planning', () => {
    expect(access('my', me({ is_manager: true }))).toBe('not-on-roster');
    expect(access('my', me({ employee_ref: 'E1' }))).toBe('ok');
  });
});
```

Run: `npx vitest run --project client`
Expected: FAIL (missing modules).

- [ ] **Step 2: Implement types, the API client and access rules**

`src/client/types.ts`:

```ts
export interface Me {
  name: string | null;
  email: string | null;
  gateway_role: string | null;
  employee_ref: string | null;
  is_manager: boolean;
  timezone: string;
  organisation_timezone: string;
}

export interface Role { id: string; name: string; color: string; archived: boolean }
export interface Conflict { rule: 'overlap' | 'unavailable' | 'role'; message: string }

export interface Shift {
  id: string;
  employee_ref: string | null;
  role_id: string | null;
  start_at: string;
  end_at: string;
  break_minutes: number;
  allocated_percent: number;
  allocated_hours: number;
  note: string | null;
  state: 'draft' | 'published';
  published_at: string | null;
  version: number;
  conflicts: Conflict[];
  conflict_acknowledged: boolean;
}

export interface TimeSpan { start_at: string; end_at: string }
export interface Unavailable extends TimeSpan { kind: 'time_off' | 'holiday'; label: string }

export interface ScheduleEmployee {
  employee_ref: string;
  name: string;
  photo_url: string | null;
  department_id: string | null;
  department_name: string | null;
  status: string;
  on_roster: boolean;
  role_ids: string[];
  default_role_id: string | null;
  timezone: string;
  flexible: boolean;
  allocated_hours: number;
  available_hours: number | null;
  over_allocated_days: string[];
  working_intervals: TimeSpan[];
  unavailable: Unavailable[];
}

export interface SchedulePayload {
  period: { from: string; to: string; timezone: string; from_at: string; to_at: string };
  directory_stale: boolean;
  roles: Role[];
  employees: ScheduleEmployee[];
  shifts: Shift[];
}

export interface MyShift { id: string; role_id: string | null; start_at: string; end_at: string; break_minutes: number; allocated_hours: number; note: string | null }
export interface MyShiftsPayload { timezone: string; from: string; to: string; roles: Role[]; shifts: MyShift[] }

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WorkingHoursMap = Record<Weekday, [string, string][]>;

export interface EmployeeProfile {
  employee_ref: string;
  name: string;
  photo_url: string | null;
  department_id: string | null;
  department_name: string | null;
  status: string;
  role_ids: string[];
  default_role_id: string | null;
  timezone: string | null;
  effective_timezone: string;
  working_hours: WorkingHoursMap | null;
}

export interface Settings { country_code: string | null; region_code: string | null; timezone: string }
export interface TimeOff { id: string; employee_ref: string; start_at: string; end_at: string; reason: string }
export interface Holiday { id: string; date: string; name: string; source: 'manual' | 'provider'; hidden: boolean; edited: boolean }
export interface ManagerGrant { email: string; granted_by: string; granted_at: string }
```

`src/client/api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
    readonly correlationId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope = { error?: { code?: string; message?: string; details?: unknown; correlation_id?: string } } | null;

// A 401 means our session or the gateway session ended. Reloading lets proxy.ts
// run the sign-in flow again instead of leaving a broken screen.
let onUnauthorized: () => void = () => window.location.reload();

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function api<T>(method: string, path: string, body?: unknown, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    const error = (data as Envelope)?.error;
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? `Request failed (${response.status}).`, error?.details ?? null,
      error?.correlation_id ?? response.headers.get('X-Correlation-ID'));
  }
  return data as T;
}

export function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `?${s}` : '';
}
```

`src/client/router.ts`:

```ts
import type { Me } from './types';

export type Screen = 'home' | 'schedule' | 'my' | 'settings' | 'not-on-roster';

export function landingPath(me: Me): string {
  if (me.is_manager) return '/schedule';
  if (me.employee_ref) return '/my';
  return '/not-on-roster';
}

/** What a page should do for this person. The API enforces the same rules; this only avoids showing dead screens. */
export function access(screen: Screen, me: Me): 'ok' | 'forbidden' | 'not-on-roster' | { redirect: string } {
  if (screen === 'home') return { redirect: landingPath(me) };
  if (screen === 'schedule' || screen === 'settings') return me.is_manager ? 'ok' : 'forbidden';
  if (screen === 'my') return me.employee_ref ? 'ok' : 'not-on-roster';
  return 'ok';
}
```

Run: `npx vitest run --project client`
Expected: PASS.

- [ ] **Step 3: Implement feedback, the shell and the pages**

`src/client/feedback.tsx`:

```tsx
'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface ToastAction { label: string; run: () => void | Promise<void> }
interface Toast { id: number; message: string; action?: ToastAction }
interface Question { title: string; lines: string[]; confirmLabel: string; resolve: (ok: boolean) => void }
interface Feedback {
  toast(message: string, action?: ToastAction, ms?: number): void;
  confirm(title: string, lines: string[], confirmLabel: string): Promise<boolean>;
}

const FeedbackContext = createContext<Feedback | null>(null);
let nextId = 0;

/** An accessible modal: role=dialog, focus moves inside, Escape or a backdrop click closes it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);

  const toast = useCallback((message: string, action?: ToastAction, ms = 10_000) => {
    const id = ++nextId;
    setToasts((all) => [...all, { id, message, action }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), ms);
  }, []);
  const confirm = useCallback((title: string, lines: string[], confirmLabel: string) =>
    new Promise<boolean>((resolve) => setQuestion({ title, lines, confirmLabel, resolve })), []);
  const answer = (ok: boolean) => {
    question?.resolve(ok);
    setQuestion(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {question && (
        <Modal title={question.title} onClose={() => answer(false)}>
          {question.lines.length > 0 && <ul>{question.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
          <div className="actions">
            <button type="button" onClick={() => answer(false)}>Cancel</button>
            <button type="button" className="primary" autoFocus onClick={() => answer(true)}>{question.confirmLabel}</button>
          </div>
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <span>{t.message}</span>
            {t.action && (
              <button type="button" onClick={() => {
                setToasts((all) => all.filter((x) => x.id !== t.id));
                void t.action!.run();
              }}>{t.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('useFeedback must be used inside <FeedbackProvider>.');
  return feedback;
}
```

`src/client/AppShell.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { FeedbackProvider } from './feedback';
import { access, type Screen } from './router';
import type { Me } from './types';

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return <Link href={href} aria-current={active ? 'page' : undefined}>{children}</Link>;
}

export function AppShell({ screen, children }: { screen: Screen; children?: (me: Me) => ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => window.location.reload());
    api<Me>('GET', '/api/me').then(setMe, (error: Error) => setFailure(error.message));
  }, []);

  const verdict = me ? access(screen, me) : null;
  const redirect = verdict && typeof verdict === 'object' ? verdict.redirect : null;
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  let content: ReactNode;
  if (failure) content = <p className="empty">Planning could not start: {failure}</p>;
  else if (!me || redirect) content = <p className="empty">Loading…</p>;
  else if (verdict === 'forbidden') content = <p className="empty">Only Planning Managers can open this page.</p>;
  else if (verdict === 'not-on-roster' || screen === 'not-on-roster') {
    content = <p className="empty">You are signed in as {me.email}, but you are not on the planning roster. Ask a Planning Manager if you expected to see shifts here.</p>;
  } else content = children?.(me);

  return (
    <FeedbackProvider>
      <header className="top">
        <strong>Planning</strong>
        <nav>
          {me?.is_manager && <NavLink href="/schedule" active={screen === 'schedule'}>Schedule</NavLink>}
          {me?.employee_ref && <NavLink href="/my" active={screen === 'my'}>My Planning</NavLink>}
          {me?.is_manager && <NavLink href="/settings" active={screen === 'settings'}>Settings</NavLink>}
        </nav>
        <span className="spacer" />
        {/* No sign-out button: the InterlinkERP gateway is the only place to sign out. */}
        <span className="who">{me?.name ?? me?.email ?? ''}</span>
      </header>
      <main>{content}</main>
    </FeedbackProvider>
  );
}
```

`src/app/page.tsx`:

```tsx
'use client';

import { AppShell } from '@/client/AppShell';

export default function Home() {
  return <AppShell screen="home" />;
}
```

`src/app/schedule/page.tsx`:

```tsx
'use client';

import { AppShell } from '@/client/AppShell';
import { SchedulePage } from '@/client/schedule/SchedulePage';

export default function Page() {
  return <AppShell screen="schedule">{(me) => <SchedulePage me={me} />}</AppShell>;
}
```

`src/app/my/page.tsx`:

```tsx
'use client';

import { AppShell } from '@/client/AppShell';
import { MyPlanningPage } from '@/client/my/MyPlanningPage';

export default function Page() {
  return <AppShell screen="my">{(me) => <MyPlanningPage me={me} />}</AppShell>;
}
```

`src/app/settings/[[...tab]]/page.tsx`:

```tsx
'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/client/AppShell';
import { SettingsPage } from '@/client/settings/SettingsPage';

export default function Page() {
  const params = useParams<{ tab?: string[] }>();
  return <AppShell screen="settings">{(me) => <SettingsPage me={me} tab={params.tab?.[0] ?? 'general'} />}</AppShell>;
}
```

`src/app/not-on-roster/page.tsx`:

```tsx
'use client';

import { AppShell } from '@/client/AppShell';

export default function Page() {
  return <AppShell screen="not-on-roster" />;
}
```

Placeholders, which the later tasks replace:

`src/client/schedule/SchedulePage.tsx`:

```tsx
'use client';

import type { Me } from '../types';

export function SchedulePage(_props: { me: Me }) {
  return <p className="empty">The schedule arrives in Task 20.</p>;
}
```

`src/client/my/MyPlanningPage.tsx`:

```tsx
'use client';

import type { Me } from '../types';

export function MyPlanningPage(_props: { me: Me }) {
  return <p className="empty">My Planning arrives in Task 22.</p>;
}
```

`src/client/settings/SettingsPage.tsx`:

```tsx
'use client';

import type { Me } from '../types';

export function SettingsPage(_props: { me: Me; tab: string }) {
  return <p className="empty">Settings arrive in Task 23.</p>;
}
```

`src/app/globals.css` (replaces the Task 1 stub):

```css
:root {
  color-scheme: light dark;
  --bg: #f7f7f5;
  --surface: #ffffff;
  --text: #1d1d1b;
  --muted: #6b6b66;
  --line: #e3e2dc;
  --accent: #2457d6;
  --danger: #c62f2f;
  --warn: #9a5b00;
  --off: #efeeea;
  --away: repeating-linear-gradient(45deg, #e6e4dc 0 6px, #f4f3ef 6px 12px);
  --radius: 6px;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514;
    --surface: #1e1e1c;
    --text: #ecebe6;
    --muted: #a3a29b;
    --line: #34332f;
    --accent: #7ea2ff;
    --danger: #ff6b6b;
    --warn: #f0b35a;
    --off: #252522;
    --away: repeating-linear-gradient(45deg, #2d2c29 0 6px, #232320 6px 12px);
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
header.top { display: flex; gap: 16px; align-items: center; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
header.top nav { display: flex; gap: 4px; }
header.top nav a { color: var(--muted); text-decoration: none; padding: 6px 10px; border-radius: var(--radius); }
header.top nav a[aria-current="page"] { color: var(--text); background: var(--off); }
.spacer { flex: 1; }
.who, .muted { color: var(--muted); }
main { padding: 16px; }
button, select, input, textarea { font: inherit; color: inherit; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius); padding: 6px 10px; }
button { cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--danger); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.empty { color: var(--muted); padding: 24px 0; }
.toasts { position: fixed; right: 16px; bottom: 16px; display: grid; gap: 8px; z-index: 30; }
.toast { display: flex; gap: 12px; align-items: center; background: var(--text); color: var(--bg); padding: 10px 14px; border-radius: var(--radius); }
.toast button { background: transparent; color: inherit; border-color: currentColor; }
.backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); display: grid; place-items: center; z-index: 20; padding: 16px; }
.modal { background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 16px; width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; }
.modal h2 { font-size: 16px; margin: 0 0 12px; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
.form-grid .wide { grid-column: 1 / -1; }
label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
.field-error, .form-error { color: var(--danger); font-size: 12px; }
table { width: 100%; border-collapse: collapse; background: var(--surface); }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
@media (max-width: 600px) {
  header.top { flex-wrap: wrap; }
  main { padding: 12px; }
  .form-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run tests, the type check, and check it in the browser**

```bash
npx vitest run --project client && npm run typecheck && npm run dev
```

Open `http://127.0.0.1:3000/`:
- With `DEV_USER_ROLE=admin` in `.env.local`, the header shows Schedule and Settings, and `/` redirects to `/schedule`.
- With `DEV_USER_ROLE=user` and no `DEV_EMPLOYEE_REF`, the page shows the "not on the planning roster" message.

Restart `npm run dev` after editing `.env.local`.

- [ ] **Step 5: Commit**

```bash
git add src/app src/client
git commit -m "feat: add React app shell with role-based landing and API client"
```

---

### Task 20: Schedule board with gestures

**Files:**
- Create: `src/client/schedule/period.ts`, `tz.ts`, `layout.ts`, `rows.ts`, `drag.ts`, `Board.tsx`, `testData.ts`
- Replace: `src/client/schedule/SchedulePage.tsx` (the read-only version; Task 21 replaces it again with editing)
- Modify: `src/app/globals.css`
- Test: `period.test.ts`, `tz.test.ts`, `layout.test.ts`, `rows.test.ts`, `drag.test.ts`, `Board.test.tsx` (all in `src/client/schedule/`)

**Interfaces:**
- Consumes: `GET /api/schedule` (Task 17), `api`, `query`, and the types.
- Produces:
  - `period.ts`: `type Scale`, `interface Period {scale, from, to, days}`, `periodFor()`, `step()`, `addDays()`, `dayLabel()`, `periodLabel()`.
  - `tz.ts` (Luxon): `toIso(ms)`, `wallToIso(date, time, zone)`, `isoToWall(iso, zone)`, `formatTime(iso, zone)`, `todayIn(zone, now?)`.
  - `layout.ts`: `geometry(startIso, endIso, fromIso, toIso)` and `assignLanes(items)`.
  - `rows.ts`: `type GroupBy`, `interface Filters`, `NO_FILTERS`, `interface Row`, `buildRows(data, groupBy, filters)`.
  - `drag.ts`: `type DragMode`, `snapMinutes()`, `deltaFromPixels()`, `applyDrag()`, `newShiftTimes()`, `publishSummary()`.
  - `<Board data rows period onOpen? onCreate? onChange? />`.
    - `onOpen(shift)` fires on a click, or on Enter or Space on a focused shift.
    - `onCreate(rowRef: string | null, atIso)` fires on a click in an empty part of a row.
    - `onChange(shift, change)` fires when a drag or resize ends. `change` is `{ start_at?, end_at?, employee_ref? }`.
  - `SchedulePage({ me })`.

Requirements covered:
- FR-SCH-01: group by employee or by role.
- FR-SCH-02: an open-shifts row first.
- FR-SCH-03: day, week and month scales, with previous, today and next.
- FR-SCH-06: filters for role, department, name and state.
- FR-SCH-07: drafts are striped and published shifts are solid, as in Odoo. Time off and holidays are hatched, and time outside working hours is grey.
- FR-SCH-08: allocated against available hours, with an over-allocation badge.
- FR-SCH-09: a red outline plus the reasons in the tooltip and accessible label.
- FR-SHF-04: one continuous bar across midnight.
- Gestures for FR-SHF-02 and FR-SHF-03, which Task 21 connects to the API.

Bars are placed by the fraction of the period's total time. On a daylight-saving day this can drift from the column grid by up to an hour's width, which is acceptable for M1 because Malaysia has no daylight saving.

- [ ] **Step 1: Write the failing tests**

`src/client/schedule/testData.ts`:

```ts
import type { ScheduleEmployee, SchedulePayload, Shift } from '../types';

export const employee = (over: Partial<ScheduleEmployee> = {}): ScheduleEmployee => ({
  employee_ref: 'E1', name: 'Ana Lim', photo_url: null, department_id: null, department_name: null, status: 'Active', on_roster: true,
  role_ids: [], default_role_id: null, timezone: 'Asia/Kuala_Lumpur', flexible: true, allocated_hours: 0, available_hours: null,
  over_allocated_days: [], working_intervals: [], unavailable: [], ...over,
});

export const shift = (over: Partial<Shift> = {}): Shift => ({
  id: 's1', employee_ref: 'E1', role_id: null, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z', break_minutes: 0,
  allocated_percent: 100, allocated_hours: 8, note: null, state: 'draft', published_at: null, version: 1, conflicts: [], conflict_acknowledged: false, ...over,
});

export const payload = (over: Partial<SchedulePayload> = {}): SchedulePayload => ({
  period: { from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Kuala_Lumpur', from_at: '2026-10-11T16:00:00Z', to_at: '2026-10-18T16:00:00Z' },
  directory_stale: false, roles: [], employees: [], shifts: [], ...over,
});
```

`src/client/schedule/period.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayLabel, periodFor, periodLabel, step } from './period';

describe('periods', () => {
  it('starts weeks on Monday', () => {
    expect(periodFor('week', '2026-10-14')).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect(periodFor('week', '2026-10-18').from).toBe('2026-10-12');
    expect(periodFor('week', '2026-10-14').days).toHaveLength(7);
  });

  it('covers whole months and single days', () => {
    expect(periodFor('month', '2026-02-10')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodFor('day', '2026-10-14').days).toEqual(['2026-10-14']);
  });

  it('steps by scale', () => {
    expect([step('day', '2026-10-14', 1), step('week', '2026-10-14', -1), step('month', '2026-01-31', 1)]).toEqual(['2026-10-15', '2026-10-07', '2026-02-01']);
  });

  it('labels days and periods', () => {
    expect([dayLabel('2026-10-14', 'week'), dayLabel('2026-10-14', 'month')]).toEqual(['Wed 14', '14']);
    expect(periodLabel(periodFor('week', '2026-10-14'))).toBe('12 Oct 2026 – 18 Oct 2026');
    expect(periodLabel(periodFor('month', '2026-10-14'))).toBe('Oct 2026');
  });
});
```

`src/client/schedule/tz.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatTime, isoToWall, todayIn, wallToIso } from './tz';

describe('time zones', () => {
  it('converts wall time to UTC and back', () => {
    expect(wallToIso('2026-10-14', '09:00', 'Asia/Kuala_Lumpur')).toBe('2026-10-14T01:00:00Z');
    expect(isoToWall('2026-10-14T01:00:00Z', 'Asia/Kuala_Lumpur')).toEqual({ date: '2026-10-14', time: '09:00' });
    expect(formatTime('2026-10-14T16:30:00Z', 'Asia/Kuala_Lumpur')).toBe('00:30');
    expect(todayIn('Asia/Kuala_Lumpur', new Date('2026-10-13T17:00:00Z'))).toBe('2026-10-14');
  });

  it('handles both sides of a daylight-saving change', () => {
    expect(wallToIso('2026-11-01', '12:00', 'America/New_York')).toBe('2026-11-01T17:00:00Z');
    expect(wallToIso('2026-10-31', '12:00', 'America/New_York')).toBe('2026-10-31T16:00:00Z');
  });
});
```

`src/client/schedule/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assignLanes, geometry } from './layout';

const FROM = '2026-10-12T00:00:00Z';
const TO = '2026-10-19T00:00:00Z';

describe('layout', () => {
  it('places a bar by time', () => {
    const g = geometry('2026-10-13T00:00:00Z', '2026-10-13T12:00:00Z', FROM, TO)!;
    expect(g.left).toBeCloseTo(100 / 7);
    expect(g.width).toBeCloseTo(100 / 14);
  });

  it('draws an overnight shift as one bar (FR-SHF-04) and clips at the edges', () => {
    expect(geometry('2026-10-13T22:00:00Z', '2026-10-14T06:00:00Z', FROM, TO)!.width).toBeCloseTo((8 / 168) * 100);
    expect(geometry('2026-10-11T20:00:00Z', '2026-10-12T04:00:00Z', FROM, TO)).toMatchObject({ left: 0, clippedStart: true });
    expect(geometry('2026-10-20T00:00:00Z', '2026-10-20T04:00:00Z', FROM, TO)).toBeNull();
  });

  it('stacks overlapping shifts into lanes', () => {
    const { lanes, count } = assignLanes([
      { id: 'a', start_at: '2026-10-13T01:00:00Z', end_at: '2026-10-13T05:00:00Z' },
      { id: 'b', start_at: '2026-10-13T03:00:00Z', end_at: '2026-10-13T07:00:00Z' },
      { id: 'c', start_at: '2026-10-13T05:00:00Z', end_at: '2026-10-13T08:00:00Z' },
    ]);
    expect([lanes.get('a'), lanes.get('b'), lanes.get('c'), count]).toEqual([0, 1, 0, 2]);
  });
});
```

`src/client/schedule/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildRows, NO_FILTERS } from './rows';
import { employee, payload, shift } from './testData';

const data = payload({
  roles: [{ id: 'tech', name: 'Technician', color: '#22C55E', archived: false }],
  employees: [employee(), employee({ employee_ref: 'E2', name: 'Bo Tan', department_id: 'D2' })],
  shifts: [shift({ id: 'open', employee_ref: null }), shift({ id: 'a', role_id: 'tech', state: 'published' }), shift({ id: 'b', employee_ref: 'E2' })],
});

describe('buildRows', () => {
  it('puts open shifts first and gives every employee a row', () => {
    const rows = buildRows(data, 'employee', NO_FILTERS);
    expect(rows.map((r) => r.key)).toEqual(['open', 'E1', 'E2']);
    expect(rows[0].shifts.map((s) => s.id)).toEqual(['open']);
  });

  it('keeps every employee row under a state filter (FR-SCH-06 AC1)', () => {
    const rows = buildRows(data, 'employee', { ...NO_FILTERS, state: 'draft' });
    expect(rows.map((r) => r.key)).toEqual(['open', 'E1', 'E2']);
    expect(rows.flatMap((r) => r.shifts.map((s) => s.id))).toEqual(['open', 'b']);
  });

  it('narrows rows by name and department', () => {
    expect(buildRows(data, 'employee', { ...NO_FILTERS, name: 'bo' }).map((r) => r.key)).toEqual(['open', 'E2']);
    expect(buildRows(data, 'employee', { ...NO_FILTERS, departmentId: 'D2' }).map((r) => r.key)).toEqual(['open', 'E2']);
  });

  it('groups by role with "No role" last (FR-SCH-01 AC2)', () => {
    expect(buildRows(data, 'role', NO_FILTERS).map((r) => [r.kind, r.label])).toEqual([
      ['open', 'Open shifts'], ['header', 'Technician'], ['employee', 'Ana Lim'], ['header', 'No role'], ['employee', 'Bo Tan'],
    ]);
  });
});
```

`src/client/schedule/drag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyDrag, deltaFromPixels, newShiftTimes, publishSummary, snapMinutes } from './drag';
import { shift } from './testData';

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

describe('drag maths', () => {
  it('snaps by scale and never loses a deliberate nudge', () => {
    expect([snapMinutes('day'), snapMinutes('week'), snapMinutes('month')]).toEqual([15, 30, 1440]);
    expect(deltaFromPixels(100, 700, WEEK, 30)).toBe(24 * HOUR);
    expect(deltaFromPixels(3, 700, WEEK, 30)).toBe(30 * 60_000);
    expect(deltaFromPixels(3, 7000, 24 * HOUR, 15)).toBe(15 * 60_000);
  });

  it('moves and resizes, keeping at least 15 minutes', () => {
    const s = shift();
    expect(applyDrag(s, 'move', 2 * HOUR)).toEqual({ start_at: '2026-10-14T03:00:00Z', end_at: '2026-10-14T11:00:00Z' });
    expect(applyDrag(s, 'resize-end', -HOUR)).toEqual({ start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T08:00:00Z' });
    expect(applyDrag(s, 'resize-start', 20 * HOUR)).toEqual({ start_at: '2026-10-14T08:45:00Z', end_at: '2026-10-14T09:00:00Z' });
    expect(applyDrag(s, 'move', 0)).toBeNull();
  });

  it('suggests times for a new shift', () => {
    const tz = 'Asia/Kuala_Lumpur';
    expect(newShiftTimes('week', '2026-10-14T05:30:00Z', tz, '2026-10-12')).toEqual({ start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z' });
    expect(newShiftTimes('day', '2026-10-14T05:30:00Z', tz, '2026-10-14')).toEqual({ start_at: '2026-10-14T05:00:00Z', end_at: '2026-10-14T06:00:00Z' });
    expect(newShiftTimes('week', null, tz, '2026-10-12')).toEqual({ start_at: '2026-10-12T01:00:00Z', end_at: '2026-10-12T09:00:00Z' });
  });

  it('summarises what publishing will do', () => {
    const summary = publishSummary([
      shift({ id: 'a' }), shift({ id: 'b' }), shift({ id: 'c', employee_ref: 'E2' }), shift({ id: 'd', employee_ref: null }), shift({ id: 'e', state: 'published' }),
    ]);
    expect(summary).toEqual({ ids: ['a', 'b', 'c', 'd'], employees: 2, open: 1 });
  });
});
```

The numbers in the nudge test:
- On a 700px week, 3px is about 43 minutes, which rounds to one 30-minute step.
- On a 7000px day, 3px is about 37 seconds. That rounds to zero steps, but the minimum-step rule still moves it one 15-minute step.

`src/client/schedule/Board.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from './Board';
import { periodFor } from './period';
import { buildRows, NO_FILTERS } from './rows';
import { employee, payload, shift } from './testData';
import type { SchedulePayload } from '../types';

function board(data: SchedulePayload, onOpen = vi.fn()) {
  return render(<Board data={data} rows={buildRows(data, 'employee', NO_FILTERS)} period={periodFor('week', '2026-10-14')} onOpen={onOpen} />);
}

describe('Board', () => {
  it('marks drafts, published shifts and conflicts (FR-SCH-07, FR-SCH-09)', () => {
    const { container } = board(payload({
      employees: [employee()],
      shifts: [
        shift({ id: 'd' }),
        shift({ id: 'p', state: 'published', start_at: '2026-10-15T01:00:00Z', end_at: '2026-10-15T09:00:00Z', conflicts: [{ rule: 'overlap', message: 'Overlaps other shifts; allocation reaches 200%.' }] }),
      ],
    }));
    const draft = container.querySelector('[data-shift-id="d"]')!;
    const published = container.querySelector('[data-shift-id="p"]')!;
    expect(draft.classList.contains('draft')).toBe(true);
    expect(published.classList.contains('published')).toBe(true);
    expect(published.classList.contains('conflict')).toBe(true);
    expect(published.getAttribute('title')).toContain('allocation reaches 200%');
    expect(draft.getAttribute('tabindex')).toBe('0');
  });

  it('shows working time, time off and hours against availability (FR-SCH-07, FR-SCH-08)', () => {
    const { container } = board(payload({
      employees: [employee({
        flexible: false, allocated_hours: 15, available_hours: 24, over_allocated_days: ['2026-10-16', '2026-10-17'],
        working_intervals: [{ start_at: '2026-10-12T01:00:00Z', end_at: '2026-10-12T05:00:00Z' }],
        unavailable: [{ start_at: '2026-10-15T16:00:00Z', end_at: '2026-10-16T16:00:00Z', kind: 'time_off', label: 'Annual leave' }],
      })],
    }));
    const row = container.querySelector('[data-row-ref="E1"]')!;
    expect(row.classList.contains('has-hours')).toBe(true);
    expect(row.querySelectorAll('.band.work')).toHaveLength(1);
    expect(row.querySelector('.band.away')!.getAttribute('title')).toBe('Annual leave');
    expect(row.querySelector('.hours')!.textContent).toContain('15.0 / 24.0 h');
    expect(row.querySelector('.over')!.getAttribute('title')).toContain('2026-10-16');
  });

  it('opens a shift from the keyboard (NFR-07)', () => {
    const onOpen = vi.fn();
    const { container } = board(payload({ employees: [employee()], shifts: [shift()] }), onOpen);
    container.querySelector<HTMLElement>('[data-shift-id="s1"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('escapes names', () => {
    const { container } = board(payload({ employees: [employee({ name: '<img src=x onerror=alert(1)>' })] }));
    expect(container.querySelector('img')).toBeNull();
  });
});
```

Run: `npx vitest run --project client`
Expected: FAIL (missing modules).

- [ ] **Step 2: Implement the pure modules**

`src/client/schedule/period.ts`:

```ts
export type Scale = 'day' | 'week' | 'month';
export interface Period { scale: Scale; from: string; to: string; days: string[] }

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar dates are handled as UTC midnights, so no local time zone can shift them. */
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, n: number) => format(parse(date) + n * DAY_MS);

export function periodFor(scale: Scale, anchor: string): Period {
  let from = anchor;
  let to = anchor;
  if (scale === 'week') {
    from = addDays(anchor, -((new Date(parse(anchor)).getUTCDay() + 6) % 7));
    to = addDays(from, 6);
  } else if (scale === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    from = format(Date.UTC(y, m - 1, 1));
    to = format(Date.UTC(y, m, 0));
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { scale, from, to, days };
}

export function step(scale: Scale, anchor: string, direction: -1 | 1): string {
  if (scale === 'day') return addDays(anchor, direction);
  if (scale === 'week') return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split('-').map(Number);
  return format(Date.UTC(y, m - 1 + direction, 1));
}

export function dayLabel(date: string, scale: Scale): string {
  const d = new Date(parse(date));
  return scale === 'month' ? String(d.getUTCDate()) : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

const long = (date: string) => {
  const d = new Date(parse(date));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function periodLabel(p: Period): string {
  if (p.scale === 'day') return `${WEEKDAYS[new Date(parse(p.from)).getUTCDay()]} ${long(p.from)}`;
  if (p.scale === 'week') return `${long(p.from)} – ${long(p.to)}`;
  const d = new Date(parse(p.from));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
```

`src/client/schedule/tz.ts`:

```ts
import { DateTime } from 'luxon';

export const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** "2026-10-14" + "09:00" in zone -> "2026-10-14T01:00:00Z". Luxon resolves daylight-saving edges. */
export function wallToIso(date: string, time: string, zone: string): string {
  return toIso(DateTime.fromISO(`${date}T${time}`, { zone }).toMillis());
}

export function isoToWall(iso: string, zone: string): { date: string; time: string } {
  const local = DateTime.fromISO(iso, { zone });
  return { date: local.toISODate()!, time: local.toFormat('HH:mm') };
}

export const formatTime = (iso: string, zone: string) => isoToWall(iso, zone).time;

export const todayIn = (zone: string, now: Date = new Date()) => DateTime.fromJSDate(now, { zone }).toISODate()!;
```

`src/client/schedule/layout.ts`:

```ts
export interface Geometry { left: number; width: number; clippedStart: boolean; clippedEnd: boolean }

/** Position as percentages of the period, or null when outside it. */
export function geometry(startIso: string, endIso: string, fromIso: string, toIso: string): Geometry | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (end <= from || start >= to) return null;
  const s = Math.max(start, from);
  const e = Math.min(end, to);
  return { left: ((s - from) / (to - from)) * 100, width: ((e - s) / (to - from)) * 100, clippedStart: start < from, clippedEnd: end > to };
}

/** Greedy lanes so overlapping shifts in one row stay visible. */
export function assignLanes<T extends { id: string; start_at: string; end_at: string }>(items: T[]): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || Date.parse(a.end_at) - Date.parse(b.end_at));
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= Date.parse(item.start_at));
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = Date.parse(item.end_at);
    lanes.set(item.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}
```

`src/client/schedule/rows.ts`:

```ts
import type { ScheduleEmployee, SchedulePayload, Shift } from '../types';

export type GroupBy = 'employee' | 'role';
export interface Filters { roleId: string; departmentId: string; name: string; state: '' | 'draft' | 'published' | 'open' }
export const NO_FILTERS: Filters = { roleId: '', departmentId: '', name: '', state: '' };
export interface Row { key: string; label: string; kind: 'open' | 'employee' | 'header'; employee: ScheduleEmployee | null; shifts: Shift[] }

function filterShifts(shifts: Shift[], f: Filters): Shift[] {
  return shifts.filter((s) => (!f.roleId || s.role_id === f.roleId)
    && (f.state !== 'draft' || s.state === 'draft')
    && (f.state !== 'published' || s.state === 'published')
    && (f.state !== 'open' || s.employee_ref === null));
}

function filterEmployees(employees: ScheduleEmployee[], f: Filters): ScheduleEmployee[] {
  const q = f.name.trim().toLowerCase();
  return employees.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!f.departmentId || e.department_id === f.departmentId));
}

export function buildRows(data: SchedulePayload, groupBy: GroupBy, f: Filters): Row[] {
  const shifts = filterShifts(data.shifts, f);
  const employees = filterEmployees(data.employees, f);
  const rows: Row[] = [{ key: 'open', label: 'Open shifts', kind: 'open', employee: null, shifts: shifts.filter((s) => s.employee_ref === null) }];
  if (groupBy === 'employee') {
    for (const e of employees) rows.push({ key: e.employee_ref, label: e.name, kind: 'employee', employee: e, shifts: shifts.filter((s) => s.employee_ref === e.employee_ref) });
    return rows;
  }
  const groups = [...data.roles.map((r) => ({ id: r.id as string | null, name: r.name })), { id: null, name: 'No role' }];
  for (const group of groups) {
    const inGroup = shifts.filter((s) => s.employee_ref !== null && s.role_id === group.id);
    const members = employees.filter((e) => inGroup.some((s) => s.employee_ref === e.employee_ref));
    if (members.length === 0) continue;
    rows.push({ key: `role:${group.id ?? 'none'}`, label: group.name, kind: 'header', employee: null, shifts: [] });
    for (const e of members) {
      rows.push({ key: `role:${group.id ?? 'none'}:${e.employee_ref}`, label: e.name, kind: 'employee', employee: e, shifts: inGroup.filter((s) => s.employee_ref === e.employee_ref) });
    }
  }
  return rows;
}
```

`src/client/schedule/drag.ts`:

```ts
import type { Shift } from '../types';
import type { Scale } from './period';
import { isoToWall, toIso, wallToIso } from './tz';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export const snapMinutes = (scale: Scale) => (scale === 'day' ? 15 : scale === 'week' ? 30 : 24 * 60);

/** Pixels dragged -> milliseconds, rounded to the snap step. A deliberate drag (3px or more) always moves at least one step. */
export function deltaFromPixels(dxPx: number, widthPx: number, periodMs: number, snapMin: number): number {
  const snap = snapMin * 60_000;
  const steps = Math.round(((dxPx / widthPx) * periodMs) / snap);
  if (steps === 0 && Math.abs(dxPx) >= 3) return Math.sign(dxPx) * snap;
  return steps * snap;
}

export function applyDrag(s: Pick<Shift, 'start_at' | 'end_at'>, mode: DragMode, deltaMs: number, minMs = 15 * 60_000): { start_at: string; end_at: string } | null {
  const origStart = Date.parse(s.start_at);
  const origEnd = Date.parse(s.end_at);
  let start = origStart;
  let end = origEnd;
  if (mode === 'move') {
    start += deltaMs;
    end += deltaMs;
  } else if (mode === 'resize-start') {
    start = Math.min(start + deltaMs, end - minMs);
  } else {
    end = Math.max(end + deltaMs, start + minMs);
  }
  return start === origStart && end === origEnd ? null : { start_at: toIso(start), end_at: toIso(end) };
}

/** Day view: the clicked hour, one hour long. Week and month: 09:00–17:00 on the clicked day. */
export function newShiftTimes(scale: Scale, clickedIso: string | null, zone: string, fallbackDate: string): { start_at: string; end_at: string } {
  const wall = clickedIso ? isoToWall(clickedIso, zone) : { date: fallbackDate, time: '09:00' };
  if (scale === 'day' && clickedIso) {
    const start = wallToIso(wall.date, `${wall.time.slice(0, 2)}:00`, zone);
    return { start_at: start, end_at: toIso(Date.parse(start) + 3_600_000) };
  }
  return { start_at: wallToIso(wall.date, '09:00', zone), end_at: wallToIso(wall.date, '17:00', zone) };
}

export function publishSummary(shifts: Shift[]): { ids: string[]; employees: number; open: number } {
  const drafts = shifts.filter((s) => s.state === 'draft');
  return {
    ids: drafts.map((s) => s.id),
    employees: new Set(drafts.flatMap((s) => (s.employee_ref ? [s.employee_ref] : []))).size,
    open: drafts.filter((s) => s.employee_ref === null).length,
  };
}
```

- [ ] **Step 3: Implement the board**

`src/client/schedule/Board.tsx`:

```tsx
'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import type { Role, SchedulePayload, Shift, TimeSpan } from '../types';
import { applyDrag, deltaFromPixels, type DragMode, snapMinutes } from './drag';
import { assignLanes, geometry } from './layout';
import { dayLabel, type Period } from './period';
import type { Row } from './rows';
import { formatTime, toIso } from './tz';

export interface ShiftChange { start_at?: string; end_at?: string; employee_ref?: string | null }

interface BoardProps {
  data: SchedulePayload;
  rows: Row[];
  period: Period;
  onOpen?: (shift: Shift) => void;
  onCreate?: (rowRef: string | null, atIso: string) => void;
  onChange?: (shift: Shift, change: ShiftChange) => void;
}

/** Which row is under the pointer. The dragged bar is hidden for the hit test so it doesn't find itself. */
function rowRefAt(bar: HTMLElement, x: number, y: number): string | null | undefined {
  bar.style.visibility = 'hidden';
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row-ref]');
  bar.style.visibility = '';
  if (!row) return undefined;
  return row.dataset.rowRef === 'open' ? null : row.dataset.rowRef;
}

export function Board({ data, rows, period, onOpen, onCreate, onChange }: BoardProps) {
  const { from_at: from, to_at: to, timezone: zone } = data.period;
  const periodMs = Date.parse(to) - Date.parse(from);
  const roles = new Map(data.roles.map((r) => [r.id, r]));
  const columns = period.scale === 'day'
    ? Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
    : period.days.map((d) => dayLabel(d, period.scale));

  function startGesture(event: PointerEvent<HTMLDivElement>, shift: Shift) {
    if (event.button !== 0 || !onChange) return;
    event.preventDefault();
    const bar = event.currentTarget;
    const width = bar.parentElement!.getBoundingClientRect().width;
    const mode = ((event.target as HTMLElement).dataset.grip as DragMode | undefined) ?? 'move';
    const { clientX: x0, clientY: y0, pointerId } = event;
    const originalStyle = bar.getAttribute('style') ?? '';
    const left0 = bar.offsetLeft;
    const width0 = bar.offsetWidth;
    let moved = false;
    bar.setPointerCapture(pointerId);

    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      if (mode === 'move') bar.style.transform = `translate(${dx}px, ${dy}px)`;
      else if (mode === 'resize-end') bar.style.width = `${Math.max(8, width0 + dx)}px`;
      else {
        bar.style.left = `${left0 + dx}px`;
        bar.style.width = `${Math.max(8, width0 - dx)}px`;
      }
    };
    const up = (e: globalThis.PointerEvent) => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.releasePointerCapture(pointerId);
      const targetRef = mode === 'move' && moved ? rowRefAt(bar, e.clientX, e.clientY) : undefined;
      bar.setAttribute('style', originalStyle);
      if (!moved) {
        onOpen?.(shift);
        return;
      }
      const change: ShiftChange = { ...(applyDrag(shift, mode, deltaFromPixels(e.clientX - x0, width, periodMs, snapMinutes(period.scale))) ?? {}) };
      if (targetRef !== undefined && targetRef !== shift.employee_ref) change.employee_ref = targetRef;
      if (Object.keys(change).length > 0) onChange(shift, change);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  }

  function clickTrack(event: MouseEvent<HTMLDivElement>, rowRef: string | null) {
    if (!onCreate || (event.target as HTMLElement).closest('[data-shift-id]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onCreate(rowRef, toIso(Date.parse(from) + ((event.clientX - rect.left) / rect.width) * periodMs));
  }

  function keyOnShift(event: KeyboardEvent<HTMLDivElement>, shift: Shift) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen?.(shift);
    }
  }

  const band = (span: TimeSpan, kind: string, label: string, key: string) => {
    const g = geometry(span.start_at, span.end_at, from, to);
    return g && <div key={key} className={`band ${kind}`} style={{ left: `${g.left}%`, width: `${g.width}%` }} title={label || undefined} />;
  };

  const bar = (shift: Shift, lane: number) => {
    const g = geometry(shift.start_at, shift.end_at, from, to);
    if (!g) return null;
    const role: Role | undefined = shift.role_id ? roles.get(shift.role_id) : undefined;
    const label = `${formatTime(shift.start_at, zone)}–${formatTime(shift.end_at, zone)}${role ? ` ${role.name}` : ''}`;
    const problems = shift.conflicts.map((c) => c.message);
    const title = [label, shift.state === 'draft' ? 'Draft, not published' : 'Published', ...problems].join('\n');
    const classes = ['shift', shift.state, problems.length && 'conflict', g.clippedStart && 'clipped-start', g.clippedEnd && 'clipped-end'].filter(Boolean).join(' ');
    return (
      <div
        key={shift.id}
        className={classes}
        data-shift-id={shift.id}
        role="button"
        tabIndex={0}
        title={title}
        aria-label={title.replace(/\n/g, '. ')}
        style={{ left: `${g.left}%`, width: `${g.width}%`, top: lane * 30 + 4, ...(role ? { '--role-color': role.color } : {}) } as CSSProperties}
        onPointerDown={(e) => startGesture(e, shift)}
        onKeyDown={(e) => keyOnShift(e, shift)}
      >
        <span className="grip start" data-grip="resize-start" />
        {problems.length > 0 && '⚠ '}
        {label}
        <span className="grip end" data-grip="resize-end" />
      </div>
    );
  };

  return (
    <div className="board" role="region" aria-label="Schedule">
      <div className="row head">
        <div className="cell label">{rows.some((r) => r.kind === 'header') ? 'Role / employee' : 'Employee'}</div>
        <div className="track cols" style={{ '--cols': columns.length } as CSSProperties}>{columns.map((c, i) => <div key={i}>{c}</div>)}</div>
        <div className="cell hours">Hours</div>
      </div>
      {rows.map((row) => {
        if (row.kind === 'header') return <div key={row.key} className="row group"><div className="cell">{row.label}</div></div>;
        const e = row.employee;
        const { lanes, count } = assignLanes(row.shifts);
        const rowRef = e ? e.employee_ref : null;
        return (
          <div key={row.key} className={`row${e && !e.flexible ? ' has-hours' : ''}`} data-row-ref={rowRef ?? 'open'}>
            <div className="cell label">
              <div className="name">
                {e?.photo_url && <img className="avatar" src={e.photo_url} alt="" />}
                {row.label}
              </div>
              <div className="meta">
                {e ? [e.department_name, e.flexible ? 'Flexible hours' : '', e.on_roster ? '' : 'Not on the roster'].filter(Boolean).join(' · ') : `${row.shifts.length} in view`}
              </div>
            </div>
            <div className="track" data-track style={{ '--cols': columns.length, '--lanes': count } as CSSProperties} onClick={(ev) => clickTrack(ev, rowRef)}>
              {e && !e.flexible && e.working_intervals.map((i, n) => band(i, 'work', '', `w${n}`))}
              {e?.unavailable.map((u, n) => band(u, `away ${u.kind}`, u.label, `u${n}`))}
              {row.shifts.map((s) => bar(s, lanes.get(s.id) ?? 0))}
            </div>
            <div className="cell hours">
              {e && (
                <>
                  {e.allocated_hours.toFixed(1)} / {e.available_hours === null ? 'flexible' : e.available_hours.toFixed(1)} h
                  {e.over_allocated_days.length > 0 && (
                    <span className="over" title={`Over-allocated on ${e.over_allocated_days.join(', ')}`}>
                      ⚠ {e.over_allocated_days.length} day{e.over_allocated_days.length > 1 ? 's' : ''} over
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

The escaping test passes because React escapes text content and never renders the name as HTML.

- [ ] **Step 4: The read-only schedule page and board styles**

`src/client/schedule/SchedulePage.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, query } from '../api';
import type { Me, SchedulePayload } from '../types';
import { Board } from './Board';
import { periodFor, periodLabel, type Scale, step } from './period';
import { buildRows, type Filters, type GroupBy, NO_FILTERS } from './rows';
import { todayIn } from './tz';

export function SchedulePage({ me }: { me: Me }) {
  const [scale, setScale] = useState<Scale>('week');
  const [anchor, setAnchor] = useState(() => todayIn(me.organisation_timezone));
  const [groupBy, setGroupBy] = useState<GroupBy>('employee');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const period = useMemo(() => periodFor(scale, anchor), [scale, anchor]);

  const reload = useCallback(async () => {
    try {
      setData(await api<SchedulePayload>('GET', `/api/schedule${query({ from: period.from, to: period.to })}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [period.from, period.to]);
  useEffect(() => void reload(), [reload]);

  const rows = useMemo(() => (data ? buildRows(data, groupBy, filters) : []), [data, groupBy, filters]);
  const departments = useMemo(() => [...new Map((data?.employees ?? []).filter((e) => e.department_id).map((e) => [e.department_id!, e.department_name ?? e.department_id!]))], [data]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <section className="schedule">
      <div className="toolbar">
        <button type="button" aria-label="Previous period" onClick={() => setAnchor(step(scale, anchor, -1))}>‹</button>
        <button type="button" onClick={() => setAnchor(todayIn(me.organisation_timezone))}>Today</button>
        <button type="button" aria-label="Next period" onClick={() => setAnchor(step(scale, anchor, 1))}>›</button>
        <span className="period">{periodLabel(period)}</span>
        <select aria-label="Scale" value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
          <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
        </select>
        <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="employee">By employee</option><option value="role">By role</option>
        </select>
        <select aria-label="Filter by role" value={filters.roleId} onChange={(e) => set({ roleId: e.target.value })}>
          <option value="">All roles</option>
          {data?.roles.filter((r) => !r.archived).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select aria-label="Filter by department" value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
          <option value="">All departments</option>
          {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Filter by state" value={filters.state} onChange={(e) => set({ state: e.target.value as Filters['state'] })}>
          <option value="">All shifts</option><option value="draft">Drafts</option><option value="published">Published</option><option value="open">Open shifts</option>
        </select>
        <input type="search" aria-label="Find employee" placeholder="Find employee" value={filters.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      {data?.directory_stale && <p className="notice">Employee names may be out of date because the roster could not be refreshed. Planning still works.</p>}
      {error && <p className="form-error">{error}</p>}
      {data ? <Board data={data} rows={rows} period={period} /> : !error && <p className="empty">Loading…</p>}
    </section>
  );
}
```

Append to `src/app/globals.css`:

```css
.schedule .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.schedule .period { font-weight: 600; min-width: 200px; }
.notice { background: var(--off); border: 1px solid var(--line); padding: 8px 12px; border-radius: var(--radius); margin: 0 0 12px; }
.board { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; }
.board .row { display: grid; grid-template-columns: 200px minmax(640px, 1fr) 110px; border-bottom: 1px solid var(--line); }
.board .row:last-child { border-bottom: 0; }
.board .row.head { position: sticky; top: 0; background: var(--surface); z-index: 2; font-size: 12px; color: var(--muted); }
.board .row.group { grid-template-columns: 1fr; background: var(--off); font-weight: 600; }
.board .cell { padding: 6px 10px; min-width: 0; }
.board .label .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board .label .meta { font-size: 12px; color: var(--muted); }
.track { position: relative; height: calc(var(--lanes, 1) * 30px + 8px); cursor: copy;
  background-image: repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px calc(100% / var(--cols))); }
.track.cols { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); height: auto; background: none; cursor: default; }
.track.cols > div { padding: 6px 4px; border-left: 1px solid var(--line); overflow: hidden; white-space: nowrap; }
.row.has-hours .track { background-color: var(--off); }
.band { position: absolute; top: 0; bottom: 0; pointer-events: none; }
.band.work { background: var(--surface); }
.band.away { background: var(--away); }
.shift { position: absolute; height: 26px; border-radius: 4px; padding: 3px 8px; font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  cursor: grab; touch-action: none; user-select: none; border: 1px solid var(--role-color, var(--accent)); background: var(--role-color, var(--accent)); color: #fff; }
.shift.draft { color: var(--text); background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--role-color, var(--accent)) 35%, transparent) 0 6px, color-mix(in srgb, var(--role-color, var(--accent)) 15%, transparent) 6px 12px); }
.shift.conflict { outline: 2px solid var(--danger); outline-offset: 1px; }
.shift.clipped-start { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.shift.clipped-end { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.shift .grip { position: absolute; top: 0; bottom: 0; width: 7px; cursor: ew-resize; }
.shift .grip.start { left: 0; }
.shift .grip.end { right: 0; }
.shift[style*="translate"] { opacity: 0.85; cursor: grabbing; z-index: 3; box-shadow: 0 4px 12px rgb(0 0 0 / 0.2); }
.hours { font-size: 12px; font-variant-numeric: tabular-nums; }
.over { display: block; color: var(--warn); font-weight: 600; }
.avatar { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 6px; }
```

- [ ] **Step 5: Run tests and check in the browser**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS.

Then load demo data and look at the board:
- Either set `INTERLINK_CLIENT_ID` so the real roster loads, or insert a few rows into `employee_directory` with pgAdmin's Query Tool.
- Create shifts with `curl -X POST http://127.0.0.1:3000/api/shifts -H 'content-type: application/json' -d '{...}'`.

Check that:
- The scales and previous, today and next all work.
- Drafts are striped and published shifts are solid.
- Time off is hatched, and time outside working hours is grey.
- The hours column shows allocated against available hours.
- Grouping by role shows role headers.
- The "Drafts" filter keeps every employee row.
- At 1024px wide only the board scrolls sideways, not the page.

- [ ] **Step 6: Commit**

```bash
git add src/client src/app/globals.css
git commit -m "feat: add schedule board with scales, grouping, filters and markers"
```

---

### Task 21: Editing on the schedule: shift form, drag to save, delete with undo, duplicate, publish

**Files:**
- Create: `src/client/schedule/shiftForm.ts`, `src/client/schedule/ShiftDialog.tsx`
- Replace: `src/client/schedule/SchedulePage.tsx`
- Test: `src/client/schedule/shiftForm.test.ts`

**Interfaces:**
- Consumes: Task 20's `Board` callbacks, `useFeedback()`, and the endpoints `POST`/`PATCH`/`DELETE /api/shifts`, `POST /api/shift-restorations` and `POST /api/publications`.
- Produces:
  - `interface ShiftForm`, `shiftToForm(shift, zone)`, `formToBody(form, zone)` and `FIELD_FOR` (maps API field names to form field names).
  - `saveShift(method, path, body, confirm): Promise<Shift | null>`. On `SHIFT_CONFLICT` it asks for confirmation and resends with `acknowledge_conflicts`; it returns null if the manager cancels.
  - `<ShiftDialog data shift initial onClose onSaved />`.

Requirements covered:
- FR-SHF-01, 02: create from the "Add shift" button or by clicking an empty part of a row. The employee's default role is preset.
- FR-SHF-03: drag to move, including onto another row; resize from either edge.
- FR-SHF-05: duplicate.
- FR-SHF-07: delete with a 10-second undo.
- FR-SHF-08: allocated percentage.
- FR-SHF-09: a conflict warning with "Save anyway".
- FR-SHF-10: note.
- FR-PUB-01: publish the drafts in the current view and filter.
- NFR-07: every drag action can also be done in the form.

- [ ] **Step 1: Write the failing test**

`src/client/schedule/shiftForm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { FIELD_FOR, formToBody, saveShift, shiftToForm } from './shiftForm';
import { shift } from './testData';

const zone = 'Asia/Kuala_Lumpur';

vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>();
  return { ...actual, api: vi.fn() };
});
const { api } = await import('../api');

describe('shift form', () => {
  it('round-trips a shift through the form in the organisation time zone', () => {
    const form = shiftToForm(shift({ note: 'Bring keys', break_minutes: 30, allocated_percent: 50 }), zone);
    expect(form).toMatchObject({ employee_ref: 'E1', start_date: '2026-10-14', start_time: '09:00', end_date: '2026-10-14', end_time: '17:00', break_minutes: '30', allocated_percent: '50', note: 'Bring keys' });
    expect(formToBody(form, zone)).toEqual({
      employee_ref: 'E1', role_id: null, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z', break_minutes: 30, allocated_percent: 50, note: 'Bring keys',
    });
  });

  it('treats an empty employee as an open shift and an empty note as none', () => {
    const body = formToBody({ ...shiftToForm(shift(), zone), employee_ref: '', note: '  ' }, zone);
    expect([body.employee_ref, body.note]).toEqual([null, null]);
  });

  it('maps API field errors onto inputs', () => {
    expect([FIELD_FOR.start_at, FIELD_FOR.end_at, FIELD_FOR.break_minutes]).toEqual(['start_time', 'end_time', 'break_minutes']);
  });

  it('asks before saving over a conflict and resends with acknowledgement (FR-SHF-09)', async () => {
    const conflict = new ApiError(409, 'SHIFT_CONFLICT', 'Breaks a rule.', { conflicts: [{ rule: 'overlap', message: 'Overlaps.' }] }, 'c');
    vi.mocked(api).mockRejectedValueOnce(conflict).mockResolvedValueOnce({ shift: shift() });
    const confirm = vi.fn(async () => true);

    expect(await saveShift('POST', '/api/shifts', { a: 1 }, confirm)).toMatchObject({ id: 's1' });
    expect(confirm).toHaveBeenCalledWith('This shift breaks a planning rule', ['Overlaps.'], 'Save anyway');
    expect(vi.mocked(api).mock.calls[1][2]).toEqual({ a: 1, acknowledge_conflicts: true });

    vi.mocked(api).mockRejectedValueOnce(conflict);
    expect(await saveShift('POST', '/api/shifts', { a: 1 }, async () => false)).toBeNull();
  });
});
```

Run: `npx vitest run --project client`
Expected: FAIL.

- [ ] **Step 2: Implement the form helpers and the dialog**

`src/client/schedule/shiftForm.ts`:

```ts
import { api, ApiError } from '../api';
import type { Conflict, Shift } from '../types';
import { isoToWall, wallToIso } from './tz';

export interface ShiftForm {
  employee_ref: string;
  role_id: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  break_minutes: string;
  allocated_percent: string;
  note: string;
}

/** API error field -> form input. */
export const FIELD_FOR: Record<string, keyof ShiftForm> = {
  employee_ref: 'employee_ref', role_id: 'role_id', start_at: 'start_time', end_at: 'end_time',
  break_minutes: 'break_minutes', allocated_percent: 'allocated_percent', note: 'note',
};

type FormSource = Pick<Shift, 'employee_ref' | 'role_id' | 'start_at' | 'end_at' | 'break_minutes' | 'allocated_percent' | 'note'>;

export function shiftToForm(s: FormSource, zone: string): ShiftForm {
  const start = isoToWall(s.start_at, zone);
  const end = isoToWall(s.end_at, zone);
  return {
    employee_ref: s.employee_ref ?? '', role_id: s.role_id ?? '',
    start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time,
    break_minutes: String(s.break_minutes), allocated_percent: String(s.allocated_percent), note: s.note ?? '',
  };
}

export function formToBody(f: ShiftForm, zone: string): Record<string, unknown> {
  return {
    employee_ref: f.employee_ref || null,
    role_id: f.role_id || null,
    start_at: wallToIso(f.start_date, f.start_time, zone),
    end_at: wallToIso(f.end_date, f.end_time, zone),
    break_minutes: Number(f.break_minutes || 0),
    allocated_percent: Number(f.allocated_percent || 100),
    note: f.note.trim() || null,
  };
}

type Confirm = (title: string, lines: string[], label: string) => Promise<boolean>;

/** Saves; on SHIFT_CONFLICT asks and resends with acknowledge_conflicts (FR-SHF-09). null = the manager cancelled. */
export async function saveShift(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>, confirm: Confirm): Promise<Shift | null> {
  try {
    return (await api<{ shift: Shift }>(method, path, body)).shift;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'SHIFT_CONFLICT') throw error;
    const lines = ((error.details as { conflicts?: Conflict[] } | null)?.conflicts ?? []).map((c) => c.message);
    if (!(await confirm('This shift breaks a planning rule', lines, 'Save anyway'))) return null;
    return (await api<{ shift: Shift }>(method, path, { ...body, acknowledge_conflicts: true })).shift;
  }
}
```

`src/client/schedule/ShiftDialog.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { Modal, useFeedback } from '../feedback';
import type { SchedulePayload, Shift } from '../types';
import { FIELD_FOR, formToBody, saveShift, type ShiftForm } from './shiftForm';

interface Props {
  data: SchedulePayload;
  shift: Shift | null;
  initial: ShiftForm;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ShiftDialog({ data, shift, initial, onClose, onSaved }: Props) {
  const { confirm, toast } = useFeedback();
  const [form, setForm] = useState<ShiftForm>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ShiftForm, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const zone = data.period.timezone;
  const roles = data.roles.filter((r) => !r.archived || r.id === initial.role_id);
  const set = (patch: Partial<ShiftForm>) => setForm((f) => ({ ...f, ...patch }));

  function changeEmployee(ref: string) {
    // FR-SHF-01 AC2: a new shift takes the employee's default role.
    set(shift ? { employee_ref: ref } : { employee_ref: ref, role_id: data.employees.find((e) => e.employee_ref === ref)?.default_role_id ?? '' });
  }

  async function done(text?: string) {
    onClose();
    await onSaved();
    if (text) toast(text, undefined, 4000);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    const body = { ...formToBody(form, zone), ...(shift ? { version: shift.version } : {}) };
    try {
      const saved = await saveShift(shift ? 'PATCH' : 'POST', shift ? `/api/shifts/${shift.id}` : '/api/shifts', body, confirm);
      if (saved) await done(shift ? 'Shift saved.' : 'Shift created as a draft.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR' && error.details && typeof error.details === 'object') {
        const next: Partial<Record<keyof ShiftForm, string>> = {};
        for (const [field, text] of Object.entries(error.details as Record<string, string>)) {
          if (FIELD_FOR[field]) next[FIELD_FOR[field]] = text;
          else setMessage(text);
        }
        setErrors(next);
      } else {
        setMessage((error as Error).message);
      }
    }
  }

  async function remove() {
    if (!shift) return;
    const lines = shift.state === 'published' ? ['The employee will be told unless you undo within 10 seconds.'] : [];
    if (!(await confirm('Delete this shift?', lines, 'Delete'))) return;
    try {
      await api('DELETE', `/api/shifts/${shift.id}`);
      await done();
      toast('Shift deleted.', {
        label: 'Undo',
        run: async () => {
          try {
            await api('POST', '/api/shift-restorations', { shift_id: shift.id });
            await onSaved();
          } catch (error) {
            toast((error as Error).message, undefined, 5000);
          }
        },
      });
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function duplicate() {
    if (!shift) return;
    try {
      const copy = await saveShift('POST', '/api/shifts', { duplicate_of: shift.id }, confirm);
      if (copy) await done('Shift duplicated to the next day as a draft.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  const field = (name: keyof ShiftForm) => errors[name] && <span className="field-error">{errors[name]}</span>;

  return (
    <Modal title={shift ? 'Edit shift' : 'New shift'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {shift && shift.conflicts.length > 0 && <ul className="form-error">{shift.conflicts.map((c) => <li key={c.message}>{c.message}</li>)}</ul>}
        <div className="form-grid">
          <label className="wide">Employee
            <select value={form.employee_ref} onChange={(e) => changeEmployee(e.target.value)}>
              <option value="">Open shift (nobody yet)</option>
              {data.employees.filter((e) => e.on_roster || e.employee_ref === initial.employee_ref).map((e) => <option key={e.employee_ref} value={e.employee_ref}>{e.name}</option>)}
            </select>{field('employee_ref')}
          </label>
          <label className="wide">Role
            <select value={form.role_id} onChange={(e) => set({ role_id: e.target.value })}>
              <option value="">No role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>{field('role_id')}
          </label>
          <label>Start date<input type="date" required value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
          <label>Start time<input type="time" required value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} />{field('start_time')}</label>
          <label>End date<input type="date" required value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} /></label>
          <label>End time<input type="time" required value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />{field('end_time')}</label>
          <label>Break (minutes)<input type="number" min={0} max={1440} step={5} value={form.break_minutes} onChange={(e) => set({ break_minutes: e.target.value })} />{field('break_minutes')}</label>
          <label>Allocated %<input type="number" min={1} max={100} value={form.allocated_percent} onChange={(e) => set({ allocated_percent: e.target.value })} />{field('allocated_percent')}</label>
          <label className="wide">Note for the employee<textarea rows={2} maxLength={2000} value={form.note} onChange={(e) => set({ note: e.target.value })} />{field('note')}</label>
        </div>
        {message && <p className="form-error">{message}</p>}
        <div className="actions">
          {shift && <><button type="button" className="danger" onClick={remove}>Delete</button><button type="button" onClick={duplicate}>Duplicate</button><span className="spacer" /></>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 3: Replace the schedule page with the editing version**

`src/client/schedule/SchedulePage.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, query } from '../api';
import { useFeedback } from '../feedback';
import type { Me, SchedulePayload, Shift } from '../types';
import { Board, type ShiftChange } from './Board';
import { newShiftTimes, publishSummary } from './drag';
import { periodFor, periodLabel, type Scale, step } from './period';
import { buildRows, type Filters, type GroupBy, NO_FILTERS } from './rows';
import { ShiftDialog } from './ShiftDialog';
import { saveShift, type ShiftForm, shiftToForm } from './shiftForm';
import { todayIn } from './tz';

export function SchedulePage({ me }: { me: Me }) {
  const { confirm, toast } = useFeedback();
  const [scale, setScale] = useState<Scale>('week');
  const [anchor, setAnchor] = useState(() => todayIn(me.organisation_timezone));
  const [groupBy, setGroupBy] = useState<GroupBy>('employee');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ shift: Shift | null; initial: ShiftForm } | null>(null);
  const period = useMemo(() => periodFor(scale, anchor), [scale, anchor]);

  const reload = useCallback(async () => {
    try {
      setData(await api<SchedulePayload>('GET', `/api/schedule${query({ from: period.from, to: period.to })}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [period.from, period.to]);
  useEffect(() => void reload(), [reload]);

  const rows = useMemo(() => (data ? buildRows(data, groupBy, filters) : []), [data, groupBy, filters]);
  const departments = useMemo(() => [...new Map((data?.employees ?? []).filter((e) => e.department_id).map((e) => [e.department_id!, e.department_name ?? e.department_id!]))], [data]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const report = (e: unknown) => toast(e instanceof ApiError && e.code === 'STALE_SHIFT'
    ? 'Someone else changed that shift. The schedule has been reloaded.'
    : (e as Error).message, undefined, 6000);

  function openNew(rowRef: string | null, atIso: string | null) {
    if (!data) return;
    const times = newShiftTimes(scale, atIso, data.period.timezone, period.from);
    const employee = data.employees.find((e) => e.employee_ref === rowRef);
    setEditing({ shift: null, initial: shiftToForm({ employee_ref: rowRef, role_id: employee?.default_role_id ?? null, ...times, break_minutes: 0, allocated_percent: 100, note: null }, data.period.timezone) });
  }

  async function applyChange(shift: Shift, change: ShiftChange) {
    try {
      const saved = await saveShift('PATCH', `/api/shifts/${shift.id}`, { version: shift.version, ...change }, confirm);
      if (saved) toast(shift.state === 'published' ? 'Shift moved. The employee will be told.' : 'Shift moved.', undefined, 4000);
    } catch (e) {
      report(e);
    }
    await reload();
  }

  async function publish() {
    const summary = publishSummary(rows.flatMap((r) => r.shifts));
    if (summary.ids.length === 0) {
      toast('There are no draft shifts in this view.', undefined, 4000);
      return;
    }
    const lines = [
      `${summary.ids.length} draft shift${summary.ids.length === 1 ? '' : 's'} in this view will be published.`,
      `${summary.employees} employee${summary.employees === 1 ? '' : 's'} will be told about their shifts.`,
      ...(summary.open ? [`${summary.open} open shift${summary.open === 1 ? '' : 's'} will be published too.`] : []),
    ];
    if (!(await confirm('Publish shifts?', lines, 'Publish'))) return;
    try {
      const result = await api<{ published: number }>('POST', '/api/publications', { shift_ids: summary.ids });
      toast(`Published ${result.published} shift${result.published === 1 ? '' : 's'}.`, undefined, 5000);
    } catch (e) {
      report(e);
    }
    await reload();
  }

  return (
    <section className="schedule">
      <div className="toolbar">
        <button type="button" aria-label="Previous period" onClick={() => setAnchor(step(scale, anchor, -1))}>‹</button>
        <button type="button" onClick={() => setAnchor(todayIn(me.organisation_timezone))}>Today</button>
        <button type="button" aria-label="Next period" onClick={() => setAnchor(step(scale, anchor, 1))}>›</button>
        <span className="period">{periodLabel(period)}</span>
        <select aria-label="Scale" value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
          <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
        </select>
        <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="employee">By employee</option><option value="role">By role</option>
        </select>
        <select aria-label="Filter by role" value={filters.roleId} onChange={(e) => set({ roleId: e.target.value })}>
          <option value="">All roles</option>
          {data?.roles.filter((r) => !r.archived).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select aria-label="Filter by department" value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
          <option value="">All departments</option>
          {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Filter by state" value={filters.state} onChange={(e) => set({ state: e.target.value as Filters['state'] })}>
          <option value="">All shifts</option><option value="draft">Drafts</option><option value="published">Published</option><option value="open">Open shifts</option>
        </select>
        <input type="search" aria-label="Find employee" placeholder="Find employee" value={filters.name} onChange={(e) => set({ name: e.target.value })} />
        <span className="spacer" />
        <button type="button" onClick={() => openNew(null, null)}>Add shift</button>
        <button type="button" className="primary" onClick={publish}>Publish</button>
      </div>
      {data?.directory_stale && <p className="notice">Employee names may be out of date because the roster could not be refreshed. Planning still works.</p>}
      {error && <p className="form-error">{error}</p>}
      {data ? (
        <Board
          data={data}
          rows={rows}
          period={period}
          onOpen={(shift) => setEditing({ shift, initial: shiftToForm(shift, data.period.timezone) })}
          onCreate={openNew}
          onChange={applyChange}
        />
      ) : !error && <p className="empty">Loading…</p>}
      {editing && data && <ShiftDialog data={data} shift={editing.shift} initial={editing.initial} onClose={() => setEditing(null)} onSaved={reload} />}
    </section>
  );
}
```

- [ ] **Step 4: Run tests and the type check**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Check in the browser**

Run `npm run dev` as an admin dev identity, then check each of these:

1. "Add shift", then pick an employee who has a default role. The role preselects (FR-SHF-01 AC2). Save, and a striped draft appears.
2. Click an empty spot in another employee's row. The form opens preset to that employee and day.
3. Drag a shift to the next day, then onto another employee's row. Resize it from both ends. Each change saves when you drop it.
4. Create a shift that overlaps another. "This shift breaks a planning rule" appears. Choose "Save anyway". The bar gets a red outline, and hovering shows the reason.
5. Open the same shift in two tabs, save it in one, then save it in the other. The second save reports the stale-edit message (Review Focus 1).
6. Delete a shift and click "Undo" within 10 seconds. It comes back.
7. "Duplicate" puts a draft copy on the next day.
8. Set the "Drafts" filter, then click "Publish". The confirmation shows the right counts, and afterwards the bars turn solid.
9. Use only the keyboard: Tab to a shift, press Enter, change the times, and save (NFR-07).

- [ ] **Step 6: Commit**

```bash
git add src/client
git commit -m "feat: add shift form, drag to save, undoable delete, duplicate and publish"
```

---

### Task 22: My Planning (employee view)

**Files:**
- Create: `src/client/my/days.ts`
- Replace: `src/client/my/MyPlanningPage.tsx`
- Modify: `src/app/globals.css`
- Test: `src/client/my/days.test.ts`

**Interfaces:**
- Consumes: `GET /api/my/shifts` (Task 18), `periodFor`, `step`, `dayLabel`, `periodLabel`, `todayIn`, `formatTime`, `isoToWall`.
- Produces: `groupByDay(shifts, days, zone): { date, shifts }[]` and `MyPlanningPage({ me })`.

Requirements covered:
- FR-MYP-01: the employee's published shifts as a week calendar, in their time zone.
- FR-MYP-02: usable from 360px wide.

A shift is listed under the local day it starts, so an overnight shift appears once.

- [ ] **Step 1: Write the failing test**

`src/client/my/days.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MyShift } from '../types';
import { groupByDay } from './days';

const shift = (id: string, start: string, end: string): MyShift => ({ id, role_id: null, start_at: start, end_at: end, break_minutes: 0, allocated_hours: 8, note: null });
const days = ['2026-10-12', '2026-10-13', '2026-10-14'];

describe('groupByDay', () => {
  it('lists each shift once, under the local day it starts', () => {
    const groups = groupByDay([
      shift('overnight', '2026-10-12T14:00:00Z', '2026-10-12T22:00:00Z'), // 22:00–06:00 in Kuala Lumpur
      shift('late', '2026-10-13T16:30:00Z', '2026-10-13T20:00:00Z'), // 00:30 on the 14th locally
      shift('early', '2026-10-13T01:00:00Z', '2026-10-13T09:00:00Z'),
    ], days, 'Asia/Kuala_Lumpur');
    expect(groups.map((g) => [g.date, g.shifts.map((s) => s.id)])).toEqual([['2026-10-12', ['overnight']], ['2026-10-13', ['early']], ['2026-10-14', ['late']]]);
  });

  it('keeps empty days so the calendar has every column', () => {
    expect(groupByDay([], days, 'Asia/Kuala_Lumpur').map((g) => g.shifts.length)).toEqual([0, 0, 0]);
  });
});
```

Run: `npx vitest run --project client`
Expected: FAIL.

- [ ] **Step 2: Implement it**

`src/client/my/days.ts`:

```ts
import { isoToWall } from '../schedule/tz';
import type { MyShift } from '../types';

export function groupByDay(shifts: MyShift[], days: string[], zone: string): { date: string; shifts: MyShift[] }[] {
  const sorted = [...shifts].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return days.map((date) => ({ date, shifts: sorted.filter((s) => isoToWall(s.start_at, zone).date === date) }));
}
```

`src/client/my/MyPlanningPage.tsx`:

```tsx
'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { api, query } from '../api';
import { dayLabel, periodFor, periodLabel, step } from '../schedule/period';
import { formatTime, todayIn } from '../schedule/tz';
import type { Me, MyShiftsPayload } from '../types';
import { groupByDay } from './days';

export function MyPlanningPage({ me }: { me: Me }) {
  const [anchor, setAnchor] = useState(() => todayIn(me.timezone));
  const [data, setData] = useState<MyShiftsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const week = useMemo(() => periodFor('week', anchor), [anchor]);

  useEffect(() => {
    api<MyShiftsPayload>('GET', `/api/my/shifts${query({ from: week.from, to: week.to })}`).then(
      (payload) => {
        setData(payload);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [week.from, week.to]);

  const roles = new Map((data?.roles ?? []).map((r) => [r.id, r]));
  const today = data ? todayIn(data.timezone) : '';

  return (
    <section className="my">
      <div className="toolbar">
        <button type="button" aria-label="Previous week" onClick={() => setAnchor(step('week', anchor, -1))}>‹</button>
        <button type="button" onClick={() => setAnchor(todayIn(me.timezone))}>This week</button>
        <button type="button" aria-label="Next week" onClick={() => setAnchor(step('week', anchor, 1))}>›</button>
        <span className="period">{periodLabel(week)}</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      {data && data.shifts.length === 0 && <p className="empty">No published shifts this week.</p>}
      {data && data.shifts.length > 0 && (
        <>
          <div className="week">
            {groupByDay(data.shifts, week.days, data.timezone).map((group) => (
              <div key={group.date} className={`day${group.date === today ? ' today' : ''}${group.shifts.length ? '' : ' empty-day'}`}>
                <h3>{dayLabel(group.date, 'week')}</h3>
                {group.shifts.map((s) => {
                  const role = s.role_id ? roles.get(s.role_id) : undefined;
                  return (
                    <div key={s.id} className="card" style={role ? ({ '--role-color': role.color } as CSSProperties) : undefined}>
                      <div className="time">{formatTime(s.start_at, data.timezone)}–{formatTime(s.end_at, data.timezone)}</div>
                      <div className="meta">{[role?.name, `${s.allocated_hours.toFixed(1)} h`, s.break_minutes ? `${s.break_minutes} min break` : ''].filter(Boolean).join(' · ')}</div>
                      {s.note && <div className="note">{s.note}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="empty">Times are shown in {data.timezone}.</p>
        </>
      )}
    </section>
  );
}
```

Append to `src/app/globals.css`:

```css
.my .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.my .period { font-weight: 600; }
.week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.day { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px; min-height: 96px; }
.day h3 { margin: 0 0 6px; font-size: 13px; color: var(--muted); }
.day.today h3 { color: var(--accent); }
.card { border-left: 4px solid var(--role-color, var(--accent)); background: var(--off); border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; }
.card .time { font-weight: 600; }
.card .meta, .card .note { font-size: 12px; color: var(--muted); }
@media (max-width: 720px) {
  .week { grid-template-columns: 1fr; }
  .day { min-height: 0; }
  .day.empty-day { display: none; }
}
```

- [ ] **Step 3: Run tests, then check on a phone-sized screen**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS.

In `.env.local`, set `DEV_EMPLOYEE_REF` to an employee who has published shifts and `DEV_USER_ROLE=user`. Restart `npm run dev` and open `/my`. Check:
- Only published shifts appear (FR-PUB-02).
- With the devtools device toolbar at 360px, the days stack, empty days are hidden, and there's no horizontal scroll.

- [ ] **Step 4: Commit**

```bash
git add src/client/my src/app/globals.css
git commit -m "feat: add My Planning week view for employees"
```

---

### Task 23: Settings screens

**Files:**
- Create: `src/client/settings/common.ts`, `workingHoursInput.ts`, `GeneralTab.tsx`, `RolesTab.tsx`, `EmployeesTab.tsx`, `TimeOffTab.tsx`, `HolidaysTab.tsx`, `ManagersTab.tsx`
- Replace: `src/client/settings/SettingsPage.tsx`
- Modify: `src/app/globals.css`
- Test: `src/client/settings/workingHoursInput.test.ts`

**Interfaces:**
- Consumes: Task 11–14 endpoints, `api`, `useFeedback`, `Modal`, `wallToIso`, `isoToWall`, `todayIn`, `periodFor`, `addDays`.
- Produces:
  - `SettingsPage({ me, tab })`. The tabs are `general`, `roles`, `employees`, `time-off`, `holidays` and `managers`.
  - `useLoad(loader, deps)` and `errorText(error)`.
  - `parseRanges(text)`, `formatRanges(ranges)`, `readWorkingHours(values)`, `weeklyHours(hours)`.

Requirements covered:
- FR-CFG-01: roles.
- FR-CFG-02: employee profiles and working hours.
- FR-CFG-03: time off.
- FR-CFG-04: holidays.
- FR-ACC-03: the manager list, including the last-manager warning.

The server does all real validation. These screens show its 422 messages.

- [ ] **Step 1: Write the failing test**

`src/client/settings/workingHoursInput.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatRanges, parseRanges, readWorkingHours, weeklyHours } from './workingHoursInput';

describe('working hours input', () => {
  it('parses comma-separated ranges and pads hours', () => {
    expect(parseRanges('09:00-13:00, 14:00 - 18:00')).toEqual([['09:00', '13:00'], ['14:00', '18:00']]);
    expect(parseRanges('9:00-17:30')).toEqual([['09:00', '17:30']]);
    expect(parseRanges('  ')).toEqual([]);
    expect(() => parseRanges('nine to five')).toThrow('"nine to five" is not a range like 09:00-13:00.');
  });

  it('formats back to text', () => {
    expect(formatRanges([['09:00', '13:00'], ['14:00', '18:00']])).toBe('09:00-13:00, 14:00-18:00');
  });

  it('reads all seven days and names the bad one', () => {
    const empty = { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };
    expect(readWorkingHours({ ...empty, mon: '09:00-17:00' }).mon).toEqual([['09:00', '17:00']]);
    expect(() => readWorkingHours({ ...empty, tue: 'x' })).toThrow('Tuesday:');
  });

  it('totals the week', () => {
    const day: [string, string][] = [['09:00', '13:00'], ['14:00', '18:00']];
    expect(weeklyHours({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] })).toBe(40);
    expect(weeklyHours(null)).toBeNull();
  });
});
```

Run: `npx vitest run --project client`
Expected: FAIL.

- [ ] **Step 2: Implement the helpers**

`src/client/settings/workingHoursInput.ts`:

```ts
import type { Weekday, WorkingHoursMap } from '../types';

export const WEEKDAYS: [Weekday, string][] = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

export function parseRanges(text: string): [string, string][] {
  if (!text.trim()) return [];
  return text.split(',').map((part) => {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error(`"${part.trim()}" is not a range like 09:00-13:00.`);
    return [`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`];
  });
}

export const formatRanges = (ranges: [string, string][]) => ranges.map(([a, b]) => `${a}-${b}`).join(', ');

export function readWorkingHours(values: Record<Weekday, string>): WorkingHoursMap {
  const hours = {} as WorkingHoursMap;
  for (const [day, label] of WEEKDAYS) {
    try {
      hours[day] = parseRanges(values[day] ?? '');
    } catch (error) {
      throw new Error(`${label}: ${(error as Error).message}`);
    }
  }
  return hours;
}

export function weeklyHours(hours: WorkingHoursMap | null): number | null {
  if (!hours) return null;
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return WEEKDAYS.reduce((sum, [day]) => sum + (hours[day] ?? []).reduce((s, [a, b]) => s + minutes(b) - minutes(a), 0), 0) / 60;
}
```

`src/client/settings/common.ts`:

```ts
import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';

/** An API error as one readable sentence, including every field message from a 422. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.details && typeof error.details === 'object' && !Array.isArray(error.details)) {
    const fields = Object.entries(error.details as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([f, v]) => `${f}: ${v}`);
    return [error.message, ...fields].join(' ');
  }
  return (error as Error).message;
}

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): { data: T | null; error: string | null; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, deps);
  useEffect(() => void reload(), [reload]);
  return { data, error, reload };
}
```

- [ ] **Step 3: Implement the settings page and tabs**

`src/client/settings/SettingsPage.tsx`:

```tsx
'use client';

import Link from 'next/link';
import type { Me } from '../types';
import { EmployeesTab } from './EmployeesTab';
import { GeneralTab } from './GeneralTab';
import { HolidaysTab } from './HolidaysTab';
import { ManagersTab } from './ManagersTab';
import { RolesTab } from './RolesTab';
import { TimeOffTab } from './TimeOffTab';

const TABS = [
  ['general', 'General'], ['roles', 'Roles'], ['employees', 'Employees'], ['time-off', 'Time off'], ['holidays', 'Holidays'], ['managers', 'Managers'],
] as const;

export function SettingsPage({ me, tab }: { me: Me; tab: string }) {
  const active = TABS.some(([id]) => id === tab) ? tab : 'general';
  return (
    <section className="settings">
      <nav className="tabs" aria-label="Settings">
        {TABS.map(([id, label]) => <Link key={id} href={`/settings/${id}`} aria-current={id === active ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {active === 'general' && <GeneralTab />}
      {active === 'roles' && <RolesTab />}
      {active === 'employees' && <EmployeesTab />}
      {active === 'time-off' && <TimeOffTab me={me} />}
      {active === 'holidays' && <HolidaysTab me={me} />}
      {active === 'managers' && <ManagersTab />}
    </section>
  );
}
```

`src/client/settings/GeneralTab.tsx`:

```tsx
'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { Settings } from '../types';
import { errorText, useLoad } from './common';

export function GeneralTab() {
  const { toast } = useFeedback();
  const { data, error } = useLoad(() => api<{ settings: Settings }>('GET', '/api/settings'), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    try {
      await api('PATCH', '/api/settings', {
        country_code: form.country_code?.trim().toUpperCase() || null,
        region_code: form.region_code?.trim().toUpperCase() || null,
        timezone: form.timezone.trim(),
      });
      setProblem(null);
      toast('Settings saved.', undefined, 3000);
    } catch (e) {
      setProblem(errorText(e));
    }
  }

  if (error) return <p className="form-error">{error}</p>;
  if (!form) return <p className="empty">Loading…</p>;
  return (
    <form className="form-grid narrow" onSubmit={save}>
      <label>Country (ISO code)<input maxLength={2} placeholder="MY" value={form.country_code ?? ''} onChange={(e) => setForm({ ...form, country_code: e.target.value })} /></label>
      <label>State / region code<input maxLength={10} placeholder="MY-10" value={form.region_code ?? ''} onChange={(e) => setForm({ ...form, region_code: e.target.value })} /></label>
      <label className="wide">Organisation time zone<input list="zones" required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label>
      <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
      <p className="wide muted">The country and region decide which public holidays are loaded. Employees without their own time zone use this one.</p>
      {problem && <p className="wide form-error">{problem}</p>}
      <div className="wide actions"><button className="primary">Save</button></div>
    </form>
  );
}
```

`src/client/settings/RolesTab.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import { api } from '../api';
import type { Role } from '../types';
import { errorText, useLoad } from './common';

function RoleRow({ role, onDone, onError }: { role: Role; onDone: () => Promise<void>; onError: (e: unknown) => void }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color.toLowerCase());
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api('PATCH', `/api/roles/${role.id}`, body);
      await onDone();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <tr>
      <td><input aria-label="Role name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td><input type="color" aria-label="Role colour" value={color} onChange={(e) => setColor(e.target.value)} /></td>
      <td>{role.archived ? <span className="muted">Archived</span> : 'Active'}</td>
      <td className="row-actions">
        <button type="button" onClick={() => patch({ name, color })}>Save</button>
        <button type="button" onClick={() => patch({ archived: !role.archived })}>{role.archived ? 'Restore' : 'Archive'}</button>
      </td>
    </tr>
  );
}

export function RolesTab() {
  const { data, error, reload } = useLoad(() => api<{ roles: Role[] }>('GET', '/api/roles?include_archived=true'), []);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (e: unknown) => setProblem(errorText(e));

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api('POST', '/api/roles', { name, color });
      setName('');
      setProblem(null);
      await reload();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <form className="panel-head" onSubmit={add}>
        <label>New role<input required maxLength={80} placeholder="Technician" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Colour<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <button className="primary">Add role</button>
      </form>
      {(problem || error) && <p className="form-error">{problem ?? error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Colour</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data?.roles.map((r) => <RoleRow key={`${r.id}:${r.name}:${r.color}:${r.archived}`} role={r} onDone={reload} onError={fail} />)}
            {data && data.roles.length === 0 && <tr><td colSpan={4} className="muted">No roles yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

`src/client/settings/EmployeesTab.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { Modal, useFeedback } from '../feedback';
import type { EmployeeProfile, Role, Weekday } from '../types';
import { errorText, useLoad } from './common';
import { formatRanges, readWorkingHours, WEEKDAYS, weeklyHours } from './workingHoursInput';

function Editor({ employee, roles, onClose, onSaved }: { employee: EmployeeProfile; roles: Role[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [roleIds, setRoleIds] = useState<string[]>(employee.role_ids);
  const [defaultRoleId, setDefaultRoleId] = useState(employee.default_role_id ?? '');
  const [timezone, setTimezone] = useState(employee.timezone ?? '');
  const [flexible, setFlexible] = useState(employee.working_hours === null);
  const [hours, setHours] = useState<Record<Weekday, string>>(() =>
    Object.fromEntries(WEEKDAYS.map(([d]) => [d, formatRanges(employee.working_hours?.[d] ?? [])])) as Record<Weekday, string>);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await api('PATCH', `/api/employees/${encodeURIComponent(employee.employee_ref)}`, {
        role_ids: roleIds,
        default_role_id: defaultRoleId || null,
        timezone: timezone.trim() || null,
        working_hours: flexible ? null : readWorkingHours(hours),
      });
      onClose();
      toast('Planning profile saved.', undefined, 3000);
      await onSaved();
    } catch (e) {
      setProblem(errorText(e));
    }
  }

  return (
    <Modal title={employee.name} onClose={onClose}>
      <form onSubmit={save}>
        <fieldset>
          <legend>Roles</legend>
          {roles.map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={roleIds.includes(r.id)} onChange={(e) => setRoleIds(e.target.checked ? [...roleIds, r.id] : roleIds.filter((id) => id !== r.id))} />
              {r.name}
            </label>
          ))}
          {roles.length === 0 && <p className="muted">Create roles first.</p>}
        </fieldset>
        <div className="form-grid">
          <label>Default role
            <select value={defaultRoleId} onChange={(e) => setDefaultRoleId(e.target.value)}>
              <option value="">None</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label>Time zone (blank = organisation)<input value={timezone} placeholder={employee.effective_timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
          <label className="wide check"><input type="checkbox" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} /> Flexible hours (no fixed working hours)</label>
          {!flexible && WEEKDAYS.map(([day, label]) => (
            <label key={day}>{label}<input placeholder="09:00-13:00, 14:00-18:00" value={hours[day]} onChange={(e) => setHours({ ...hours, [day]: e.target.value })} /></label>
          ))}
        </div>
        {problem && <p className="form-error">{problem}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

export function EmployeesTab() {
  const { data, error, reload } = useLoad(() => Promise.all([
    api<{ employees: EmployeeProfile[] }>('GET', '/api/employees'),
    api<{ roles: Role[] }>('GET', '/api/roles'),
  ]), []);
  const [editing, setEditing] = useState<EmployeeProfile | null>(null);
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="empty">Loading…</p>;
  const [{ employees }, { roles }] = data;
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  return (
    <>
      <p className="muted">Employees come from the InterlinkERP roster. Here you set how each one can be planned.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Roles</th><th>Working hours</th><th>Time zone</th><th /></tr></thead>
          <tbody>
            {employees.map((e) => {
              const weekly = weeklyHours(e.working_hours);
              return (
                <tr key={e.employee_ref}>
                  <td>{e.name}<div className="muted">{e.department_name ?? ''}</div></td>
                  <td>{e.role_ids.map((id) => `${roleName.get(id) ?? id}${id === e.default_role_id ? ' (default)' : ''}`).join(', ') || '—'}</td>
                  <td>{weekly === null ? 'Flexible' : `${weekly.toFixed(1)} h / week`}</td>
                  <td>{e.effective_timezone}{!e.timezone && <span className="muted"> (organisation)</span>}</td>
                  <td><button type="button" onClick={() => setEditing(e)}>Edit</button></td>
                </tr>
              );
            })}
            {employees.length === 0 && <tr><td colSpan={5} className="muted">No employees yet. The roster may still be loading.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <Editor employee={editing} roles={roles} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}
```

`src/client/settings/TimeOffTab.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import { api, query } from '../api';
import { Modal, useFeedback } from '../feedback';
import { addDays, periodFor } from '../schedule/period';
import { isoToWall, todayIn, wallToIso } from '../schedule/tz';
import type { EmployeeProfile, Me, TimeOff } from '../types';
import { errorText, useLoad } from './common';

interface Draft { record: TimeOff | null; employee_ref: string; start_date: string; start_time: string; end_date: string; end_time: string; reason: string }

export function TimeOffTab({ me }: { me: Me }) {
  const zone = me.organisation_timezone;
  const { confirm } = useFeedback();
  const month = periodFor('month', todayIn(zone));
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(addDays(month.to, 31));
  const { data, error, reload } = useLoad(() => Promise.all([
    api<{ unavailabilities: TimeOff[] }>('GET', `/api/unavailabilities${query({ from, to })}`),
    api<{ employees: EmployeeProfile[] }>('GET', '/api/employees'),
  ]), [from, to]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const when = (iso: string) => {
    const w = isoToWall(iso, zone);
    return `${w.date} ${w.time}`;
  };
  const open = (record: TimeOff | null) => {
    const start = record ? isoToWall(record.start_at, zone) : { date: todayIn(zone), time: '00:00' };
    const end = record ? isoToWall(record.end_at, zone) : { date: addDays(todayIn(zone), 1), time: '00:00' };
    setProblem(null);
    setDraft({ record, employee_ref: record?.employee_ref ?? '', start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time, reason: record?.reason ?? '' });
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const body = { start_at: wallToIso(draft.start_date, draft.start_time, zone), end_at: wallToIso(draft.end_date, draft.end_time, zone), reason: draft.reason };
    try {
      if (draft.record) await api('PATCH', `/api/unavailabilities/${draft.record.id}`, body);
      else await api('POST', '/api/unavailabilities', { ...body, employee_ref: draft.employee_ref });
      setDraft(null);
      await reload();
    } catch (e) {
      setProblem(errorText(e));
    }
  }

  async function remove(record: TimeOff) {
    if (!(await confirm('Delete this time off?', [], 'Delete'))) return;
    try {
      await api('DELETE', `/api/unavailabilities/${record.id}`);
      await reload();
    } catch (e) {
      setProblem(errorText(e));
    }
  }

  const [timeOff, employees] = data ? [data[0].unavailabilities, data[1].employees] : [[], []];
  const nameOf = new Map(employees.map((e) => [e.employee_ref, e.name]));

  return (
    <>
      <div className="panel-head">
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => open(null)}>Record time off</button>
      </div>
      {(error || problem) && !draft && <p className="form-error">{problem ?? error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>From</th><th>To</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {timeOff.map((u) => (
              <tr key={u.id}>
                <td>{nameOf.get(u.employee_ref) ?? u.employee_ref}</td><td>{when(u.start_at)}</td><td>{when(u.end_at)}</td><td>{u.reason}</td>
                <td className="row-actions"><button type="button" onClick={() => open(u)}>Edit</button><button type="button" className="danger" onClick={() => remove(u)}>Delete</button></td>
              </tr>
            ))}
            {data && timeOff.length === 0 && <tr><td colSpan={5} className="muted">No time off in this range.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted">Times are in {zone}.</p>
      {draft && (
        <Modal title={draft.record ? 'Edit time off' : 'Record time off'} onClose={() => setDraft(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="wide">Employee
              <select required disabled={!!draft.record} value={draft.employee_ref} onChange={(e) => setDraft({ ...draft, employee_ref: e.target.value })}>
                <option value="">Choose…</option>
                {employees.map((e) => <option key={e.employee_ref} value={e.employee_ref}>{e.name}</option>)}
              </select>
            </label>
            <label>From date<input type="date" required value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} /></label>
            <label>From time<input type="time" required value={draft.start_time} onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} /></label>
            <label>To date<input type="date" required value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} /></label>
            <label>To time<input type="time" required value={draft.end_time} onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} /></label>
            <label className="wide">Reason<input maxLength={200} placeholder="Annual leave" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
            {problem && <p className="wide form-error">{problem}</p>}
            <div className="wide actions"><button type="button" onClick={() => setDraft(null)}>Cancel</button><button className="primary">Save</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
```

`src/client/settings/HolidaysTab.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useFeedback } from '../feedback';
import { todayIn } from '../schedule/tz';
import type { Holiday, Me } from '../types';
import { errorText, useLoad } from './common';

function HolidayRow({ holiday, act }: { holiday: Holiday; act: (h: Holiday, action: 'rename' | 'toggle' | 'delete', name?: string) => void }) {
  const [name, setName] = useState(holiday.name);
  return (
    <tr className={holiday.hidden ? 'muted' : undefined}>
      <td>{holiday.date}</td>
      <td><input aria-label="Holiday name" value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td>{holiday.source === 'manual' ? 'Added by hand' : 'Provider'}{holiday.hidden ? ' · hidden' : ''}</td>
      <td className="row-actions">
        <button type="button" onClick={() => act(holiday, 'rename', name)}>Save name</button>
        <button type="button" onClick={() => act(holiday, 'toggle')}>{holiday.hidden ? 'Show' : 'Hide'}</button>
        {holiday.source === 'manual' && <button type="button" className="danger" onClick={() => act(holiday, 'delete')}>Delete</button>}
      </td>
    </tr>
  );
}

export function HolidaysTab({ me }: { me: Me }) {
  const { confirm, toast } = useFeedback();
  const [year, setYear] = useState(() => Number(todayIn(me.organisation_timezone).slice(0, 4)));
  const { data, error, reload } = useLoad(() => api<{ holidays: Holiday[] }>('GET', `/api/holidays?year=${year}`), [year]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const attempt = async (work: () => Promise<unknown>) => {
    try {
      await work();
      setProblem(null);
      await reload();
    } catch (e) {
      setProblem(e instanceof ApiError && e.code === 'HOLIDAY_PROVIDER_NOT_CONFIGURED' ? 'No public holiday provider is connected yet. Add holidays by hand for now.' : errorText(e));
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    void attempt(async () => {
      await api('POST', '/api/holidays', { date, name });
      setDate('');
      setName('');
    });
  };
  const sync = () => attempt(async () => {
    const result = await api<{ added: number; updated: number }>('POST', '/api/holiday-syncs', { year });
    toast(`Loaded holidays: ${result.added} added, ${result.updated} updated.`, undefined, 4000);
  });
  const act = async (h: Holiday, action: 'rename' | 'toggle' | 'delete', newName?: string) => {
    if (action === 'delete' && !(await confirm('Delete this holiday?', [], 'Delete'))) return;
    await attempt(() => action === 'rename' ? api('PATCH', `/api/holidays/${h.id}`, { name: newName })
      : action === 'toggle' ? api('PATCH', `/api/holidays/${h.id}`, { hidden: !h.hidden })
        : api('DELETE', `/api/holidays/${h.id}`));
  };

  return (
    <>
      <div className="panel-head">
        <label>Year<input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }} /></label>
        <button type="button" onClick={sync}>Load public holidays</button>
        <span className="spacer" />
        <form className="inline" onSubmit={add}>
          <label>Date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Name<input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="primary">Add holiday</button>
        </form>
      </div>
      {(problem || error) && <p className="form-error">{problem ?? error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>Source</th><th /></tr></thead>
          <tbody>
            {data?.holidays.map((h) => <HolidayRow key={`${h.id}:${h.name}:${h.hidden}`} holiday={h} act={act} />)}
            {data && data.holidays.length === 0 && <tr><td colSpan={4} className="muted">No holidays for this year.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted">Hidden holidays are ignored by planning and stay hidden after a reload from the provider.</p>
    </>
  );
}
```

`src/client/settings/ManagersTab.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useFeedback } from '../feedback';
import type { ManagerGrant } from '../types';
import { errorText, useLoad } from './common';

export function ManagersTab() {
  const { confirm } = useFeedback();
  const { data, error, reload } = useLoad(() => api<{ managers: ManagerGrant[]; note: string }>('GET', '/api/managers'), []);
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function grant(event: FormEvent) {
    event.preventDefault();
    try {
      await api('POST', '/api/managers', { email });
      setEmail('');
      setProblem(null);
      await reload();
    } catch (e) {
      setProblem(errorText(e));
    }
  }

  async function revoke(address: string) {
    if (!(await confirm(`Revoke manager access for ${address}?`, [], 'Revoke'))) return;
    const path = `/api/managers/${encodeURIComponent(address)}`;
    try {
      await api('DELETE', path);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'LAST_MANAGER')) {
        setProblem(errorText(e));
        return;
      }
      // FR-ACC-03 AC3: warn the last listed manager before they remove themselves.
      if (!(await confirm('You are the last listed Planning Manager', [e.message], 'Remove me anyway'))) return;
      await api('DELETE', `${path}?confirm=true`);
    }
    await reload();
  }

  return (
    <>
      {data && <p className="muted">{data.note}</p>}
      <form className="panel-head" onSubmit={grant}>
        <label>Email of someone on the roster<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <button className="primary">Grant manager access</button>
      </form>
      {(problem || error) && <p className="form-error">{problem ?? error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Granted by</th><th>Since</th><th /></tr></thead>
          <tbody>
            {data?.managers.map((m) => (
              <tr key={m.email}>
                <td>{m.email}</td><td>{m.granted_by}</td><td>{m.granted_at.slice(0, 10)}</td>
                <td><button type="button" className="danger" onClick={() => revoke(m.email)}>Revoke</button></td>
              </tr>
            ))}
            {data && data.managers.length === 0 && <tr><td colSpan={4} className="muted">Nobody is listed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

Append to `src/app/globals.css`:

```css
.settings .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--line); }
.settings .tabs a { padding: 8px 12px; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; }
.settings .tabs a[aria-current="page"] { color: var(--text); border-bottom-color: var(--accent); }
.panel-head, .panel-head .inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 12px; }
.panel-head .inline { margin: 0; }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.table-wrap { overflow-x: auto; }
.narrow { max-width: 560px; }
.check { display: flex; gap: 6px; align-items: center; }
fieldset { border: 1px solid var(--line); border-radius: var(--radius); margin: 0 0 12px; }
```

- [ ] **Step 4: Run tests and check every tab by hand**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS.

As an admin dev identity, check each tab:
- **General:** set the country to `MY`, the region to `MY-10` and the time zone to `Asia/Kuala_Lumpur`.
- **Roles:** add, rename, recolour, archive, then restore a role.
- **Employees:** give someone two roles and a default role, then set Mon–Fri `09:00-13:00, 14:00-18:00`. Type `9-5` and check that the error names the day. Then switch to flexible hours.
- **Time off:** record, edit and delete leave. Check that it shows as a hatched band on the schedule.
- **Holidays:** add one by hand, then rename, hide and delete it. Check that "Load public holidays" explains that no provider is connected yet (OI-02).
- **Managers:** grant access to a roster email. With `DEV_USER_ROLE=user` and your own email listed, revoke yourself and check that the warning appears.

- [ ] **Step 5: Commit**

```bash
git add src/client/settings src/app/globals.css
git commit -m "feat: add settings screens for roles, employees, time off, holidays and managers"
```

---

### Task 24: Neon, Vercel deployment, demo data, performance check and acceptance run

**Files:**
- Create: `scripts/seed-demo.ts`, `scripts/time-schedule.sh`, `README.md`
- Modify: `.env.example` (final check)

**Interfaces:**
- Consumes: the whole app.
- Produces:
  - A deployed service on Vercel in region `sin1`, with a Neon database in Singapore.
  - Measurements for NFR-01 and NFR-02.
  - A completed acceptance checklist.

- [ ] **Step 1: Add the demo seed (the NFR-01 data set)**

`scripts/seed-demo.ts`:

```ts
// Loads 50 employees, 3 roles and 300 shifts into the current week, for performance checks and demos.
// Refuses to run without the flag, so it can never be pointed at real data by accident.
// Usage: npm run db:seed-demo -- --yes-this-is-a-demo-database
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { App } from '../src/server/app';
import { loadLocalEnv } from '../src/server/config/env';
import { employeeDirectory, shifts } from '../src/server/db/schema';

if (!process.argv.includes('--yes-this-is-a-demo-database')) {
  console.error('Refusing to run. This inserts demo employees and shifts. Re-run with --yes-this-is-a-demo-database');
  process.exit(1);
}
loadLocalEnv();

const app = new App();
const { db } = app.database();
const org = app.organisationId();
const zone = await app.settings().timezone();
const now = new Date();
const monday = DateTime.now().setZone(zone).startOf('week');

const roleIds: string[] = [];
const existing = await app.roles().all();
for (const [name, color] of [['Technician', '#16A34A'], ['Dispatcher', '#2563EB'], ['Supervisor', '#9333EA']] as const) {
  roleIds.push(existing.find((r) => r.name === name)?.id ?? (await app.roles().create(name, color, now)).id);
}

const day: [string, string][] = [['09:00', '13:00'], ['14:00', '18:00']];
const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] };

for (let i = 1; i <= 50; i++) {
  const ref = `DEMO-${String(i).padStart(2, '0')}`;
  const role = roleIds[i % 3];
  await db.insert(employeeDirectory)
    .values({ organisationId: org, employeeRef: ref, displayName: `Demo Employee ${i}`, departmentId: `DEP-${i % 4}`, departmentName: `Team ${i % 4}`, status: 'Active', fetchedAt: now })
    .onConflictDoUpdate({ target: [employeeDirectory.organisationId, employeeDirectory.employeeRef], set: { fetchedAt: now } });
  await app.profiles().save({ employeeRef: ref, roleIds: [role], defaultRoleId: role, timezone: null, workingHours: hours }, now);
  await db.insert(shifts).values(Array.from({ length: 6 }, (_, d) => {
    const start = monday.plus({ days: d }).set({ hour: d === 5 ? 10 : 9 });
    return {
      id: randomUUID(), organisationId: org, employeeRef: i % 10 === 0 && d === 5 ? null : ref, roleId: role,
      startAt: start.toJSDate(), endAt: start.plus({ hours: 8 }).toJSDate(), breakMinutes: 60,
      state: d < 3 ? 'published' : 'draft', publishedAt: d < 3 ? now : null, createdBy: 'seed', createdAt: now, updatedAt: now,
    };
  }));
}
await app.database().close();
console.log(`Seeded 50 employees and 300 shifts for the week of ${monday.toISODate()}.`);
```

`scripts/time-schedule.sh`:

```bash
#!/usr/bin/env bash
# Times /health and a week of /api/schedule (NFR-01, NFR-02).
# Usage: BASE_URL=https://<app>.vercel.app COOKIE='planning_session=...' scripts/time-schedule.sh
# Copy COOKIE from the browser's devtools after signing in. Locally, leave COOKIE out to use the dev identity.
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
FROM="$(date -d 'monday this week' +%F)"
TO="$(date -d 'sunday this week' +%F)"
curl -sI "$BASE_URL/health" | grep -i x-vercel-id || true
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "health   %{http_code} %{time_total}s\n" "$BASE_URL/health"; done
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "schedule %{http_code} %{time_total}s\n" ${COOKIE:+-H "Cookie: $COOKIE"} "$BASE_URL/api/schedule?from=$FROM&to=$TO"; done
```

Then run:

```bash
chmod +x scripts/time-schedule.sh
npm run db:seed-demo -- --yes-this-is-a-demo-database
npm run dev   # in another terminal
scripts/time-schedule.sh
```

Expected: `/api/schedule` returns 200, and warm runs take well under 500 ms. If it is slower:
- Check in pgAdmin's Query Tool that `EXPLAIN ANALYZE` on the overlapping-shifts query uses the partial index `shifts_live_time_idx`.
- Check that `ScheduleService` runs the same number of queries however many employees there are.

Then open `/schedule` with the devtools Performance panel recording. The board must render in 1.5 s or less after the response arrives (NFR-01).

- [ ] **Step 2: Create the Neon database**

1. Sign in at neon.tech and create a project. Choose the region **AWS Asia Pacific (Singapore)**, `aws-ap-southeast-1`, which is next to Vercel's `sin1`.
2. In *Connection details*, copy the **pooled** connection string (its host contains `-pooler`). It already includes `sslmode=require`.
3. Apply the migrations from your machine, giving the production URL only to this one command:

   ```bash
   DATABASE_URL='postgres://...-pooler...neon.tech/neondb?sslmode=require' npm run db:migrate
   ```

4. Optionally, add the production database to pgAdmin as a second server: *Register → Server*, then fill in the host, database, user and password from Neon. Set *SSL mode* to `require`.

- [ ] **Step 3: Write the README**

`README.md`:

````markdown
# InterlinkERP Planning

Shift planning for the Services department: managers build and publish schedules, employees see their own shifts. Requirements: [ListOfRequirements.md](ListOfRequirements.md). Roadmap: [docs/superpowers/plans/2026-10-13-planning-roadmap.md](docs/superpowers/plans/2026-10-13-planning-roadmap.md).

## Stack
Next.js 16 (App Router) + React 19 + TypeScript, Drizzle ORM, PostgreSQL (local 18, Neon in production), Vercel region `sin1`. Sign-in is only through the InterlinkERP gateway.

## Local development
1. PostgreSQL 18 runs locally. Create the role and databases once:
   `psql -U postgres -h localhost -c "CREATE ROLE planning LOGIN PASSWORD 'planning-dev-only';" -c "CREATE DATABASE planning OWNER planning;" -c "CREATE DATABASE planning_test OWNER planning;"`
2. `cp .env.example .env.local`, then set `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. `npm install`
4. `npm run db:migrate`
5. `npm run dev`, then open http://127.0.0.1:3000. Locally you are the `DEV_USER_*` identity from `.env.local`.

Optional demo data: `npm run db:seed-demo -- --yes-this-is-a-demo-database`. Browse the data with pgAdmin 4.

## Database changes
Edit `src/server/db/schema.ts`, run `npm run db:generate`, read the new SQL in `drizzle/`, then `npm run db:migrate`. Commit the generated files. Never edit a migration that has been applied anywhere.

## Tests
`npm test` runs everything. `npm run test:unit` needs nothing; `npm run test:integration` needs the local `planning_test` database. `npm run typecheck` for types.

## Deploying
1. Neon project in `aws-ap-southeast-1`; apply migrations with its pooled URL (`DATABASE_URL=... npm run db:migrate`).
2. In Vercel, import the repo and set every variable from `.env.example` except `DEV_*`, `TEST_DATABASE_URL` and `APP_ENV`. `DATABASE_URL` is Neon's pooled URL; `PUBLIC_URL` is the exact production URL; `CRON_SECRET` is a long random value.
3. In the gateway console, issue an API client for Planning with `intern:read` and `department:read`, and set `INTERLINK_CLIENT_ID` / `INTERLINK_CLIENT_SECRET`.
4. Turn off Vercel Deployment Protection for Production (or exempt `/health` and `/openapi.json`); the gateway must reach both.
5. Deploy, then register the base URL with the gateway and run its `/conformance` check.

## Version
`/health` and `/openapi.json` report `SERVICE_VERSION` (`src/server/config/serviceInfo.ts`). Change it in the same commit as any API change.
````

- [ ] **Step 4: Deploy and run the acceptance checklist**

Follow the README's deploy steps. Check every item below on the deployed app, and record the results in the PR description.

**Service contract and auth (contract §6, auth guide §9)**
- [ ] `/health` returns 200 with `service: planning-api`. Over five runs, p95 is 300 ms or less warm and every run is under 1 s (NFR-02). `x-vercel-id` shows `sin1` as the function region.
- [ ] `/openapi.json` returns 200. The gateway catalogue shows the "Check Access", "Configure Planning", "Manage Team Profiles", "Track Time Off", "Plan Shifts" and "Share Schedules" capabilities.
- [ ] The gateway's `/conformance` shows **0 failures**.
- [ ] `/api/schedule` with no cookie returns 401 with the envelope. Adding `x-authenticated-user: admin@…` still returns 401.
- [ ] `/nope` returns 404 with the JSON envelope, not HTML.
- [ ] Sign in through the gateway and open `/schedule` in one tab. Sign out at the gateway in a second tab, then refresh the first tab: it goes straight to gateway sign-in (auth guide §5). Pressing Back does not show the page from the browser cache (§7).
- [ ] The app has no sign-out button anywhere.

**Performance (NFR-01)**
- [ ] With the demo seed loaded into a Neon branch (not production), `scripts/time-schedule.sh` gives `/api/schedule` p95 of 500 ms or less warm, and the board renders in 1.5 s or less.

**Functional spot checks against the spec's acceptance criteria**
- [ ] FR-ACC-02 AC1: an employee lands on My Planning and sees no Schedule or Settings.
- [ ] FR-ACC-03 AC1–AC3: an admin can grant access; a revoked person becomes an employee on their next request; the last listed manager is warned.
- [ ] FR-SCH-01 AC1–AC2 and FR-SCH-06 AC1: everyone gets a row, grouping by role works, and the draft filter keeps every row.
- [ ] FR-SHF-01 AC1–AC2, FR-SHF-03 AC1, FR-SHF-04 AC1, FR-SHF-07 AC1 and FR-SHF-09 AC1: as in Task 21 Step 5.
- [ ] FR-PUB-01 AC1: publishing writes one `schedule_published` outbox row per employee. Check in pgAdmin. Delivery comes in M2.
- [ ] FR-CFG-02 AC1: a never-configured employee shows as Flexible, with no roles.
- [ ] FR-CFG-04 AC2 is covered by `holidays.int.test.ts`. AC1 waits for OI-02.
- [ ] FR-MYP-02 and NFR-08: My Planning works at 360px, and the schedule at 1024px.

- [ ] **Step 5: Final run and commit**

```bash
npm run typecheck && npm test && npm run build
git add scripts README.md .env.example
git commit -m "docs: add README, Neon setup, demo seed and timing script"
```

Then use superpowers:finishing-a-development-branch to open the PR for `feature/m1-foundation`. Put the checklist results in its description, with no Claude attribution lines.
