# Planning M1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first deployable version of InterlinkERP Planning: gateway sign-in, manager/employee access, roles, employee planning profiles, time off and holidays, a shift schedule with conflict warnings, publishing, and an employee "My Planning" view.

**Architecture:** A native PHP 8.3 JSON API (no framework) with one front controller, a small router, and a guard that enforces the InterlinkERP gateway session on every request. Business rules (allocation, conflicts) live in pure PHP domain classes that never touch the database or HTTP. MySQL holds Planning's own data; employee names and photos come from intern-database through the gateway and are cached for at most 24 hours. The UI is a Vite + TypeScript single-page app with no UI framework, served behind a PHP page gate that runs the gateway sign-in flow.

**Tech Stack:** PHP 8.3+ (PDO MySQL, cURL, OpenSSL), MySQL 8.0.19+, PHPUnit 11, Vite 6, TypeScript 5.7, Vitest 3 + jsdom, Vercel (`vercel-php@0.9.0`, region `sin1`), Docker (local MySQL only).

**Spec:** [ListOfRequirements.md](../../../ListOfRequirements.md) (v0.2). Roadmap: [2026-10-13-planning-roadmap.md](2026-10-13-planning-roadmap.md).

**Reference code:** the sibling repo `../hr-recruitment-demo` already talks to the same gateway. Tasks 5–8 port its `backend/support/Jwt.php`, `Gateway.php`, `Session.php` and `backend/services/RosterService.php`, and its `API_Template/*.md` files are the service contract this plan cites as "contract SS-n" and "auth guide §n". Read them when a task points at them. Do not copy anything else from that repo.

## Global Constraints

- **Naming:** the ERP is **InterlinkERP**. The repo must never contain the ERP's former brand name, in code, comments, docs, identifiers, cookie names or environment variable names. The gateway reads catalogue metadata from an OpenAPI extension key whose name contains that former brand; Planning reads the key name from the `OPENAPI_EXTENSION_KEY` environment variable and never spells it in source.
- **Commits:** conventional types (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). No Claude attribution lines (no `Co-Authored-By`, no "Generated with Claude Code"). Work on branch `feature/m1-foundation`.
- **PHP:** `declare(strict_types=1);` in every PHP file. Target PHP 8.3 language features. No runtime Composer dependencies; Composer is used only for PHPUnit. Production autoloading is `backend/bootstrap.php`.
- **Database:** MySQL 8.0.19 or later, `utf8mb4` / `utf8mb4_unicode_ci`, every `DATETIME` column stores UTC, every connection runs `SET time_zone = '+00:00'`. Parameterised SQL only. Every table has `organisation_id` and every query filters on it (DR-05, NFR-10).
- **API shape (contract SS-4, SS-5, SS-9–12):** JSON only. Every response carries `X-Correlation-ID` (reused from the request when valid, minted otherwise). Every non-2xx body is exactly `{"error":{"code","message","correlation_id","details"}}`. Reserved codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `RESOURCE_NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405, `CONFLICT` 409, `VALIDATION_ERROR` 422, `INTERNAL_ERROR` 500. POST → 201, GET/PATCH → 200, DELETE → 204 with empty body. `DELETE` on a missing id is 404. Plural nouns, no verbs in paths. Error messages never contain SQL, stack traces, file paths or secrets.
- **Times on the wire:** instants are ISO 8601 UTC strings `YYYY-MM-DDTHH:MM:SSZ` in responses. Inputs must carry an explicit offset (`Z` or `+08:00`); inputs without one are rejected with 422. Calendar dates are `YYYY-MM-DD`. Shifts are stored to the minute.
- **Auth (contract SS-6, SS-8, SS-24, SS-25; auth guide §3–§8):** public paths are only `/health` and `/openapi.json`. No login screen, no logout button, no password storage. Identity comes only from a verified gateway token signature. The gateway session is checked on every authenticated request with no cache, failing open only on network/server errors. Session cookie is HMAC-signed, `HttpOnly`, `SameSite=Lax`, 15-minute TTL. Every page response and auth redirect sends `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`. `GATEWAY_URL` and `PUBLIC_URL` come from the environment, never from the request.
- **Who is a manager (BR-12):** gateway `role` = `admin`, or the person's gateway-verified email is in `planning_managers`. A missing or unknown role never grants manager access. (Task 6 amends the spec to say "email" instead of `sub`; see the note there.)
- **Service identity:** `/health` returns `service` from `SERVICE_ID` (use `planning-api`) and `version` from `ServiceInfo::VERSION` (`0.1.0`). Bump `VERSION` in the same commit as any API change (NFR-09): patch for fixes, minor for additions, major for breaking changes.
- **Environment variables:** `APP_ENV`, `SERVICE_ID`, `OPENAPI_EXTENSION_KEY`, `ORGANISATION_ID` (default `default`), `DEFAULT_TIMEZONE` (default `UTC`), `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `GATEWAY_URL`, `PUBLIC_URL`, `SESSION_SECRET` (≥ 32 characters), `INTERLINK_CLIENT_ID`, `INTERLINK_CLIENT_SECRET`, `INTERN_DATABASE_URL`, `DEPARTMENT_API_URL`, `CRON_SECRET`, and for local development only `DEV_USER_EMAIL`, `DEV_USER_NAME`, `DEV_USER_ROLE`, `DEV_EMPLOYEE_REF`.
- **Decisions this plan makes that the spec leaves open (all OWN):**
  - A shift lasts at most 7 days.
  - The server keeps a deleted shift restorable for 30 seconds (the UI offers undo for 10).
  - Duplicating a shift places the copy one day later unless a start time is given.
  - The schedule and My Planning accept ranges of at most 62 days.
  - Plannable roster statuses are `Onboarding`, `Active` and `Offboarding`.
  - The employee directory cache is refreshed daily by cron, and immediately when empty (with a 5-minute back-off after a failure).
  - Shift edits use optimistic concurrency through a `version` field.
- **Local ports:** PHP dev server `127.0.0.1:8000`, Vite `127.0.0.1:5173`, test MySQL `127.0.0.1:3307`.

## Review Focus

These are the five things a real user is most likely to hit that the spec's acceptance criteria do not spell out. Each has a test in the task named in brackets.

1. **Two managers edit the same shift at once.** The second save must be refused with `409 STALE_SHIFT`, not silently overwrite the first [Task 15].
2. **The roster or department service is down while the schedule loads.** The schedule still loads from Planning's own data and shows placeholders; it never fails or hangs (NFR-06) [Task 17].
3. **An employee leaves the roster but still has shifts.** Their shifts stay visible under an "Unknown employee" row instead of disappearing [Task 17].
4. **Bad time input:** a time without an offset, an impossible date such as 30 February, an end before the start, or a break as long as the shift. Each must give `422` with the field named, never a 500 [Task 15].
5. **The Planning session expires or the gateway session ends while a page is open.** The next API call returns 401 and the UI reloads into the sign-in flow instead of showing broken screens [Task 19].

---

## File Structure

```
.env.example                      Every variable, with safe local defaults
.gitignore / .vercelignore
composer.json / phpunit.xml       PHPUnit only (dev)
docker-compose.yml                Local MySQL 8.4 for dev and tests
package.json / tsconfig.json / vite.config.ts / vitest.config.ts
vercel.json                       Rewrites, sin1 region, daily cron
router.php                        `php -S` router for local development
api/index.php                     Vercel entry: JSON API
api/app.php                       Vercel entry: page gate (HTML shell)
bin/migrate.php                   Applies backend/migrations/*.sql
bin/seed-demo.php                 Loads 50 employees + 300 shifts for NFR-01 timing
scripts/rename-shell.mjs          dist/index.html -> dist/app-shell.html after build
backend/
  bootstrap.php                   PSR-4 autoloader for Planning\ (production)
  migrations/001_initial.sql      All M1 tables
  src/
    App.php                       Lazily builds and caches every service
    routes.php                    Every route + its OpenAPI discovery metadata
    catalog.php                   Service-level catalogue metadata (contract SS-27)
    Config/   Env, ConfigError, ServiceInfo
    Support/  Uuid, Clock, SystemClock, Time, HttpClient, HttpResult, CurlHttpClient, RequestContext
    Http/     Request, Response, HttpError, Route, Router, Kernel, AccessGuard, AccessResult,
              PublicOnlyGuard, Input, Doc, OpenApiDocument
    Http/Controllers/  Health, OpenApi, Me, Role, Settings, Employee, Unavailability, Holiday,
              Manager, Shift, Schedule, Publication, MyShift, Cron
    Auth/     Principal, TokenVerifier, TokenInvalid, JwksSource, HttpJwksSource, Gateway,
              SessionLiveness, Liveness, SessionCodec, SessionData, ManagerDirectory,
              GatewayAccessGuard, DevIdentity
    Db/       Database, Migrator
    Roster/   Roster, RosterPerson, RosterUnavailable, UnconfiguredRoster, InternDatabaseRoster,
              DepartmentNames, DepartmentApi, ClientCredentials, DirectoryRefresher
    Holidays/ HolidayProvider, NullHolidayProvider
    Domain/   Interval, WorkingHours, LocalDays, ShiftFacts, Allocation, Conflict,
              UnavailableSpan, ConflictDetector        (pure: no DB, no HTTP)
    Repo/     RoleRepository, SettingsRepository, ProfileRepository, DirectoryRepository,
              UnavailabilityRepository, HolidayRepository, ManagerRepository,
              ShiftRecord, ShiftRepository, Outbox
    Scheduling/ ConflictContext, ShiftService, ScheduleService, PublishService
    Web/      PageGate
  tests/
    fixtures/test-rsa-private.pem
    Support/  FixedClock, FakeHttpClient, TestTokens, TestGuard, FakeRoster, FakeDepartments,
              FakeHolidayProvider, DatabaseTestCase, ApiTestCase
    Unit/...  Integration/...     Mirrors src/
frontend/
  index.html
  src/
    main.ts  api.ts  types.ts  router.ts  dom.ts  toast.ts  styles.css
    schedule/  period.ts tz.ts layout.ts rows.ts drag.ts scheduleView.ts shiftDialog.ts interactions.ts
    my/        myPlanning.ts
    settings/  settingsView.ts generalTab.ts rolesTab.ts employeesTab.ts timeOffTab.ts
               holidaysTab.ts managersTab.ts workingHoursInput.ts
  tests/ (*.test.ts beside the modules they test)
```

**Boundaries.** `Domain/` knows nothing about storage or HTTP and is where BR-01 and BR-04 live. `Repo/` is the only code that writes SQL. `Scheduling/` combines repos and domain rules into use cases. Controllers only parse input, call one service or repo, and shape the JSON. `App` is the only place objects are wired together, and tests replace pieces through `App::override()`.

---

### Task 1: Project scaffold and configuration

**Files:**
- Create: `composer.json`, `phpunit.xml`, `docker-compose.yml`, `.env.example`, `.gitignore`, `backend/bootstrap.php`
- Create: `backend/src/Config/Env.php`, `backend/src/Config/ConfigError.php`
- Test: `backend/tests/Unit/Config/EnvTest.php`

**Interfaces:**
- Produces: `Planning\Config\Env::loadFile(string $path): void`, `Env::get(string $key, ?string $default = null): ?string`, `Env::require(string $key): string`, `Env::requireAll(list<string> $keys): void`; `Planning\Config\ConfigError extends \RuntimeException`.

- [ ] **Step 1: Create the branch**

Start from an up-to-date `main` that contains this plan.

```bash
git checkout main && git pull && git checkout -b feature/m1-foundation
```

- [ ] **Step 2: Add Composer, PHPUnit, Docker and ignore files**

`composer.json`:

```json
{
  "name": "interlinkerp/planning",
  "description": "InterlinkERP Planning service",
  "type": "project",
  "license": "proprietary",
  "require": {
    "php": ">=8.3",
    "ext-curl": "*",
    "ext-json": "*",
    "ext-openssl": "*",
    "ext-pdo": "*"
  },
  "require-dev": {
    "phpunit/phpunit": "^11.5"
  },
  "autoload": {
    "psr-4": { "Planning\\": "backend/src/" }
  },
  "autoload-dev": {
    "psr-4": { "Planning\\Tests\\": "backend/tests/" }
  },
  "config": { "sort-packages": true }
}
```

`phpunit.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         failOnWarning="true"
         failOnRisky="true"
         cacheDirectory=".phpunit.cache">
  <testsuites>
    <testsuite name="unit">
      <directory>backend/tests/Unit</directory>
    </testsuite>
    <testsuite name="integration">
      <directory>backend/tests/Integration</directory>
    </testsuite>
  </testsuites>
  <php>
    <env name="TEST_DB_HOST" value="127.0.0.1"/>
    <env name="TEST_DB_PORT" value="3307"/>
    <env name="TEST_DB_NAME" value="planning_test"/>
    <env name="TEST_DB_USER" value="root"/>
    <env name="TEST_DB_PASSWORD" value="planning"/>
  </php>
</phpunit>
```

`docker-compose.yml`:

```yaml
services:
  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: planning
      MYSQL_DATABASE: planning
    ports:
      - "3307:3306"
    command: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-pplanning"]
      interval: 5s
      retries: 20
```

`.gitignore`:

```
/vendor/
/node_modules/
/dist/
/.phpunit.cache/
.env
```

`.env.example`:

```
# Copy to .env for local development. Real deployments set these as
# environment variables; .env never overrides a real variable.
APP_ENV=development
SERVICE_ID=planning-api
# The OpenAPI extension key the InterlinkERP gateway reads catalogue metadata
# from. Ask the gateway admins for the exact value.
OPENAPI_EXTENSION_KEY=
ORGANISATION_ID=default
DEFAULT_TIMEZONE=Asia/Kuala_Lumpur

DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=planning
DB_USER=root
DB_PASSWORD=planning

GATEWAY_URL=https://web-omega-two-47.vercel.app
PUBLIC_URL=http://127.0.0.1:8000
# At least 32 random characters. Generate: php -r "echo bin2hex(random_bytes(32));"
SESSION_SECRET=

# API client issued in the gateway console (Access & roles -> API clients),
# granted intern:read and department:read.
INTERLINK_CLIENT_ID=
INTERLINK_CLIENT_SECRET=
INTERN_DATABASE_URL=https://intern-database.vercel.app
DEPARTMENT_API_URL=https://department-zeta.vercel.app

# Vercel sends "Authorization: Bearer $CRON_SECRET" to cron paths.
CRON_SECRET=

# Local development identity (only used when APP_ENV=development, not on
# Vercel, and only for requests from 127.0.0.1 with no proxy headers).
DEV_USER_EMAIL=dev@example.com
DEV_USER_NAME=Local Developer
DEV_USER_ROLE=admin
DEV_EMPLOYEE_REF=
```

- [ ] **Step 3: Add the production autoloader**

`backend/bootstrap.php`:

```php
<?php

declare(strict_types=1);

// Production autoloader for Planning\ classes. Composer is only used for
// PHPUnit in development, so deployed code must not depend on vendor/.
spl_autoload_register(static function (string $class): void {
    $prefix = 'Planning\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = __DIR__ . '/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
```

- [ ] **Step 4: Install PHPUnit and start MySQL**

```bash
composer install
docker compose up -d mysql
```

Expected: `vendor/` exists; `docker compose ps` shows `mysql` as `healthy` within about 30 seconds.

- [ ] **Step 5: Write the failing test**

`backend/tests/Unit/Config/EnvTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Config;

use PHPUnit\Framework\TestCase;
use Planning\Config\ConfigError;
use Planning\Config\Env;

final class EnvTest extends TestCase
{
    protected function tearDown(): void
    {
        putenv('PLANNING_TEST_A');
        putenv('PLANNING_TEST_B');
    }

    public function test_require_names_the_missing_variable(): void
    {
        $this->expectException(ConfigError::class);
        $this->expectExceptionMessage('Missing required environment variable PLANNING_TEST_A.');
        Env::require('PLANNING_TEST_A');
    }

    public function test_requireAll_lists_every_missing_variable(): void
    {
        putenv('PLANNING_TEST_A=x');
        try {
            Env::requireAll(['PLANNING_TEST_A', 'PLANNING_TEST_B']);
            $this->fail('Expected ConfigError');
        } catch (ConfigError $e) {
            $this->assertSame('Missing required environment variables: PLANNING_TEST_B.', $e->getMessage());
        }
    }

    public function test_empty_value_counts_as_missing(): void
    {
        putenv('PLANNING_TEST_A=');
        $this->assertNull(Env::get('PLANNING_TEST_A'));
        $this->assertSame('fallback', Env::get('PLANNING_TEST_A', 'fallback'));
    }

    public function test_loadFile_never_overrides_a_real_variable(): void
    {
        putenv('PLANNING_TEST_A=real');
        $file = tempnam(sys_get_temp_dir(), 'env');
        file_put_contents($file, "# comment\nPLANNING_TEST_A=from-file\nPLANNING_TEST_B=\"quoted value\"\n");

        Env::loadFile($file);
        unlink($file);

        $this->assertSame('real', Env::get('PLANNING_TEST_A'));
        $this->assertSame('quoted value', Env::get('PLANNING_TEST_B'));
    }
}
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `php vendor/bin/phpunit --filter EnvTest`
Expected: FAIL with `Class "Planning\Config\Env" not found`.

- [ ] **Step 7: Implement `Env` and `ConfigError`**

`backend/src/Config/ConfigError.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Config;

/** A required setting is missing or invalid. Raised before any request is served. */
final class ConfigError extends \RuntimeException
{
}
```

`backend/src/Config/Env.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Config;

/**
 * Configuration comes from the environment only (contract SS-20). A local
 * .env file is a development convenience and never overrides a real
 * environment variable. An empty value counts as missing.
 */
final class Env
{
    public static function loadFile(string $path): void
    {
        if (!is_file($path)) {
            return;
        }
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = array_map('trim', explode('=', $line, 2));
            if (preg_match('/^(["\'])(.*)\1$/', $value, $m)) {
                $value = $m[2];
            }
            if (getenv($key) === false) {
                putenv("$key=$value");
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $value = getenv($key);
        return ($value === false || $value === '') ? $default : $value;
    }

    public static function require(string $key): string
    {
        $value = self::get($key);
        if ($value === null) {
            throw new ConfigError("Missing required environment variable $key.");
        }
        return $value;
    }

    /** @param list<string> $keys */
    public static function requireAll(array $keys): void
    {
        $missing = array_values(array_filter($keys, static fn (string $k): bool => self::get($k) === null));
        if ($missing !== []) {
            throw new ConfigError('Missing required environment variables: ' . implode(', ', $missing) . '.');
        }
    }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `php vendor/bin/phpunit --filter EnvTest`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add composer.json composer.lock phpunit.xml docker-compose.yml .env.example .gitignore backend/bootstrap.php backend/src/Config backend/tests/Unit/Config
git commit -m "chore: scaffold PHP project with environment configuration"
```

---

### Task 2: HTTP kernel, routing and the error envelope

**Files:**
- Create: `backend/src/Support/Uuid.php`, `backend/src/Support/RequestContext.php`
- Create: `backend/src/Http/Request.php`, `Response.php`, `HttpError.php`, `Route.php`, `Router.php`, `AccessGuard.php`, `AccessResult.php`, `Kernel.php`
- Create: `backend/src/Auth/Principal.php`
- Test: `backend/tests/Unit/Http/RouterTest.php`, `backend/tests/Unit/Http/KernelTest.php`, `backend/tests/Unit/Http/RequestTest.php`

**Interfaces:**
- Produces:
  - `Request(string $method, string $path, array $query = [], array $headers = [], string $body = '', array $cookies = [], array $server = [])`, `Request::fromGlobals()`, `->header(string): ?string`, `->queryString(string): ?string`, `->json(): array<string,mixed>`.
  - `Response::json(int, array)`, `::rawJson(int, string)`, `::html(int, string)`, `::redirect(string)`, `::noContent()`, `->withHeader(string, string)`, `->withCookie(string $setCookieValue)`, `->withNoStore()`, `->decoded(): ?array`, `->send()`; public readonly `status`, `body`, `headers`, `cookies`.
  - `HttpError(int $status, string $errorCode, string $message, mixed $details = null, array $headers = [])` with `::unauthorized()`, `::forbidden(string $message, string $code = 'FORBIDDEN', mixed $details = null)`, `::notFound()`, `::conflict(string $code, string $message, mixed $details = null)`, `::validation(array<string,string> $fields)`.
  - `Route` constants `PUBLIC`, `INTERNAL`, `PERSON`, `MANAGER`; `->match(string $path): ?array<string,string>`, `->scope(): ?string`.
  - `Router->add(string $method, string $path, string $access, string $summary, \Closure $handler, array $doc = [])`, `->match(string $method, string $path): array{0: Route, 1: array<string,string>}`, `->routes(): list<Route>`.
  - `AccessGuard::check(Route $route, Request $request): AccessResult`; `AccessResult(?Principal $principal, list<string> $cookies = [])`.
  - `Kernel(Router, AccessGuard, \Closure $logger)`, `->handle(Request): Response`, `Kernel::envelope(string $code, string $message, string $cid, mixed $details): array`.
  - `Principal(string $kind, string $subject, ?string $email = null, ?string $name = null, ?string $gatewayRole = null, ?string $employeeRef = null, bool $isManager = false, list<string> $scopes = [])`, `->isPerson(): bool`, `->actorId(): string`.
  - Route handlers are `\Closure(Request $request, array $params, ?Principal $principal): Response`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/Unit/Http/RouterTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Http;

use PHPUnit\Framework\TestCase;
use Planning\Http\HttpError;
use Planning\Http\Response;
use Planning\Http\Route;
use Planning\Http\Router;

final class RouterTest extends TestCase
{
    private Router $router;

    protected function setUp(): void
    {
        $this->router = new Router();
        $ok = static fn (): Response => Response::json(200, []);
        $this->router->add('GET', '/api/shifts', Route::MANAGER, 'List', $ok);
        $this->router->add('GET', '/api/shifts/{id}', Route::MANAGER, 'Show', $ok);
        $this->router->add('PATCH', '/api/shifts/{id}', Route::MANAGER, 'Update', $ok);
    }

    public function test_matches_a_path_parameter(): void
    {
        [$route, $params] = $this->router->match('PATCH', '/api/shifts/abc-123');
        $this->assertSame('/api/shifts/{id}', $route->path);
        $this->assertSame(['id' => 'abc-123'], $params);
    }

    public function test_unknown_path_is_404(): void
    {
        try {
            $this->router->match('GET', '/api/nothing');
            $this->fail('Expected HttpError');
        } catch (HttpError $e) {
            $this->assertSame(404, $e->status);
            $this->assertSame('RESOURCE_NOT_FOUND', $e->errorCode);
        }
    }

    public function test_wrong_method_on_known_path_is_405_with_allow_header(): void
    {
        try {
            $this->router->match('DELETE', '/api/shifts/abc');
            $this->fail('Expected HttpError');
        } catch (HttpError $e) {
            $this->assertSame(405, $e->status);
            $this->assertSame('METHOD_NOT_ALLOWED', $e->errorCode);
            $this->assertSame('GET, PATCH', $e->headers['Allow']);
        }
    }

    public function test_scope_follows_method_and_public_routes_have_none(): void
    {
        $this->router->add('GET', '/health', Route::PUBLIC, 'Health', static fn () => Response::noContent());
        $scopes = array_map(static fn (Route $r): ?string => $r->scope(), $this->router->routes());
        $this->assertSame(['planning:read', 'planning:read', 'planning:write', null], $scopes);
    }
}
```

`backend/tests/Unit/Http/RequestTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Http;

use PHPUnit\Framework\TestCase;
use Planning\Http\HttpError;
use Planning\Http\Request;

final class RequestTest extends TestCase
{
    public function test_empty_body_is_an_empty_object(): void
    {
        $this->assertSame([], (new Request('POST', '/x'))->json());
    }

    public function test_invalid_json_is_a_422_naming_the_body(): void
    {
        try {
            (new Request('POST', '/x', body: '{nope'))->json();
            $this->fail('Expected HttpError');
        } catch (HttpError $e) {
            $this->assertSame(422, $e->status);
            $this->assertSame(['body' => 'Request body is not valid JSON.'], $e->details);
        }
    }

    public function test_a_json_array_is_rejected(): void
    {
        $this->expectException(HttpError::class);
        (new Request('POST', '/x', body: '[1,2]'))->json();
    }

    public function test_headers_are_case_insensitive(): void
    {
        $request = new Request('GET', '/x', headers: ['x-correlation-id' => 'abc']);
        $this->assertSame('abc', $request->header('X-Correlation-ID'));
    }
}
```

`backend/tests/Unit/Http/KernelTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Http;

use PHPUnit\Framework\TestCase;
use Planning\Auth\Principal;
use Planning\Http\AccessGuard;
use Planning\Http\AccessResult;
use Planning\Http\HttpError;
use Planning\Http\Kernel;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Http\Route;
use Planning\Http\Router;

final class KernelTest extends TestCase
{
    /** @var list<string> */
    private array $logged = [];

    private function kernel(Router $router, ?AccessGuard $guard = null): Kernel
    {
        $guard ??= new class implements AccessGuard {
            public function check(Route $route, Request $request): AccessResult
            {
                return new AccessResult(null);
            }
        };
        return new Kernel($router, $guard, function (string $line): void {
            $this->logged[] = $line;
        });
    }

    public function test_reuses_a_valid_correlation_id(): void
    {
        $router = new Router();
        $router->add('GET', '/ok', Route::PUBLIC, 'Ok', static fn () => Response::json(200, ['ok' => true]));

        $response = $this->kernel($router)->handle(new Request('GET', '/ok', headers: ['x-correlation-id' => 'trace-42']));

        $this->assertSame('trace-42', $response->headers['X-Correlation-ID']);
    }

    public function test_mints_a_correlation_id_when_the_supplied_one_is_unsafe(): void
    {
        $response = $this->kernel(new Router())->handle(new Request('GET', '/x', headers: ['x-correlation-id' => "bad\nvalue"]));
        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $response->headers['X-Correlation-ID']);
    }

    public function test_unrouted_path_returns_the_envelope(): void
    {
        $response = $this->kernel(new Router())->handle(new Request('GET', '/nope'));

        $this->assertSame(404, $response->status);
        $body = $response->decoded();
        $this->assertSame('RESOURCE_NOT_FOUND', $body['error']['code']);
        $this->assertSame($response->headers['X-Correlation-ID'], $body['error']['correlation_id']);
        $this->assertArrayHasKey('details', $body['error']);
    }

    public function test_unexpected_exception_is_a_generic_500_and_is_logged(): void
    {
        $router = new Router();
        $router->add('GET', '/boom', Route::PUBLIC, 'Boom', static function (): Response {
            throw new \RuntimeException('SQLSTATE[42S02] secret table missing');
        });

        $response = $this->kernel($router)->handle(new Request('GET', '/boom'));

        $this->assertSame(500, $response->status);
        $this->assertSame('INTERNAL_ERROR', $response->decoded()['error']['code']);
        $this->assertStringNotContainsString('SQLSTATE', (string) $response->body);
        $this->assertStringContainsString('SQLSTATE', $this->logged[0]);
    }

    public function test_guard_cookies_and_principal_reach_the_handler(): void
    {
        $router = new Router();
        $router->add('GET', '/me', Route::PERSON, 'Me', static fn (Request $r, array $p, ?Principal $u): Response => Response::json(200, ['who' => $u?->email]));
        $guard = new class implements AccessGuard {
            public function check(Route $route, Request $request): AccessResult
            {
                return new AccessResult(new Principal('person', 'sub-1', 'ana@example.com'), ['planning_session=abc; Path=/']);
            }
        };

        $response = $this->kernel($router, $guard)->handle(new Request('GET', '/me'));

        $this->assertSame(['who' => 'ana@example.com'], $response->decoded());
        $this->assertSame(['planning_session=abc; Path=/'], $response->cookies);
    }

    public function test_http_error_headers_are_kept(): void
    {
        $router = new Router();
        $router->add('GET', '/x', Route::PUBLIC, 'X', static function (): Response {
            throw new HttpError(401, 'UNAUTHORIZED', 'Signed out.', null, ['Set-Cookie' => 'planning_session=; Max-Age=0']);
        });

        $response = $this->kernel($router)->handle(new Request('GET', '/x'));

        $this->assertSame('planning_session=; Max-Age=0', $response->headers['Set-Cookie']);
    }
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `php vendor/bin/phpunit --filter "RouterTest|RequestTest|KernelTest"`
Expected: FAIL with class-not-found errors.

- [ ] **Step 3: Implement the support classes and `Principal`**

`backend/src/Support/Uuid.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

final class Uuid
{
    public static function v4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
```

`backend/src/Support/RequestContext.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

/** Per-request values that outbound HTTP calls forward (contract SS-4). */
final class RequestContext
{
    public static ?string $correlationId = null;
}
```

`backend/src/Auth/Principal.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

/** Who is making a request: a signed-in person, or a program with an access token. */
final class Principal
{
    /** @param list<string> $scopes */
    public function __construct(
        public readonly string $kind,
        public readonly string $subject,
        public readonly ?string $email = null,
        public readonly ?string $name = null,
        public readonly ?string $gatewayRole = null,
        public readonly ?string $employeeRef = null,
        public readonly bool $isManager = false,
        public readonly array $scopes = [],
    ) {
    }

    public function isPerson(): bool
    {
        return $this->kind === 'person';
    }

    /** The value stored in created_by / granted_by columns. */
    public function actorId(): string
    {
        return $this->isPerson() ? ($this->email ?? $this->subject) : 'client:' . $this->subject;
    }
}
```

- [ ] **Step 4: Implement `Request`, `Response` and `HttpError`**

`backend/src/Http/Request.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

final class Request
{
    /**
     * @param array<string,string> $query
     * @param array<string,string> $headers lower-case names
     * @param array<string,string> $cookies
     * @param array<string,mixed> $server
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query = [],
        public readonly array $headers = [],
        public readonly string $body = '',
        public readonly array $cookies = [],
        public readonly array $server = [],
    ) {
    }

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($key) && str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        $path = rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));
        $path = rtrim($path, '/');

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $path === '' ? '/' : $path,
            self::scalars($_GET),
            $headers,
            (string) file_get_contents('php://input'),
            self::scalars($_COOKIE),
            $_SERVER,
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function queryString(string $name): ?string
    {
        $value = $this->query[$name] ?? null;
        return ($value === null || $value === '') ? null : $value;
    }

    /** @return array<string,mixed> */
    public function json(): array
    {
        if (trim($this->body) === '') {
            return [];
        }
        try {
            $data = json_decode($this->body, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw HttpError::validation(['body' => 'Request body is not valid JSON.']);
        }
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw HttpError::validation(['body' => 'Request body must be a JSON object.']);
        }
        return $data;
    }

    /**
     * @param array<mixed> $values
     * @return array<string,string>
     */
    private static function scalars(array $values): array
    {
        $out = [];
        foreach ($values as $key => $value) {
            if (is_scalar($value)) {
                $out[(string) $key] = (string) $value;
            }
        }
        return $out;
    }
}
```

`backend/src/Http/Response.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

final class Response
{
    /**
     * @param array<string,string> $headers
     * @param list<string> $cookies Set-Cookie values, one per cookie
     */
    private function __construct(
        public readonly int $status,
        public readonly ?string $body,
        public readonly array $headers = [],
        public readonly array $cookies = [],
    ) {
    }

    /** @param array<mixed> $data */
    public static function json(int $status, array $data): self
    {
        return self::rawJson($status, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    public static function rawJson(int $status, string $json): self
    {
        return new self($status, $json, ['Content-Type' => 'application/json; charset=utf-8']);
    }

    public static function html(int $status, string $html): self
    {
        return new self($status, $html, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public static function redirect(string $location): self
    {
        return new self(302, null, ['Location' => $location]);
    }

    public static function noContent(): self
    {
        return new self(204, null);
    }

    public function withHeader(string $name, string $value): self
    {
        return new self($this->status, $this->body, [...$this->headers, $name => $value], $this->cookies);
    }

    public function withCookie(string $setCookie): self
    {
        return new self($this->status, $this->body, $this->headers, [...$this->cookies, $setCookie]);
    }

    /** Auth guide §7: browsers must never serve an authenticated page from cache. */
    public function withNoStore(): self
    {
        return $this
            ->withHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            ->withHeader('Pragma', 'no-cache')
            ->withHeader('Expires', '0');
    }

    /** @return array<mixed>|null */
    public function decoded(): ?array
    {
        return $this->body === null ? null : json_decode($this->body, true);
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header("$name: $value");
        }
        foreach ($this->cookies as $cookie) {
            header('Set-Cookie: ' . $cookie, false);
        }
        if ($this->body !== null) {
            echo $this->body;
        }
    }
}
```

`backend/src/Http/HttpError.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

/** An expected failure that becomes a non-2xx response with the error envelope. */
final class HttpError extends \RuntimeException
{
    /** @param array<string,string> $headers */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly mixed $details = null,
        public readonly array $headers = [],
    ) {
        parent::__construct($message);
    }

    public static function unauthorized(string $message): self
    {
        return new self(401, 'UNAUTHORIZED', $message);
    }

    public static function forbidden(string $message, string $code = 'FORBIDDEN', mixed $details = null): self
    {
        return new self(403, $code, $message, $details);
    }

    public static function notFound(string $message): self
    {
        return new self(404, 'RESOURCE_NOT_FOUND', $message);
    }

    public static function conflict(string $code, string $message, mixed $details = null): self
    {
        return new self(409, $code, $message, $details);
    }

    /** @param array<string,string> $fields field name => what is wrong */
    public static function validation(array $fields): self
    {
        return new self(422, 'VALIDATION_ERROR', 'The request has invalid fields.', $fields);
    }
}
```

- [ ] **Step 5: Implement routing and the guard contract**

`backend/src/Http/Route.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

final class Route
{
    /** No authentication; listed in OpenAPI. Only /health and /openapi.json (contract SS-8). */
    public const PUBLIC = 'public';
    /** Not in OpenAPI; the handler checks its own secret (cron). */
    public const INTERNAL = 'internal';
    /** Any signed-in person. Programs with access tokens are refused. */
    public const PERSON = 'person';
    /** Planning Managers (BR-12), or programs holding the route's scope. */
    public const MANAGER = 'manager';

    /** @param array<string,mixed> $doc endpoint discovery metadata (contract SS-27) */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly string $access,
        public readonly string $summary,
        public readonly \Closure $handler,
        public readonly array $doc = [],
    ) {
    }

    /** @return array<string,string>|null path parameters, or null when the path does not match */
    public function match(string $path): ?array
    {
        $pattern = array_values(array_filter(explode('/', $this->path), static fn (string $s): bool => $s !== ''));
        $parts = array_values(array_filter(explode('/', $path), static fn (string $s): bool => $s !== ''));
        if (count($pattern) !== count($parts)) {
            return null;
        }
        $params = [];
        foreach ($pattern as $i => $segment) {
            if (preg_match('/^\{([a-z_]+)\}$/', $segment, $m)) {
                $params[$m[1]] = $parts[$i];
                continue;
            }
            if ($segment !== $parts[$i]) {
                return null;
            }
        }
        return $params;
    }

    /** Scope a program's access token must hold (contract SS-7). */
    public function scope(): ?string
    {
        if ($this->access === self::PUBLIC || $this->access === self::INTERNAL) {
            return null;
        }
        return $this->method === 'GET' ? 'planning:read' : 'planning:write';
    }
}
```

`backend/src/Http/Router.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

final class Router
{
    /** @var list<Route> */
    private array $routes = [];

    /** @param array<string,mixed> $doc */
    public function add(string $method, string $path, string $access, string $summary, \Closure $handler, array $doc = []): void
    {
        $this->routes[] = new Route(strtoupper($method), $path, $access, $summary, $handler, $doc);
    }

    /** @return list<Route> */
    public function routes(): array
    {
        return $this->routes;
    }

    /** @return array{0: Route, 1: array<string,string>} */
    public function match(string $method, string $path): array
    {
        $allowed = [];
        foreach ($this->routes as $route) {
            $params = $route->match($path);
            if ($params === null) {
                continue;
            }
            if ($route->method === $method) {
                return [$route, $params];
            }
            $allowed[] = $route->method;
        }
        if ($allowed !== []) {
            $allowed = array_values(array_unique($allowed));
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', "$method is not allowed on $path.", ['allowed' => $allowed], ['Allow' => implode(', ', $allowed)]);
        }
        throw HttpError::notFound("No route for $path.");
    }
}
```

`backend/src/Http/AccessResult.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

use Planning\Auth\Principal;

final class AccessResult
{
    /** @param list<string> $cookies Set-Cookie values to add to the response */
    public function __construct(public readonly ?Principal $principal, public readonly array $cookies = [])
    {
    }
}
```

`backend/src/Http/AccessGuard.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

interface AccessGuard
{
    /** Decides who is calling and whether they may use the route. Throws HttpError 401/403. */
    public function check(Route $route, Request $request): AccessResult;
}
```

- [ ] **Step 6: Implement the kernel**

`backend/src/Http/Kernel.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

use Planning\Support\RequestContext;
use Planning\Support\Uuid;

final class Kernel
{
    /** @param \Closure(string): void $logger */
    public function __construct(
        private readonly Router $router,
        private readonly AccessGuard $guard,
        private readonly \Closure $logger,
    ) {
    }

    public function handle(Request $request): Response
    {
        $cid = self::correlationId($request);
        RequestContext::$correlationId = $cid;
        try {
            [$route, $params] = $this->router->match($request->method, $request->path);
            $access = $this->guard->check($route, $request);
            $response = ($route->handler)($request, $params, $access->principal);
            foreach ($access->cookies as $cookie) {
                $response = $response->withCookie($cookie);
            }
        } catch (HttpError $e) {
            $response = Response::json($e->status, self::envelope($e->errorCode, $e->getMessage(), $cid, $e->details));
            foreach ($e->headers as $name => $value) {
                $response = $response->withHeader($name, $value);
            }
        } catch (\Throwable $e) {
            ($this->logger)(sprintf('[planning-api] %s %s: %s at %s:%d', $cid, $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
            $response = Response::json(500, self::envelope('INTERNAL_ERROR', 'An unexpected error occurred.', $cid, null));
        }
        return $response->withHeader('X-Correlation-ID', $cid);
    }

    /** Contract SS-4: reuse the caller's id when it is safe to echo, otherwise mint one. */
    public static function correlationId(Request $request): string
    {
        $supplied = trim((string) $request->header('x-correlation-id'));
        if ($supplied !== '' && strlen($supplied) <= 128 && preg_match('/^[A-Za-z0-9._:-]+$/', $supplied)) {
            return $supplied;
        }
        return Uuid::v4();
    }

    /** @return array{error: array{code: string, message: string, correlation_id: string, details: mixed}} */
    public static function envelope(string $code, string $message, string $cid, mixed $details): array
    {
        return ['error' => ['code' => $code, 'message' => $message, 'correlation_id' => $cid, 'details' => $details]];
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "RouterTest|RequestTest|KernelTest"`
Expected: PASS (14 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/Http backend/src/Support backend/src/Auth/Principal.php backend/tests/Unit/Http
git commit -m "feat: add HTTP kernel with routing, correlation ids and error envelope"
```

---

### Task 3: Database connection, migrations and the M1 schema

**Files:**
- Create: `backend/src/Db/Database.php`, `backend/src/Db/Migrator.php`, `backend/migrations/001_initial.sql`, `bin/migrate.php`
- Create: `backend/tests/Support/DatabaseTestCase.php`
- Test: `backend/tests/Integration/Db/MigratorTest.php`

**Interfaces:**
- Consumes: `Env` (Task 1).
- Produces: `Database(string $host, int $port, string $name, string $user, string $password, int $timeoutSeconds = 4)`, `Database::fromEnv()`, `->pdo(): \PDO`, `->ping(): bool`; `Migrator(\PDO, string $directory)`, `->run(): list<string>`, `Migrator::statements(string $sql): list<string>`; abstract `DatabaseTestCase` with `protected const ORG = 'test-org'`, `TABLES`, `pdo()`.

- [ ] **Step 1: Write the schema**

`backend/migrations/001_initial.sql`:

```sql
-- M1 schema. Every table carries organisation_id (DR-05, NFR-10).
-- All DATETIME values are UTC.

CREATE TABLE IF NOT EXISTS roles (
  id CHAR(36) NOT NULL,
  organisation_id VARCHAR(64) NOT NULL,
  name VARCHAR(80) NOT NULL,
  color CHAR(7) NOT NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_org_name (organisation_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_profiles (
  organisation_id VARCHAR(64) NOT NULL,
  employee_ref VARCHAR(64) NOT NULL,
  default_role_id CHAR(36) NULL,
  timezone VARCHAR(64) NULL,
  working_hours JSON NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (organisation_id, employee_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_roles (
  organisation_id VARCHAR(64) NOT NULL,
  employee_ref VARCHAR(64) NOT NULL,
  role_id CHAR(36) NOT NULL,
  PRIMARY KEY (organisation_id, employee_ref, role_id),
  KEY idx_employee_roles_role (organisation_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shifts (
  id CHAR(36) NOT NULL,
  organisation_id VARCHAR(64) NOT NULL,
  employee_ref VARCHAR(64) NULL,
  role_id CHAR(36) NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  break_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  allocated_percent TINYINT UNSIGNED NOT NULL DEFAULT 100,
  note TEXT NULL,
  state ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  conflict_acknowledged_by VARCHAR(254) NULL,
  conflict_acknowledged_at DATETIME NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(254) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(254) NULL,
  PRIMARY KEY (id),
  KEY idx_shifts_org_employee_time (organisation_id, employee_ref, start_at, end_at),
  KEY idx_shifts_org_time (organisation_id, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unavailabilities (
  id CHAR(36) NOT NULL,
  organisation_id VARCHAR(64) NOT NULL,
  employee_ref VARCHAR(64) NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  reason VARCHAR(200) NOT NULL DEFAULT '',
  created_by VARCHAR(254) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_unavailabilities_org_employee_time (organisation_id, employee_ref, start_at, end_at),
  KEY idx_unavailabilities_org_time (organisation_id, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_holidays (
  id CHAR(36) NOT NULL,
  organisation_id VARCHAR(64) NOT NULL,
  holiday_date DATE NOT NULL,
  name VARCHAR(160) NOT NULL,
  source ENUM('manual', 'provider') NOT NULL,
  provider_key VARCHAR(160) NULL,
  edited TINYINT(1) NOT NULL DEFAULT 0,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_public_holidays_provider (organisation_id, provider_key),
  KEY idx_public_holidays_org_date (organisation_id, holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organisation_settings (
  organisation_id VARCHAR(64) NOT NULL,
  country_code CHAR(2) NULL,
  region_code VARCHAR(10) NULL,
  timezone VARCHAR(64) NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (organisation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planning_managers (
  organisation_id VARCHAR(64) NOT NULL,
  email VARCHAR(254) NOT NULL,
  granted_by VARCHAR(254) NOT NULL,
  granted_at DATETIME NOT NULL,
  PRIMARY KEY (organisation_id, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_directory (
  organisation_id VARCHAR(64) NOT NULL,
  employee_ref VARCHAR(64) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  photo_url VARCHAR(500) NULL,
  department_id VARCHAR(64) NULL,
  department_name VARCHAR(160) NULL,
  status VARCHAR(32) NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (organisation_id, employee_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisation_id VARCHAR(64) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  employee_ref VARCHAR(64) NULL,
  subject_id CHAR(36) NULL,
  payload JSON NOT NULL,
  deliver_after DATETIME NOT NULL,
  cancelled_at DATETIME NULL,
  delivered_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_notification_outbox_pending (organisation_id, delivered_at, cancelled_at, deliver_after),
  KEY idx_notification_outbox_subject (organisation_id, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Write the test base class and the failing test**

`backend/tests/Support/DatabaseTestCase.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use PDO;
use PHPUnit\Framework\TestCase;
use Planning\Db\Database;
use Planning\Db\Migrator;

/** Integration tests run against the docker-compose MySQL (port 3307). */
abstract class DatabaseTestCase extends TestCase
{
    protected const ORG = 'test-org';

    public const TABLES = [
        'roles', 'employee_profiles', 'employee_roles', 'shifts', 'unavailabilities', 'public_holidays',
        'organisation_settings', 'planning_managers', 'employee_directory', 'notification_outbox',
    ];

    private static ?PDO $shared = null;

    protected function setUp(): void
    {
        parent::setUp();
        foreach (self::TABLES as $table) {
            $this->pdo()->exec("DELETE FROM $table");
        }
    }

    protected function pdo(): PDO
    {
        if (self::$shared === null) {
            $host = (string) getenv('TEST_DB_HOST');
            $port = (int) getenv('TEST_DB_PORT');
            $name = (string) getenv('TEST_DB_NAME');
            $user = (string) getenv('TEST_DB_USER');
            $password = (string) getenv('TEST_DB_PASSWORD');
            $server = new PDO("mysql:host=$host;port=$port;charset=utf8mb4", $user, $password, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $server->exec("CREATE DATABASE IF NOT EXISTS `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            self::$shared = (new Database($host, $port, $name, $user, $password))->pdo();
            (new Migrator(self::$shared, dirname(__DIR__, 2) . '/migrations'))->run();
        }
        return self::$shared;
    }
}
```

`backend/tests/Integration/Db/MigratorTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Db;

use Planning\Db\Migrator;
use Planning\Tests\Support\DatabaseTestCase;

final class MigratorTest extends DatabaseTestCase
{
    public function test_every_table_exists_after_migrating(): void
    {
        foreach (self::TABLES as $table) {
            $found = $this->pdo()->query("SHOW TABLES LIKE '$table'")->fetchColumn();
            $this->assertSame($table, $found, "$table is missing");
        }
    }

    public function test_running_again_applies_nothing(): void
    {
        $applied = (new Migrator($this->pdo(), dirname(__DIR__, 3) . '/migrations'))->run();
        $this->assertSame([], $applied);
    }

    public function test_connections_use_utc(): void
    {
        $this->assertSame('+00:00', $this->pdo()->query('SELECT @@session.time_zone')->fetchColumn());
    }

    public function test_statements_ignore_comments_and_blank_parts(): void
    {
        $sql = "-- comment\nCREATE TABLE a (x INT);\n\nCREATE TABLE b (y INT);\n";
        $this->assertSame(['CREATE TABLE a (x INT)', 'CREATE TABLE b (y INT)'], Migrator::statements($sql));
    }
}
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `php vendor/bin/phpunit --filter MigratorTest`
Expected: FAIL with `Class "Planning\Db\Database" not found`.

- [ ] **Step 4: Implement `Database` and `Migrator`**

`backend/src/Db/Database.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Db;

use PDO;
use Planning\Config\Env;

/** Opens the connection lazily, so /health and pages that need no data stay cheap. */
final class Database
{
    private ?PDO $pdo = null;

    public function __construct(
        private readonly string $host,
        private readonly int $port,
        private readonly string $name,
        private readonly string $user,
        private readonly string $password,
        private readonly int $timeoutSeconds = 4,
    ) {
    }

    public static function fromEnv(): self
    {
        return new self(
            Env::require('DB_HOST'),
            (int) Env::get('DB_PORT', '3306'),
            Env::require('DB_NAME'),
            Env::require('DB_USER'),
            Env::get('DB_PASSWORD', '') ?? '',
        );
    }

    public function pdo(): PDO
    {
        if ($this->pdo === null) {
            $pdo = new PDO(
                "mysql:host={$this->host};port={$this->port};dbname={$this->name};charset=utf8mb4",
                $this->user,
                $this->password,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                    PDO::ATTR_TIMEOUT => $this->timeoutSeconds,
                ],
            );
            $pdo->exec("SET time_zone = '+00:00'");
            $this->pdo = $pdo;
        }
        return $this->pdo;
    }

    public function ping(): bool
    {
        try {
            return $this->pdo()->query('SELECT 1')->fetchColumn() !== false;
        } catch (\Throwable) {
            return false;
        }
    }
}
```

`backend/src/Db/Migrator.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Db;

use PDO;

/**
 * Applies backend/migrations/NNN_name.sql files in order, once each.
 * MySQL commits DDL immediately, so every statement must be safe to re-run
 * (CREATE TABLE IF NOT EXISTS, guarded ALTERs) in case a migration fails halfway.
 */
final class Migrator
{
    public function __construct(private readonly PDO $pdo, private readonly string $directory)
    {
    }

    /** @return list<string> versions applied by this run */
    public function run(): array
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $done = array_flip($this->pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN));

        $files = glob($this->directory . '/*.sql') ?: [];
        sort($files, SORT_STRING);

        $applied = [];
        foreach ($files as $file) {
            $version = basename($file, '.sql');
            if (isset($done[$version])) {
                continue;
            }
            foreach (self::statements((string) file_get_contents($file)) as $sql) {
                $this->pdo->exec($sql);
            }
            $this->pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP())')->execute([$version]);
            $applied[] = $version;
        }
        return $applied;
    }

    /** @return list<string> */
    public static function statements(string $sql): array
    {
        $sql = (string) preg_replace('/^\s*--.*$/m', '', $sql);
        $parts = preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [];
        return array_values(array_filter(array_map('trim', $parts), static fn (string $s): bool => $s !== ''));
    }
}
```

- [ ] **Step 5: Add the migration command**

`bin/migrate.php`:

```php
<?php

declare(strict_types=1);

// Usage: php bin/migrate.php   (reads DB_* from the environment or .env)
require __DIR__ . '/../backend/bootstrap.php';

use Planning\Config\Env;
use Planning\Db\Database;
use Planning\Db\Migrator;

Env::loadFile(dirname(__DIR__) . '/.env');
$applied = (new Migrator(Database::fromEnv()->pdo(), dirname(__DIR__) . '/backend/migrations'))->run();
echo $applied === [] ? "Nothing to migrate.\n" : 'Applied: ' . implode(', ', $applied) . "\n";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter MigratorTest`
Expected: PASS (4 tests). If it cannot connect, check `docker compose ps` shows MySQL healthy.

- [ ] **Step 7: Migrate the local development database**

```bash
cp .env.example .env
php bin/migrate.php
```

Expected: `Applied: 001_initial`. Running it again prints `Nothing to migrate.`

- [ ] **Step 8: Commit**

```bash
git add backend/src/Db backend/migrations bin/migrate.php backend/tests/Support/DatabaseTestCase.php backend/tests/Integration/Db
git commit -m "feat: add database connection, migrator and M1 schema"
```

---

### Task 4: App container, `/health`, `/openapi.json` and the API entry point

**Files:**
- Create: `backend/src/Config/ServiceInfo.php`, `backend/src/Support/Clock.php`, `backend/src/Support/SystemClock.php`
- Create: `backend/src/Http/Doc.php`, `backend/src/Http/OpenApiDocument.php`, `backend/src/Http/PublicOnlyGuard.php`
- Create: `backend/src/Http/Controllers/HealthController.php`, `backend/src/Http/Controllers/OpenApiController.php`
- Create: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Create: `api/index.php`, `router.php`, `vercel.json`, `.vercelignore`
- Test: `backend/tests/Unit/Http/HealthControllerTest.php`, `backend/tests/Unit/Http/OpenApiDocumentTest.php`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `ServiceInfo(string $serviceId, string $extensionKey)`, `ServiceInfo::VERSION = '0.1.0'`, `ServiceInfo::fromEnv()`.
  - `Clock::now(): \DateTimeImmutable` (always UTC); `SystemClock`.
  - `Doc::op(string $name, string $purpose, list<string> $useWhen, list<string> $doNotUseWhen, list<string> $inputs, list<string> $outputs, list<string> $requires, list<string> $related, list<string> $tags): array`.
  - `OpenApiDocument::build(Router $router, ServiceInfo $info, array $catalog): array`.
  - `App` with `boot()`, `override(string $key, object $instance)`, `serveApi()`, and getters `clock()`, `logger()`, `organisationId()`, `serviceInfo()`, `database()`, `pdo()`, `guard()`, `router()`, `kernel()`, `openApiJson()`, `healthController()`, `openApiController()`. Later tasks add getters with the same `once()` pattern.
  - `backend/src/routes.php` returns `\Closure(App): Router`. Later tasks add routes before its final `return $router;`.
  - `backend/src/catalog.php` returns the service-level metadata array. Later tasks add capability entries.

- [ ] **Step 1: Write the failing tests**

`backend/tests/Unit/Http/HealthControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Http;

use PHPUnit\Framework\TestCase;
use Planning\Config\ServiceInfo;
use Planning\Http\Controllers\HealthController;
use Planning\Http\Request;

final class HealthControllerTest extends TestCase
{
    public function test_ok_when_the_database_answers(): void
    {
        $health = new HealthController(new ServiceInfo('planning-api', 'x-test'), static fn (): bool => true);

        $body = $health->show(new Request('GET', '/health'))->decoded();

        $this->assertSame(['status' => 'ok', 'service' => 'planning-api', 'version' => ServiceInfo::VERSION, 'checks' => ['database' => true]], $body);
    }

    public function test_degraded_when_the_database_does_not(): void
    {
        $health = new HealthController(new ServiceInfo('planning-api', 'x-test'), static fn (): bool => false);

        $response = $health->show(new Request('GET', '/health'));

        $this->assertSame(200, $response->status);
        $this->assertSame('degraded', $response->decoded()['status']);
    }
}
```

`backend/tests/Unit/Http/OpenApiDocumentTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Http;

use PHPUnit\Framework\TestCase;
use Planning\App;
use Planning\Config\ServiceInfo;
use Planning\Http\OpenApiDocument;
use Planning\Http\Route;

/**
 * Enforces contract SS-3, SS-6, SS-7, SS-23 and SS-27 on the real route table.
 * Every later task that adds a route must keep this test passing.
 */
final class OpenApiDocumentTest extends TestCase
{
    private const OPERATION_KEYS = ['name', 'purpose', 'use_when', 'do_not_use_when', 'inputs', 'outputs', 'requires', 'related_endpoints', 'tags'];
    private const SERVICE_KEYS = ['domain', 'owner', 'app_url', 'category', 'industries', 'use_cases', 'capabilities', 'workflows', 'related_services'];
    private const CAPABILITY_KEYS = ['name', 'icon', 'description', 'does', 'best_for', 'endpoints'];

    /** @var array<string,mixed> */
    private array $doc;
    /** @var list<Route> */
    private array $routes;

    protected function setUp(): void
    {
        $router = (require dirname(__DIR__, 3) . '/src/routes.php')(new App());
        $this->routes = $router->routes();
        $this->doc = OpenApiDocument::build($router, new ServiceInfo('planning-api', 'x-test'), require dirname(__DIR__, 3) . '/src/catalog.php');
    }

    public function test_document_basics(): void
    {
        $this->assertSame('3.0.3', $this->doc['openapi']);
        $this->assertNotSame('', $this->doc['info']['title']);
        $this->assertNotSame('', $this->doc['info']['description']);
        $this->assertSame(ServiceInfo::VERSION, $this->doc['info']['version']);
        $this->assertNotEmpty($this->doc['paths']);
    }

    public function test_service_metadata_is_complete(): void
    {
        $meta = $this->doc['info']['x-test'];
        foreach (self::SERVICE_KEYS as $key) {
            $this->assertArrayHasKey($key, $meta, "info.x-test.$key missing");
        }
        foreach (['industries', 'use_cases', 'capabilities', 'workflows'] as $key) {
            $this->assertNotEmpty($meta[$key], "info.x-test.$key must not be empty");
        }
        $allowed = ['Main Database', 'Human Resources', 'Marketing', 'Sales', 'Finance', 'IT', 'Operations', 'Legal', 'Support'];
        foreach ($meta['industries'] as $industry) {
            $this->assertContains($industry, $allowed);
        }
        foreach ($meta['capabilities'] as $capability) {
            foreach (self::CAPABILITY_KEYS as $key) {
                $this->assertArrayHasKey($key, $capability, "capability {$capability['name']} lacks $key");
            }
            $this->assertNotEmpty($capability['does']);
            $this->assertNotEmpty($capability['endpoints']);
        }
    }

    public function test_every_operation_has_summary_and_discovery_metadata(): void
    {
        foreach ($this->doc['paths'] as $path => $operations) {
            foreach ($operations as $method => $op) {
                $this->assertNotSame('', $op['summary'] ?? '', "$method $path has no summary");
                foreach (self::OPERATION_KEYS as $key) {
                    $this->assertArrayHasKey($key, $op['x-test'], "$method $path lacks x-test.$key");
                }
                $this->assertNotEmpty($op['x-test']['use_when'], "$method $path use_when is empty");
                $this->assertNotEmpty($op['x-test']['tags'], "$method $path tags is empty");
            }
        }
    }

    public function test_non_public_operations_declare_their_scope(): void
    {
        foreach ($this->routes as $route) {
            if ($route->access === Route::INTERNAL) {
                $this->assertArrayNotHasKey($route->path, $this->doc['paths'], 'Internal routes must stay out of the document');
                continue;
            }
            $op = $this->doc['paths'][$route->path][strtolower($route->method)];
            if ($route->access === Route::PUBLIC) {
                $this->assertArrayNotHasKey('security', $op);
            } else {
                $this->assertSame([['bearerAuth' => [$route->scope()]]], $op['security']);
            }
        }
    }

    public function test_catalogue_and_routes_agree(): void
    {
        $documented = [];
        foreach ($this->doc['paths'] as $path => $operations) {
            foreach (array_keys($operations) as $method) {
                $documented[] = strtoupper($method) . ' ' . $path;
            }
        }
        $inCapabilities = [];
        foreach ($this->doc['info']['x-test']['capabilities'] as $capability) {
            foreach ($capability['endpoints'] as $endpoint) {
                $this->assertContains($endpoint, $documented, "Capability {$capability['name']} lists unknown $endpoint");
                $inCapabilities[] = $endpoint;
            }
        }
        foreach ($this->routes as $route) {
            if ($route->access === Route::PERSON || $route->access === Route::MANAGER) {
                $this->assertContains("{$route->method} {$route->path}", $inCapabilities, "{$route->method} {$route->path} is in no capability");
            }
        }
    }
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `php vendor/bin/phpunit --filter "HealthControllerTest|OpenApiDocumentTest"`
Expected: FAIL with class-not-found errors.

- [ ] **Step 3: Implement `ServiceInfo`, the clock and `Doc`**

`backend/src/Config/ServiceInfo.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Config;

final class ServiceInfo
{
    /** Change in the same commit as any API change (NFR-09). */
    public const VERSION = '0.1.0';

    public function __construct(public readonly string $serviceId, public readonly string $extensionKey)
    {
    }

    public static function fromEnv(): self
    {
        return new self(Env::require('SERVICE_ID'), Env::require('OPENAPI_EXTENSION_KEY'));
    }
}
```

`backend/src/Support/Clock.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

interface Clock
{
    /** The current instant, in UTC. */
    public function now(): \DateTimeImmutable;
}
```

`backend/src/Support/SystemClock.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

final class SystemClock implements Clock
{
    public function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }
}
```

`backend/src/Http/Doc.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

/** Builds the per-operation discovery metadata the gateway catalogue requires (contract SS-27). */
final class Doc
{
    /**
     * @param list<string> $useWhen
     * @param list<string> $doNotUseWhen
     * @param list<string> $inputs
     * @param list<string> $outputs
     * @param list<string> $requires
     * @param list<string> $related "METHOD /path" strings
     * @param list<string> $tags
     * @return array<string,mixed>
     */
    public static function op(string $name, string $purpose, array $useWhen, array $doNotUseWhen, array $inputs, array $outputs, array $requires, array $related, array $tags): array
    {
        return [
            'name' => $name,
            'purpose' => $purpose,
            'use_when' => $useWhen,
            'do_not_use_when' => $doNotUseWhen,
            'inputs' => $inputs,
            'outputs' => $outputs,
            'requires' => $requires,
            'related_endpoints' => $related,
            'tags' => $tags,
        ];
    }
}
```

- [ ] **Step 4: Implement the OpenAPI builder and the two controllers**

`backend/src/Http/OpenApiDocument.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

use Planning\Config\ServiceInfo;

/**
 * Builds /openapi.json from the route table, so the scope a route declares
 * and the scope the guard enforces come from the same place (contract SS-6).
 */
final class OpenApiDocument
{
    private const SUCCESS = ['GET' => '200', 'POST' => '201', 'PATCH' => '200', 'DELETE' => '204'];

    /**
     * @param array<string,mixed> $catalog service-level metadata from catalog.php
     * @return array<string,mixed>
     */
    public static function build(Router $router, ServiceInfo $info, array $catalog): array
    {
        $paths = [];
        foreach ($router->routes() as $route) {
            if ($route->access === Route::INTERNAL) {
                continue;
            }
            $operation = [
                'summary' => $route->summary,
                'operationId' => strtolower($route->method) . str_replace(['/', '{', '}', '-'], ['_', '', '', '_'], $route->path),
                'responses' => [
                    self::SUCCESS[$route->method] ?? '200' => ['description' => 'Success.'],
                    'default' => ['description' => 'Error envelope: {"error":{"code","message","correlation_id","details"}}.'],
                ],
                $info->extensionKey => $route->doc,
            ];
            preg_match_all('/\{([a-z_]+)\}/', $route->path, $m);
            if ($m[1] !== []) {
                $operation['parameters'] = array_map(
                    static fn (string $name): array => ['name' => $name, 'in' => 'path', 'required' => true, 'schema' => ['type' => 'string']],
                    $m[1],
                );
            }
            if ($route->access !== Route::PUBLIC) {
                $operation['security'] = [['bearerAuth' => [$route->scope()]]];
            }
            $paths[$route->path][strtolower($route->method)] = $operation;
        }

        return [
            'openapi' => '3.0.3',
            'info' => [
                'title' => 'InterlinkERP Planning',
                'version' => ServiceInfo::VERSION,
                'description' => 'Plan, publish and view employee shifts for the Services department, including roles, working hours, time off and public holidays.',
                $info->extensionKey => $catalog,
            ],
            'components' => [
                'securitySchemes' => ['bearerAuth' => ['type' => 'http', 'scheme' => 'bearer', 'bearerFormat' => 'JWT']],
            ],
            'paths' => $paths,
        ];
    }
}
```

`backend/src/Http/Controllers/HealthController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Config\ServiceInfo;
use Planning\Http\Request;
use Planning\Http\Response;

/** Contract SS-2. One trivial database ping, nothing else (performance guide §3). */
final class HealthController
{
    /** @param \Closure(): bool $databasePing */
    public function __construct(private readonly ServiceInfo $info, private readonly \Closure $databasePing)
    {
    }

    public function show(Request $request): Response
    {
        $database = ($this->databasePing)();
        return Response::json(200, [
            'status' => $database ? 'ok' : 'degraded',
            'service' => $this->info->serviceId,
            'version' => ServiceInfo::VERSION,
            'checks' => ['database' => $database],
        ]);
    }
}
```

`backend/src/Http/Controllers/OpenApiController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Http\Request;
use Planning\Http\Response;

/** Serves the document built once per process (performance guide §4). */
final class OpenApiController
{
    /** @param \Closure(): string $json */
    public function __construct(private readonly \Closure $json)
    {
    }

    public function show(Request $request): Response
    {
        return Response::rawJson(200, ($this->json)())->withHeader('Cache-Control', 'public, max-age=60');
    }
}
```

`backend/src/Http/PublicOnlyGuard.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

/** Placeholder until Task 6: refuses every non-public route, so nothing is ever open by accident. */
final class PublicOnlyGuard implements AccessGuard
{
    public function check(Route $route, Request $request): AccessResult
    {
        if ($route->access === Route::PUBLIC || $route->access === Route::INTERNAL) {
            return new AccessResult(null);
        }
        throw HttpError::unauthorized('Sign in through the InterlinkERP gateway first.');
    }
}
```

- [ ] **Step 5: Implement `App`, the route table and the catalogue**

`backend/src/App.php`:

```php
<?php

declare(strict_types=1);

namespace Planning;

use PDO;
use Planning\Config\ConfigError;
use Planning\Config\Env;
use Planning\Config\ServiceInfo;
use Planning\Db\Database;
use Planning\Http\AccessGuard;
use Planning\Http\Controllers\HealthController;
use Planning\Http\Controllers\OpenApiController;
use Planning\Http\Kernel;
use Planning\Http\OpenApiDocument;
use Planning\Http\PublicOnlyGuard;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Http\Router;
use Planning\Support\Clock;
use Planning\Support\SystemClock;
use Planning\Support\Uuid;

/**
 * The only place objects are wired together. Everything is built lazily on
 * first use, so a request only pays for what it touches (/health opens one
 * database connection and nothing else). Tests swap pieces with override().
 */
final class App
{
    /** Checked before serving anything (contract SS-20). Later tasks extend this list. */
    public const REQUIRED_ENV = ['SERVICE_ID', 'OPENAPI_EXTENSION_KEY', 'DB_HOST', 'DB_NAME', 'DB_USER'];

    /** @var array<string,mixed> */
    private array $instances = [];

    public static function boot(): self
    {
        ini_set('display_errors', '0');
        ini_set('log_errors', '1');
        Env::loadFile(dirname(__DIR__, 2) . '/.env');
        return new self();
    }

    public function override(string $key, object $instance): void
    {
        $this->instances[$key] = $instance;
    }

    public function serveApi(): void
    {
        try {
            Env::requireAll(self::REQUIRED_ENV);
        } catch (ConfigError $e) {
            ($this->logger())('[planning-api] ' . $e->getMessage());
            $cid = Uuid::v4();
            Response::json(500, Kernel::envelope('INTERNAL_ERROR', 'The service is misconfigured. See the server log.', $cid, null))
                ->withHeader('X-Correlation-ID', $cid)
                ->send();
            return;
        }
        $this->kernel()->handle(Request::fromGlobals())->send();
    }

    /**
     * @template T
     * @param \Closure(): T $make
     * @return T
     */
    private function once(string $key, \Closure $make): mixed
    {
        if (!array_key_exists($key, $this->instances)) {
            $this->instances[$key] = $make();
        }
        return $this->instances[$key];
    }

    public function clock(): Clock
    {
        return $this->once('clock', static fn () => new SystemClock());
    }

    /** @return \Closure(string): void */
    public function logger(): \Closure
    {
        return $this->once('logger', static fn () => static function (string $line): void {
            error_log($line);
        });
    }

    public function organisationId(): string
    {
        return Env::get('ORGANISATION_ID', 'default') ?? 'default';
    }

    public function serviceInfo(): ServiceInfo
    {
        return $this->once('serviceInfo', static fn () => ServiceInfo::fromEnv());
    }

    public function database(): Database
    {
        return $this->once('database', static fn () => Database::fromEnv());
    }

    public function pdo(): PDO
    {
        return $this->once('pdo', fn () => $this->database()->pdo());
    }

    public function guard(): AccessGuard
    {
        return $this->once('guard', static fn () => new PublicOnlyGuard());
    }

    public function router(): Router
    {
        return $this->once('router', fn () => (require __DIR__ . '/routes.php')($this));
    }

    public function kernel(): Kernel
    {
        return $this->once('kernel', fn () => new Kernel($this->router(), $this->guard(), $this->logger()));
    }

    public function openApiJson(): string
    {
        return $this->once('openApiJson', fn () => json_encode(
            OpenApiDocument::build($this->router(), $this->serviceInfo(), require __DIR__ . '/catalog.php'),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        ));
    }

    public function healthController(): HealthController
    {
        return $this->once('healthController', fn () => new HealthController(
            $this->serviceInfo(),
            fn (): bool => $this->database()->ping(),
        ));
    }

    public function openApiController(): OpenApiController
    {
        return $this->once('openApiController', fn () => new OpenApiController(fn (): string => $this->openApiJson()));
    }
}
```

`backend/src/routes.php`:

```php
<?php

declare(strict_types=1);

use Planning\App;
use Planning\Auth\Principal;
use Planning\Http\Doc;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Http\Route;
use Planning\Http\Router;

/**
 * Every route the service answers, with the discovery metadata the gateway
 * catalogue reads (contract SS-27). Handlers resolve their controller lazily.
 */
return static function (App $app): Router {
    $router = new Router();
    $to = static fn (string $controller, string $method): Closure =>
        static fn (Request $r, array $p, ?Principal $u): Response => $app->{$controller}()->{$method}($r, $p, $u);

    $router->add('GET', '/health', Route::PUBLIC, 'Report whether the service and its database are reachable.', $to('healthController', 'show'), Doc::op(
        'Check Health', 'Find out whether Planning is up', ['Monitoring whether the service is reachable'], ['Reading schedule data'],
        [], ['status', 'service', 'version', 'checks'], [], ['GET /openapi.json'], ['health', 'status', 'uptime'],
    ));
    $router->add('GET', '/openapi.json', Route::PUBLIC, 'Describe every endpoint this service offers.', $to('openApiController', 'show'), Doc::op(
        'Describe API', 'Read the API description', ['Discovering what Planning can do'], ['Checking whether the service is up'],
        [], ['openapi', 'paths'], [], ['GET /health'], ['openapi', 'docs', 'schema'],
    ));

    return $router;
};
```

`backend/src/catalog.php`:

```php
<?php

declare(strict_types=1);

/**
 * Service-level catalogue metadata (contract SS-23, SS-27). Every PERSON or
 * MANAGER route must appear in exactly one capability; OpenApiDocumentTest checks this.
 */
return [
    'domain' => 'Operations',
    'owner' => 'services-team',
    'app_url' => '/',
    'category' => 'Operations',
    'industries' => ['Operations', 'Human Resources'],
    'use_cases' => [
        'Planning weekly shifts for a services team',
        'Publishing a work schedule to employees',
        'Checking who is working when',
        'Spotting double bookings and people scheduled on leave',
    ],
    'capabilities' => [],
    'workflows' => [
        ['name' => 'Plan and publish a week', 'steps' => ['GET /api/schedule', 'POST /api/shifts', 'PATCH /api/shifts/{id}', 'POST /api/publications']],
    ],
    'related_services' => ['intern-database', 'department-api'],
];
```

`capabilities` stays empty until Task 6 adds the first one. `test_service_metadata_is_complete` therefore fails until then. That's expected. Step 7 runs the other tests only, and Task 6 makes this one pass.

- [ ] **Step 6: Add the entry points and Vercel config**

`api/index.php`:

```php
<?php

declare(strict_types=1);

// Vercel entry for the JSON API: /health, /openapi.json, /api/*, /internal/*.
require __DIR__ . '/../backend/bootstrap.php';

\Planning\App::boot()->serveApi();
```

`router.php`:

```php
<?php

declare(strict_types=1);

// Local development only: php -S 127.0.0.1:8000 router.php
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);

$static = __DIR__ . '/dist' . $path;
if ($path !== '/' && is_file($static) && !str_ends_with($path, '.html')) {
    $types = ['js' => 'application/javascript', 'css' => 'text/css', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'ico' => 'image/x-icon', 'woff2' => 'font/woff2', 'map' => 'application/json'];
    $ext = strtolower(pathinfo($static, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    readfile($static);
    return true;
}

require __DIR__ . '/api/index.php';
return true;
```

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"],
  "functions": {
    "api/index.php": { "runtime": "vercel-php@0.9.0" }
  },
  "rewrites": [
    { "source": "/health", "destination": "/api/index.php" },
    { "source": "/openapi.json", "destination": "/api/index.php" },
    { "source": "/api/:path*", "destination": "/api/index.php" },
    { "source": "/internal/:path*", "destination": "/api/index.php" },
    { "source": "/:path*", "destination": "/api/index.php" }
  ]
}
```

`.vercelignore`:

```
vendor
node_modules
backend/tests
docs
.phpunit.cache
docker-compose.yml
```

- [ ] **Step 7: Run the tests**

Run: `php vendor/bin/phpunit --filter "HealthControllerTest|OpenApiDocumentTest"`
Expected: `HealthControllerTest` passes (2 tests). In `OpenApiDocumentTest`, `test_service_metadata_is_complete` fails with "info.x-test.capabilities must not be empty", which Task 6 fixes. The other four pass.

- [ ] **Step 8: Check the running service by hand**

```bash
php -S 127.0.0.1:8000 router.php
```

In a second terminal:

```bash
curl -s -i http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/openapi.json | head -c 300
curl -s -i http://127.0.0.1:8000/nope
```

Expected:
- `/health` returns 200 with `{"status":"ok","service":"planning-api",...}` and an `X-Correlation-ID` header. Set `OPENAPI_EXTENSION_KEY=x-local` in `.env` for local use if you don't have the real value yet.
- `/nope` returns 404 with the error envelope.

Stop the server with Ctrl+C.

- [ ] **Step 9: Commit**

```bash
git add backend/src api router.php vercel.json .vercelignore backend/tests/Unit/Http
git commit -m "feat: serve /health and /openapi.json from the route table"
```

---
### Task 5: Gateway token verification, session check and session cookie

Ports `../hr-recruitment-demo/backend/support/Jwt.php`, `Gateway.php` and `Session.php`, with three deliberate changes:
- The session check reports *unknown* separately from *live*, so the cookie is only extended when the gateway actually confirmed the session. A gateway outage then can't keep a session alive forever (auth guide §6).
- There is no default session secret. A missing or short `SESSION_SECRET` is a startup error.
- There is no default or guessed role. The session stores exactly the gateway's `role` claim, or an empty string.

**Files:**
- Create: `backend/src/Support/HttpClient.php`, `HttpResult.php`, `CurlHttpClient.php`
- Create: `backend/src/Auth/TokenInvalid.php`, `JwksSource.php`, `HttpJwksSource.php`, `TokenVerifier.php`, `Liveness.php`, `SessionLiveness.php`, `Gateway.php`, `SessionData.php`, `SessionCodec.php`
- Create: `backend/tests/fixtures/test-rsa-private.pem`, `backend/tests/Support/FixedClock.php`, `backend/tests/Support/FakeHttpClient.php`, `backend/tests/Support/TestTokens.php`
- Test: `backend/tests/Unit/Auth/TokenVerifierTest.php`, `GatewayTest.php`, `SessionCodecTest.php`

**Interfaces:**
- Consumes: `Clock` (Task 4), `ConfigError` (Task 1), `RequestContext` (Task 2).
- Produces:
  - `HttpClient::request(string $method, string $url, list<string> $headers = [], ?string $body = null, int $timeoutSeconds = 5): HttpResult`; `HttpResult(int $status, ?array $json, bool $networkError = false)`, `HttpResult::failed()`; `CurlHttpClient`.
  - `JwksSource::keys(bool $refresh = false): list<array<string,mixed>>`; `HttpJwksSource(HttpClient, string $gatewayUrl)`.
  - `TokenVerifier(JwksSource, string $issuer, string $audience)`, `->verify(string $token, string $expectedUse): array<string,mixed>` (throws `TokenInvalid`), `TokenVerifier::jwkToPem(array): string`.
  - `enum Liveness { Live, Dead, Unknown }`; `SessionLiveness::liveness(string $sid, string $sub): Liveness`.
  - `Gateway(HttpClient, string $gatewayUrl, string $publicUrl)` implements `SessionLiveness`; `->authorizeUrl(string $returnPath): string`, `->exchangeCode(string $code): string`.
  - `SessionData(string $sid, string $sub, string $email, string $name, string $gatewayRole, ?string $employeeRef, int $expiresAt)`, `->toArray()`, `SessionData::fromArray(array): ?SessionData`, `->withExpiry(int)`.
  - `SessionCodec(string $secret, Clock)`, constants `COOKIE = 'planning_session'`, `TTL_SECONDS = 900`; `->decode(?string $cookieValue): ?SessionData`, `->issue(SessionData, bool $secure): string` (a Set-Cookie value), `->clear(bool $secure): string`.
  - Test helpers: `FixedClock::at(string $iso)`, `->advance(int $seconds)`; `FakeHttpClient->on(string $method, string $urlPrefix, HttpResult ...$results)`, public `$requests`, `FakeHttpClient::json(int, array)`; `TestTokens::make(array $claimOverrides = [], array $headerOverrides = []): string`, `TestTokens::jwks(): JwksSource`, constants `ISSUER`, `AUDIENCE`, `KID`.

- [ ] **Step 1: Generate the test signing key**

This key only signs tokens inside unit tests. It is never used anywhere else.

```bash
mkdir -p backend/tests/fixtures
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out backend/tests/fixtures/test-rsa-private.pem
```

Expected: the file starts with `-----BEGIN PRIVATE KEY-----`. On Windows, run this in Git Bash, which ships `openssl`.

- [ ] **Step 2: Add the test helpers**

`backend/tests/Support/FixedClock.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\Support\Clock;

final class FixedClock implements Clock
{
    private \DateTimeImmutable $now;

    public function __construct(\DateTimeImmutable $now)
    {
        $this->now = $now->setTimezone(new \DateTimeZone('UTC'));
    }

    public static function at(string $iso): self
    {
        return new self(new \DateTimeImmutable($iso));
    }

    public function now(): \DateTimeImmutable
    {
        return $this->now;
    }

    public function advance(int $seconds): void
    {
        $this->now = $this->now->modify(sprintf('%+d seconds', $seconds));
    }
}
```

`backend/tests/Support/FakeHttpClient.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\Support\HttpClient;
use Planning\Support\HttpResult;

/** Answers by method + URL prefix, in registration order. Unmatched requests are network failures. */
final class FakeHttpClient implements HttpClient
{
    /** @var list<array{method: string, prefix: string, results: list<HttpResult>}> */
    private array $routes = [];

    /** @var list<array{method: string, url: string, headers: list<string>, body: ?string}> */
    public array $requests = [];

    public function on(string $method, string $urlPrefix, HttpResult ...$results): self
    {
        $this->routes[] = ['method' => $method, 'prefix' => $urlPrefix, 'results' => array_values($results)];
        return $this;
    }

    public function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeoutSeconds = 5): HttpResult
    {
        $this->requests[] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];
        foreach ($this->routes as $i => $route) {
            if ($route['method'] === $method && str_starts_with($url, $route['prefix'])) {
                return count($route['results']) > 1 ? array_shift($this->routes[$i]['results']) : $route['results'][0];
            }
        }
        return HttpResult::failed();
    }

    /** @param array<mixed> $body */
    public static function json(int $status, array $body): HttpResult
    {
        return new HttpResult($status, $body);
    }
}
```

`backend/tests/Support/TestTokens.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\Auth\JwksSource;

/** Signs gateway-shaped tokens with the test key from backend/tests/fixtures. */
final class TestTokens
{
    public const KID = 'test-key';
    public const ISSUER = 'https://gateway.test';
    public const AUDIENCE = 'planning-api';

    private static ?\OpenSSLAsymmetricKey $key = null;

    public static function key(): \OpenSSLAsymmetricKey
    {
        if (self::$key === null) {
            $key = openssl_pkey_get_private((string) file_get_contents(dirname(__DIR__) . '/fixtures/test-rsa-private.pem'));
            if ($key === false) {
                throw new \RuntimeException('Missing test key: run Task 5 Step 1.');
            }
            self::$key = $key;
        }
        return self::$key;
    }

    public static function jwks(): JwksSource
    {
        $details = openssl_pkey_get_details(self::key());
        $jwk = ['kty' => 'RSA', 'kid' => self::KID, 'alg' => 'RS256', 'n' => self::b64($details['rsa']['n']), 'e' => self::b64($details['rsa']['e'])];
        return new class ([$jwk]) implements JwksSource {
            /** @param list<array<string,mixed>> $keys */
            public function __construct(private readonly array $keys)
            {
            }

            public function keys(bool $refresh = false): array
            {
                return $this->keys;
            }
        };
    }

    /**
     * @param array<string,mixed> $claims overrides; a null value removes the claim
     * @param array<string,mixed> $header overrides
     */
    public static function make(array $claims = [], array $header = []): string
    {
        $claims = array_filter(array_merge([
            'token_use' => 'identity', 'sid' => 'sid-1', 'sub' => 'sub-1', 'email' => 'ana@example.com', 'name' => 'Ana Lim',
            'role' => 'user', 'iss' => self::ISSUER, 'aud' => self::AUDIENCE, 'exp' => time() + 300,
        ], $claims), static fn ($v): bool => $v !== null);
        $h = self::b64(json_encode(array_merge(['alg' => 'RS256', 'typ' => 'JWT', 'kid' => self::KID], $header)));
        $p = self::b64(json_encode($claims));
        openssl_sign("$h.$p", $signature, self::key(), OPENSSL_ALGO_SHA256);
        return "$h.$p." . self::b64($signature);
    }

    public static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
```

- [ ] **Step 3: Write the failing tests**

`backend/tests/Unit/Auth/TokenVerifierTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Auth;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Planning\Auth\TokenInvalid;
use Planning\Auth\TokenVerifier;
use Planning\Tests\Support\TestTokens;

final class TokenVerifierTest extends TestCase
{
    private TokenVerifier $verifier;

    protected function setUp(): void
    {
        $this->verifier = new TokenVerifier(TestTokens::jwks(), TestTokens::ISSUER, TestTokens::AUDIENCE);
    }

    public function test_a_valid_identity_token_returns_its_claims(): void
    {
        $claims = $this->verifier->verify(TestTokens::make(), 'identity');
        $this->assertSame('ana@example.com', $claims['email']);
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function rejected(): array
    {
        [$h, , $s] = explode('.', TestTokens::make());
        $tampered = $h . '.' . TestTokens::b64(json_encode(['token_use' => 'identity', 'role' => 'admin'])) . '.' . $s;
        return [
            'wrong token_use' => [TestTokens::make(['token_use' => 'access']), 'Expected a "identity" token'],
            'expired' => [TestTokens::make(['exp' => time() - 1]), 'expired'],
            'wrong issuer' => [TestTokens::make(['iss' => 'https://evil.test']), 'issuer'],
            'wrong audience' => [TestTokens::make(['aud' => 'other-api']), 'not minted for'],
            'alg none' => [TestTokens::make([], ['alg' => 'none']), 'algorithm'],
            'unknown key' => [TestTokens::make([], ['kid' => 'other']), 'No key'],
            'tampered payload' => [$tampered, 'Signature'],
            'not a jwt' => ['abc', 'Malformed'],
        ];
    }

    #[DataProvider('rejected')]
    public function test_rejects_bad_tokens(string $token, string $messagePart): void
    {
        $this->expectException(TokenInvalid::class);
        $this->expectExceptionMessage($messagePart);
        $this->verifier->verify($token, 'identity');
    }
}
```

`backend/tests/Unit/Auth/GatewayTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Auth;

use PHPUnit\Framework\TestCase;
use Planning\Auth\Gateway;
use Planning\Auth\Liveness;
use Planning\Support\HttpResult;
use Planning\Tests\Support\FakeHttpClient;

final class GatewayTest extends TestCase
{
    private const GW = 'https://gateway.test';

    private function gateway(FakeHttpClient $http): Gateway
    {
        return new Gateway($http, self::GW, 'https://planning.test');
    }

    public function test_authorize_url_uses_configured_public_url_and_state(): void
    {
        $url = $this->gateway(new FakeHttpClient())->authorizeUrl('/schedule?x=1');
        $this->assertSame(self::GW . '/oauth/authorize?redirect_uri=https%3A%2F%2Fplanning.test%2F&state=%2Fschedule%3Fx%3D1', $url);
        $this->assertStringNotContainsString('state', $this->gateway(new FakeHttpClient())->authorizeUrl('/'));
    }

    public function test_exchange_code_posts_code_and_redirect_uri(): void
    {
        $http = (new FakeHttpClient())->on('POST', self::GW . '/oauth/token', FakeHttpClient::json(200, ['token' => 'jwt']));
        $this->assertSame('jwt', $this->gateway($http)->exchangeCode('c-1'));
        $this->assertSame(['code' => 'c-1', 'redirect_uri' => 'https://planning.test/'], json_decode((string) $http->requests[0]['body'], true));
    }

    public function test_exchange_failure_throws(): void
    {
        $http = (new FakeHttpClient())->on('POST', self::GW . '/oauth/token', FakeHttpClient::json(400, ['error' => 'bad']));
        $this->expectException(\RuntimeException::class);
        $this->gateway($http)->exchangeCode('c-1');
    }

    public function test_liveness_live_dead_and_unknown(): void
    {
        $url = self::GW . '/oauth/introspect';
        $this->assertSame(Liveness::Live, $this->gateway((new FakeHttpClient())->on('POST', $url, FakeHttpClient::json(200, ['active' => true])))->liveness('s', 'u'));
        $this->assertSame(Liveness::Dead, $this->gateway((new FakeHttpClient())->on('POST', $url, FakeHttpClient::json(200, ['active' => false])))->liveness('s', 'u'));
        $this->assertSame(Liveness::Unknown, $this->gateway((new FakeHttpClient())->on('POST', $url, FakeHttpClient::json(503, [])))->liveness('s', 'u'));
        $this->assertSame(Liveness::Unknown, $this->gateway(new FakeHttpClient())->liveness('s', 'u'));
        $this->assertSame(Liveness::Unknown, $this->gateway((new FakeHttpClient())->on('POST', $url, new HttpResult(200, null)))->liveness('s', 'u'));
    }
}
```

`backend/tests/Unit/Auth/SessionCodecTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Auth;

use PHPUnit\Framework\TestCase;
use Planning\Auth\SessionCodec;
use Planning\Auth\SessionData;
use Planning\Config\ConfigError;
use Planning\Tests\Support\FixedClock;

final class SessionCodecTest extends TestCase
{
    private FixedClock $clock;
    private SessionCodec $codec;

    protected function setUp(): void
    {
        $this->clock = FixedClock::at('2026-10-13T00:00:00Z');
        $this->codec = new SessionCodec('0123456789abcdef0123456789abcdef', $this->clock);
    }

    public static function valueOf(string $setCookie): string
    {
        $start = strlen(SessionCodec::COOKIE) + 1;
        return substr($setCookie, $start, strpos($setCookie, ';') - $start);
    }

    private static function session(): SessionData
    {
        return new SessionData('sid-1', 'sub-1', 'ana@example.com', 'Ana Lim', 'user', 'EMP-1', 0);
    }

    public function test_round_trip(): void
    {
        $cookie = $this->codec->issue(self::session(), true);

        $this->assertStringContainsString('HttpOnly', $cookie);
        $this->assertStringContainsString('SameSite=Lax', $cookie);
        $this->assertStringContainsString('Secure', $cookie);
        $this->assertStringContainsString('Max-Age=900', $cookie);
        $decoded = $this->codec->decode(self::valueOf($cookie));
        $this->assertSame('EMP-1', $decoded?->employeeRef);
        $this->assertSame('user', $decoded?->gatewayRole);
    }

    public function test_tampering_is_rejected(): void
    {
        [$body, $mac] = explode('.', self::valueOf($this->codec->issue(self::session(), false)));
        $forged = json_decode((string) base64_decode(strtr($body, '-_', '+/')), true);
        $forged['role'] = 'admin';
        $forgedBody = rtrim(strtr(base64_encode((string) json_encode($forged)), '+/', '-_'), '=');
        $this->assertNull($this->codec->decode("$forgedBody.$mac"));
    }

    public function test_expired_session_is_rejected(): void
    {
        $value = self::valueOf($this->codec->issue(self::session(), false));
        $this->clock->advance(901);
        $this->assertNull($this->codec->decode($value));
    }

    public function test_missing_cookie_is_null(): void
    {
        $this->assertNull($this->codec->decode(null));
        $this->assertNull($this->codec->decode(''));
        $this->assertNull($this->codec->decode('no-dot'));
    }

    public function test_short_secret_is_a_config_error(): void
    {
        $this->expectException(ConfigError::class);
        new SessionCodec('too-short', $this->clock);
    }

    public function test_clear_cookie_expires_immediately(): void
    {
        $this->assertSame('planning_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax', $this->codec->clear(false));
    }
}
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `php vendor/bin/phpunit --filter "TokenVerifierTest|GatewayTest|SessionCodecTest"`
Expected: FAIL with class-not-found errors.

- [ ] **Step 5: Implement the HTTP client**

`backend/src/Support/HttpResult.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

final class HttpResult
{
    /** @param array<mixed>|null $json decoded body, or null when it was not JSON */
    public function __construct(public readonly int $status, public readonly ?array $json, public readonly bool $networkError = false)
    {
    }

    public static function failed(): self
    {
        return new self(0, null, true);
    }
}
```

`backend/src/Support/HttpClient.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

interface HttpClient
{
    /** @param list<string> $headers "Name: value" lines */
    public function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeoutSeconds = 5): HttpResult;
}
```

`backend/src/Support/CurlHttpClient.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

final class CurlHttpClient implements HttpClient
{
    public function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeoutSeconds = 5): HttpResult
    {
        $headers[] = 'Accept: application/json';
        if (RequestContext::$correlationId !== null) {
            $headers[] = 'X-Correlation-ID: ' . RequestContext::$correlationId; // contract SS-4: forward it
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_CONNECTTIMEOUT => min($timeoutSeconds, 4),
            CURLOPT_TIMEOUT => $timeoutSeconds,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        if ($raw === false || curl_errno($ch) !== 0) {
            return HttpResult::failed();
        }
        $json = json_decode((string) $raw, true);
        return new HttpResult((int) curl_getinfo($ch, CURLINFO_HTTP_CODE), is_array($json) ? $json : null);
    }
}
```

- [ ] **Step 6: Implement token verification**

`backend/src/Auth/TokenInvalid.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

final class TokenInvalid extends \RuntimeException
{
}
```

`backend/src/Auth/JwksSource.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

interface JwksSource
{
    /** @return list<array<string,mixed>> the gateway's public JWKs */
    public function keys(bool $refresh = false): array;
}
```

`backend/src/Auth/HttpJwksSource.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

use Planning\Support\HttpClient;

/** Fetched once per process (auth guide §3, performance guide §5c); refetched only for an unknown key id. */
final class HttpJwksSource implements JwksSource
{
    /** @var array<string, list<array<string,mixed>>> */
    private static array $cache = [];

    public function __construct(private readonly HttpClient $http, private readonly string $gatewayUrl)
    {
    }

    public function keys(bool $refresh = false): array
    {
        if ($refresh || !isset(self::$cache[$this->gatewayUrl])) {
            $result = $this->http->request('GET', $this->gatewayUrl . '/.well-known/jwks.json');
            $keys = $result->json['keys'] ?? null;
            if ($result->status !== 200 || !is_array($keys)) {
                throw new TokenInvalid('Could not fetch the gateway\'s signing keys.');
            }
            self::$cache[$this->gatewayUrl] = array_values(array_filter($keys, 'is_array'));
        }
        return self::$cache[$this->gatewayUrl];
    }
}
```

`backend/src/Auth/TokenVerifier.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

/**
 * Verifies gateway tokens (RS256) per contract SS-25 and auth guide §3:
 * signature, token_use, exp, iss, aud, failing closed on any of them.
 * openssl_verify() does the cryptography; only the JWK-to-PEM wrapping is
 * hand-written (ported from hr-recruitment-demo backend/support/Jwt.php).
 */
final class TokenVerifier
{
    public function __construct(
        private readonly JwksSource $jwks,
        private readonly string $issuer,
        private readonly string $audience,
    ) {
    }

    /** @return array<string,mixed> */
    public function verify(string $token, string $expectedUse): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new TokenInvalid('Malformed token.');
        }
        [$headerB64, $payloadB64, $signatureB64] = $parts;

        $header = json_decode(self::b64decode($headerB64), true);
        if (!is_array($header) || ($header['alg'] ?? null) !== 'RS256') {
            throw new TokenInvalid('Unexpected algorithm "' . (is_array($header) ? (string) ($header['alg'] ?? 'none') : 'none') . '".');
        }

        $kid = (string) ($header['kid'] ?? '');
        $jwk = $this->findKey($kid, false) ?? $this->findKey($kid, true);
        if ($jwk === null) {
            throw new TokenInvalid("No key \"$kid\" in the gateway's key set.");
        }
        $publicKey = openssl_pkey_get_public(self::jwkToPem($jwk));
        if ($publicKey === false) {
            throw new TokenInvalid('Could not load the gateway\'s public key.');
        }
        if (openssl_verify("$headerB64.$payloadB64", self::b64decode($signatureB64), $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
            throw new TokenInvalid('Signature does not verify.');
        }

        $claims = json_decode(self::b64decode($payloadB64), true);
        if (!is_array($claims)) {
            throw new TokenInvalid('Malformed token payload.');
        }
        // Not optional: identity and access tokens share a key and an audience (auth guide §3).
        if (($claims['token_use'] ?? null) !== $expectedUse) {
            throw new TokenInvalid('Expected a "' . $expectedUse . '" token, got "' . (string) ($claims['token_use'] ?? 'none') . '".');
        }
        if (!is_int($claims['exp'] ?? null) || $claims['exp'] < time()) {
            throw new TokenInvalid('Token has expired.');
        }
        if (($claims['iss'] ?? null) !== rtrim($this->issuer, '/')) {
            throw new TokenInvalid('Unexpected issuer "' . (string) ($claims['iss'] ?? '') . '".');
        }
        if (($claims['aud'] ?? null) !== $this->audience) {
            throw new TokenInvalid('Token was not minted for "' . $this->audience . '".');
        }
        return $claims;
    }

    /** @return array<string,mixed>|null */
    private function findKey(string $kid, bool $refresh): ?array
    {
        foreach ($this->jwks->keys($refresh) as $key) {
            if (($key['kid'] ?? null) === $kid) {
                return $key;
            }
        }
        return null;
    }

    private static function b64decode(string $data): string
    {
        $padded = str_pad($data, strlen($data) + (4 - strlen($data) % 4) % 4, '=');
        return (string) base64_decode(strtr($padded, '-_', '+/'));
    }

    /** @param array<string,mixed> $jwk */
    public static function jwkToPem(array $jwk): string
    {
        if (($jwk['kty'] ?? '') !== 'RSA') {
            throw new TokenInvalid('Unsupported key type "' . (string) ($jwk['kty'] ?? '') . '".');
        }
        $rsaPublicKey = self::sequence(self::integer(self::b64decode((string) $jwk['n'])) . self::integer(self::b64decode((string) $jwk['e'])));
        // AlgorithmIdentifier: rsaEncryption OID 1.2.840.113549.1.1.1 with NULL parameters
        $algorithm = self::sequence("\x06\x09\x2A\x86\x48\x86\xF7\x0D\x01\x01\x01\x05\x00");
        $bitString = "\x03" . self::length(strlen($rsaPublicKey) + 1) . "\x00" . $rsaPublicKey;
        $spki = self::sequence($algorithm . $bitString);
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }

    private static function length(int $length): string
    {
        if ($length < 128) {
            return chr($length);
        }
        $bytes = ltrim(pack('N', $length), "\x00");
        return chr(0x80 | strlen($bytes)) . $bytes;
    }

    private static function integer(string $bytes): string
    {
        $bytes = ltrim($bytes, "\x00");
        if ($bytes === '' || (ord($bytes[0]) & 0x80)) {
            $bytes = "\x00" . $bytes; // keep it non-negative
        }
        return "\x02" . self::length(strlen($bytes)) . $bytes;
    }

    private static function sequence(string $contents): string
    {
        return "\x30" . self::length(strlen($contents)) . $contents;
    }
}
```

- [ ] **Step 7: Implement the gateway client**

`backend/src/Auth/Liveness.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

enum Liveness
{
    case Live;
    case Dead;
    /** The gateway could not be asked. Treated as live (fail open, auth guide §5) but never extends the session. */
    case Unknown;
}
```

`backend/src/Auth/SessionLiveness.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

interface SessionLiveness
{
    public function liveness(string $sid, string $sub): Liveness;
}
```

`backend/src/Auth/Gateway.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

use Planning\Support\HttpClient;

/** Calls this app makes to the InterlinkERP gateway (auth guide §1, §4, §5). URLs come from config only (§8). */
final class Gateway implements SessionLiveness
{
    public function __construct(
        private readonly HttpClient $http,
        private readonly string $gatewayUrl,
        private readonly string $publicUrl,
    ) {
    }

    public function authorizeUrl(string $returnPath): string
    {
        $url = $this->gatewayUrl . '/oauth/authorize?redirect_uri=' . rawurlencode($this->publicUrl . '/');
        if ($returnPath !== '/' && $returnPath !== '') {
            $url .= '&state=' . rawurlencode($returnPath);
        }
        return $url;
    }

    /** Server-to-server code exchange (auth guide §4 step 4). Returns the identity token. */
    public function exchangeCode(string $code): string
    {
        $result = $this->http->request(
            'POST',
            $this->gatewayUrl . '/oauth/token',
            ['Content-Type: application/json'],
            json_encode(['code' => $code, 'redirect_uri' => $this->publicUrl . '/'], JSON_THROW_ON_ERROR),
        );
        $token = $result->json['token'] ?? null;
        if ($result->status !== 200 || !is_string($token) || $token === '') {
            throw new \RuntimeException("The gateway did not accept the sign-in code (HTTP {$result->status}).");
        }
        return $token;
    }

    /** Auth guide §5: on every request, no cache. Network or server trouble is Unknown (fail open). */
    public function liveness(string $sid, string $sub): Liveness
    {
        $result = $this->http->request(
            'POST',
            $this->gatewayUrl . '/oauth/introspect',
            ['Content-Type: application/json'],
            json_encode(['sid' => $sid, 'sub' => $sub], JSON_THROW_ON_ERROR),
            4,
        );
        if ($result->networkError || $result->status !== 200 || $result->json === null) {
            return Liveness::Unknown;
        }
        return !empty($result->json['active']) ? Liveness::Live : Liveness::Dead;
    }
}
```

- [ ] **Step 8: Implement the session cookie**

`backend/src/Auth/SessionData.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

/** What Planning keeps about a signed-in person. Never the identity token itself. */
final class SessionData
{
    public function __construct(
        public readonly string $sid,
        public readonly string $sub,
        public readonly string $email,
        public readonly string $name,
        public readonly string $gatewayRole,
        public readonly ?string $employeeRef,
        public readonly int $expiresAt,
    ) {
    }

    public function withExpiry(int $expiresAt): self
    {
        return new self($this->sid, $this->sub, $this->email, $this->name, $this->gatewayRole, $this->employeeRef, $expiresAt);
    }

    /** @return array<string, string|int|null> */
    public function toArray(): array
    {
        return ['sid' => $this->sid, 'sub' => $this->sub, 'email' => $this->email, 'name' => $this->name, 'role' => $this->gatewayRole, 'ref' => $this->employeeRef, 'exp' => $this->expiresAt];
    }

    /** @param array<mixed> $data */
    public static function fromArray(array $data): ?self
    {
        foreach (['sid', 'sub', 'email', 'name', 'role'] as $key) {
            if (!is_string($data[$key] ?? null)) {
                return null;
            }
        }
        $ref = $data['ref'] ?? null;
        if (!is_int($data['exp'] ?? null) || !($ref === null || is_string($ref))) {
            return null;
        }
        return new self($data['sid'], $data['sub'], $data['email'], $data['name'], $data['role'], $ref, $data['exp']);
    }
}
```

`backend/src/Auth/SessionCodec.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

use Planning\Config\ConfigError;
use Planning\Support\Clock;

/** HMAC-signed, HttpOnly, 15-minute session cookie (auth guide §6). */
final class SessionCodec
{
    public const COOKIE = 'planning_session';
    public const TTL_SECONDS = 900;

    public function __construct(private readonly string $secret, private readonly Clock $clock)
    {
        if (strlen($secret) < 32) {
            throw new ConfigError('SESSION_SECRET must be at least 32 characters.');
        }
    }

    public function decode(?string $cookieValue): ?SessionData
    {
        if ($cookieValue === null || !str_contains($cookieValue, '.')) {
            return null;
        }
        [$body, $mac] = explode('.', $cookieValue, 2);
        if (!hash_equals(hash_hmac('sha256', $body, $this->secret), $mac)) {
            return null;
        }
        $padded = str_pad($body, strlen($body) + (4 - strlen($body) % 4) % 4, '=');
        $data = json_decode((string) base64_decode(strtr($padded, '-_', '+/')), true);
        $session = is_array($data) ? SessionData::fromArray($data) : null;
        if ($session === null || $session->expiresAt <= $this->clock->now()->getTimestamp()) {
            return null;
        }
        return $session;
    }

    /** A fresh cookie that expires TTL_SECONDS from now. */
    public function issue(SessionData $session, bool $secure): string
    {
        $session = $session->withExpiry($this->clock->now()->getTimestamp() + self::TTL_SECONDS);
        $body = rtrim(strtr(base64_encode(json_encode($session->toArray(), JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
        return self::cookie($body . '.' . hash_hmac('sha256', $body, $this->secret), self::TTL_SECONDS, $secure);
    }

    public function clear(bool $secure): string
    {
        return self::cookie('', 0, $secure);
    }

    private static function cookie(string $value, int $maxAge, bool $secure): string
    {
        return self::COOKIE . '=' . $value . '; Path=/; Max-Age=' . $maxAge . '; HttpOnly; SameSite=Lax' . ($secure ? '; Secure' : '');
    }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "TokenVerifierTest|GatewayTest|SessionCodecTest"`
Expected: PASS (`TokenVerifierTest` 1 test + 8 data sets, `GatewayTest` 4, `SessionCodecTest` 6).

- [ ] **Step 10: Commit**

```bash
git add backend/src/Support backend/src/Auth backend/tests/Support backend/tests/fixtures backend/tests/Unit/Auth
git commit -m "feat: verify gateway tokens and add signed session cookie"
```

---

### Task 6: Access guard, Planning Managers and `/api/me`

**Files:**
- Create: `backend/src/Support/Time.php`
- Create: `backend/src/Auth/ManagerDirectory.php`, `DevIdentity.php`, `GatewayAccessGuard.php`
- Create: `backend/src/Repo/ManagerRepository.php`, `backend/src/Http/Controllers/MeController.php`
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`, `ListOfRequirements.md`
- Test: `backend/tests/Unit/Auth/GatewayAccessGuardTest.php`, `backend/tests/Integration/Repo/ManagerRepositoryTest.php`

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces:
  - `Time::utc()`, `Time::iso(\DateTimeImmutable): string`, `Time::db(\DateTimeImmutable): string`, `Time::fromDb(string): \DateTimeImmutable`, `Time::localMidnight(string $date, \DateTimeZone): \DateTimeImmutable`, `Time::isTimezone(string): bool`.
  - `ManagerDirectory::isManager(string $email): bool`.
  - `ManagerRepository(\PDO, string $org)` implements `ManagerDirectory`. Methods: `->all(): list<array{email, granted_by, granted_at}>`, `->grant(string $email, string $grantedBy, \DateTimeImmutable $at): bool` (false if already listed), `->revoke(string $email): bool`, `->count(): int`.
  - `DevIdentity(SessionData)`, `DevIdentity::fromEnv(): ?DevIdentity`, `->allows(Request): bool`, `->session(): SessionData`.
  - `GatewayAccessGuard(SessionCodec, SessionLiveness, TokenVerifier, ManagerDirectory, ?DevIdentity, bool $secureCookies)` implements `AccessGuard`.
  - `GET /api/me` returns `{name, email, gateway_role, employee_ref, is_manager}`. Task 12 adds `timezone` and `organisation_timezone`.
  - `App` getters: `http()`, `gatewayUrl()`, `publicUrl()`, `secureCookies()`, `jwks()`, `tokenVerifier()`, `gateway()`, `sessions()`, `devIdentity()`, `managers()`, `meController()`.

**Why email and not `sub`:** BR-12 in the spec says the manager list holds the gateway `sub`. A manager grants access by picking someone from the roster, and the roster only knows email addresses. Nobody's gateway `sub` is known until that person signs in. The identity token's `email` claim is signed by the gateway, so keying the list by email still means "gateway identity". Step 1 updates the spec to match.

- [ ] **Step 1: Amend the spec**

In `ListOfRequirements.md`:
- Change the version row to `| Version | 0.3 (draft, reviewed) |`.
- In **BR-12**, replace ``or their gateway identity (`sub`) is in Planning's manager list`` with `or the email address in their gateway-verified identity token is in Planning's manager list`.
- In **FR-ACC-03**, replace `stored by their gateway identity` with `stored by the email address the gateway verifies at sign-in (the roster does not know gateway sub ids)`.
- In **DR-01**, replace ``Manager grant (gateway `sub`, email at time of grant, granted by, granted at)`` with `Manager grant (email, granted by, granted at)`.

- [ ] **Step 2: Write the failing tests**

`backend/tests/Unit/Auth/GatewayAccessGuardTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Auth;

use PHPUnit\Framework\TestCase;
use Planning\Auth\DevIdentity;
use Planning\Auth\GatewayAccessGuard;
use Planning\Auth\Liveness;
use Planning\Auth\ManagerDirectory;
use Planning\Auth\SessionCodec;
use Planning\Auth\SessionData;
use Planning\Auth\SessionLiveness;
use Planning\Auth\TokenVerifier;
use Planning\Http\HttpError;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Http\Route;
use Planning\Tests\Support\FixedClock;
use Planning\Tests\Support\TestTokens;

final class GatewayAccessGuardTest extends TestCase
{
    private SessionCodec $codec;
    public Liveness $liveness = Liveness::Live;
    /** @var list<string> */
    public array $managerEmails = [];

    protected function setUp(): void
    {
        $this->codec = new SessionCodec(str_repeat('s', 32), FixedClock::at('2026-10-13T00:00:00Z'));
    }

    private function guard(?DevIdentity $dev = null): GatewayAccessGuard
    {
        $liveness = new class ($this) implements SessionLiveness {
            public function __construct(private readonly GatewayAccessGuardTest $test)
            {
            }

            public function liveness(string $sid, string $sub): Liveness
            {
                return $this->test->liveness;
            }
        };
        $managers = new class ($this) implements ManagerDirectory {
            public function __construct(private readonly GatewayAccessGuardTest $test)
            {
            }

            public function isManager(string $email): bool
            {
                return in_array($email, $this->test->managerEmails, true);
            }
        };
        return new GatewayAccessGuard($this->codec, $liveness, new TokenVerifier(TestTokens::jwks(), TestTokens::ISSUER, TestTokens::AUDIENCE), $managers, $dev, true);
    }

    private static function route(string $access, string $method = 'GET'): Route
    {
        return new Route($method, '/api/x', $access, 'X', static fn () => Response::noContent());
    }

    private function cookieRequest(string $role = 'user', string $email = 'ana@example.com'): Request
    {
        $value = SessionCodecTest::valueOf($this->codec->issue(new SessionData('sid-1', 'sub-1', $email, 'Ana', $role, 'EMP-1', 0), true));
        return new Request('GET', '/api/x', cookies: ['planning_session' => $value]);
    }

    private function expectHttp(int $status, string $code, \Closure $call): HttpError
    {
        try {
            $call();
        } catch (HttpError $e) {
            $this->assertSame($status, $e->status);
            $this->assertSame($code, $e->errorCode);
            return $e;
        }
        $this->fail("Expected HTTP $status");
    }

    public function test_public_routes_need_nothing(): void
    {
        $this->assertNull($this->guard()->check(self::route(Route::PUBLIC), new Request('GET', '/health'))->principal);
    }

    public function test_no_session_is_401(): void
    {
        $this->expectHttp(401, 'UNAUTHORIZED', fn () => $this->guard()->check(self::route(Route::PERSON), new Request('GET', '/api/x')));
    }

    public function test_a_forged_identity_header_is_ignored(): void
    {
        $request = new Request('GET', '/api/x', headers: ['x-authenticated-user' => 'admin@example.com', 'x-user-role' => 'admin']);
        $this->expectHttp(401, 'UNAUTHORIZED', fn () => $this->guard()->check(self::route(Route::MANAGER), $request));
    }

    public function test_live_session_gives_a_principal_and_a_fresh_cookie(): void
    {
        $result = $this->guard()->check(self::route(Route::PERSON), $this->cookieRequest());

        $this->assertSame('ana@example.com', $result->principal?->email);
        $this->assertSame('EMP-1', $result->principal?->employeeRef);
        $this->assertFalse($result->principal?->isManager);
        $this->assertCount(1, $result->cookies);
    }

    public function test_unknown_liveness_allows_but_does_not_extend(): void
    {
        $this->liveness = Liveness::Unknown;
        $result = $this->guard()->check(self::route(Route::PERSON), $this->cookieRequest());
        $this->assertNotNull($result->principal);
        $this->assertSame([], $result->cookies);
    }

    public function test_dead_gateway_session_is_401_and_clears_the_cookie(): void
    {
        $this->liveness = Liveness::Dead;
        $e = $this->expectHttp(401, 'UNAUTHORIZED', fn () => $this->guard()->check(self::route(Route::PERSON), $this->cookieRequest()));
        $this->assertStringContainsString('Max-Age=0', $e->headers['Set-Cookie']);
    }

    public function test_employee_cannot_use_manager_routes(): void
    {
        $this->expectHttp(403, 'FORBIDDEN', fn () => $this->guard()->check(self::route(Route::MANAGER), $this->cookieRequest()));
    }

    public function test_gateway_admin_is_a_manager(): void
    {
        $this->assertTrue($this->guard()->check(self::route(Route::MANAGER), $this->cookieRequest('admin'))->principal?->isManager);
    }

    public function test_listed_email_is_a_manager_and_matching_ignores_case(): void
    {
        $this->managerEmails = ['ana@example.com'];
        $this->assertTrue($this->guard()->check(self::route(Route::MANAGER), $this->cookieRequest('user', 'Ana@Example.com'))->principal?->isManager);
    }

    public function test_missing_role_never_grants_manager(): void
    {
        $this->expectHttp(403, 'FORBIDDEN', fn () => $this->guard()->check(self::route(Route::MANAGER), $this->cookieRequest('')));
    }

    public function test_bearer_token_with_scope_is_a_client(): void
    {
        $token = TestTokens::make(['token_use' => 'access', 'scope' => 'planning:read planning:write', 'sub' => 'client-9']);
        $request = new Request('POST', '/api/x', headers: ['authorization' => "Bearer $token"]);

        $principal = $this->guard()->check(self::route(Route::MANAGER, 'POST'), $request)->principal;

        $this->assertSame('client', $principal?->kind);
        $this->assertSame('client:client-9', $principal?->actorId());
    }

    public function test_bearer_token_without_the_scope_is_403(): void
    {
        $token = TestTokens::make(['token_use' => 'access', 'scope' => 'planning:read']);
        $request = new Request('POST', '/api/x', headers: ['authorization' => "Bearer $token"]);
        $e = $this->expectHttp(403, 'FORBIDDEN', fn () => $this->guard()->check(self::route(Route::MANAGER, 'POST'), $request));
        $this->assertSame(['required' => ['planning:write'], 'granted' => ['planning:read']], $e->details);
    }

    public function test_bearer_token_on_a_person_route_is_403(): void
    {
        $token = TestTokens::make(['token_use' => 'access', 'scope' => 'planning:read']);
        $request = new Request('GET', '/api/x', headers: ['authorization' => "Bearer $token"]);
        $this->expectHttp(403, 'PERSON_REQUIRED', fn () => $this->guard()->check(self::route(Route::PERSON), $request));
    }

    public function test_an_identity_token_is_not_accepted_as_a_bearer_token(): void
    {
        $request = new Request('GET', '/api/x', headers: ['authorization' => 'Bearer ' . TestTokens::make()]);
        $this->expectHttp(401, 'UNAUTHORIZED', fn () => $this->guard()->check(self::route(Route::MANAGER), $request));
    }

    public function test_dev_identity_only_for_direct_loopback_requests(): void
    {
        $dev = new DevIdentity(new SessionData('dev', 'dev:dev@example.com', 'dev@example.com', 'Dev', 'admin', null, PHP_INT_MAX));
        $local = new Request('GET', '/api/x', server: ['REMOTE_ADDR' => '127.0.0.1']);
        $proxied = new Request('GET', '/api/x', headers: ['x-forwarded-for' => '203.0.113.9'], server: ['REMOTE_ADDR' => '127.0.0.1']);
        $remote = new Request('GET', '/api/x', server: ['REMOTE_ADDR' => '203.0.113.9']);

        $this->assertTrue($this->guard($dev)->check(self::route(Route::MANAGER), $local)->principal?->isManager);
        $this->expectHttp(401, 'UNAUTHORIZED', fn () => $this->guard($dev)->check(self::route(Route::PERSON), $proxied));
        $this->expectHttp(401, 'UNAUTHORIZED', fn () => $this->guard($dev)->check(self::route(Route::PERSON), $remote));
    }
}
```

`backend/tests/Integration/Repo/ManagerRepositoryTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Repo;

use Planning\Repo\ManagerRepository;
use Planning\Tests\Support\DatabaseTestCase;

final class ManagerRepositoryTest extends DatabaseTestCase
{
    public function test_grant_check_list_and_revoke(): void
    {
        $repo = new ManagerRepository($this->pdo(), self::ORG);
        $at = new \DateTimeImmutable('2026-10-13T00:00:00Z');

        $this->assertTrue($repo->grant('Bo@Example.com', 'admin@example.com', $at));
        $this->assertFalse($repo->grant('bo@example.com', 'admin@example.com', $at), 'second grant is a no-op');
        $this->assertTrue($repo->isManager('BO@example.com'));
        $this->assertSame([['email' => 'bo@example.com', 'granted_by' => 'admin@example.com', 'granted_at' => '2026-10-13T00:00:00Z']], $repo->all());
        $this->assertSame(1, $repo->count());

        $this->assertTrue($repo->revoke('bo@example.com'));
        $this->assertFalse($repo->revoke('bo@example.com'));
        $this->assertFalse($repo->isManager('bo@example.com'));
    }

    public function test_other_organisations_are_invisible(): void
    {
        (new ManagerRepository($this->pdo(), 'other-org'))->grant('bo@example.com', 'x', new \DateTimeImmutable());
        $this->assertFalse((new ManagerRepository($this->pdo(), self::ORG))->isManager('bo@example.com'));
        $this->pdo()->exec("DELETE FROM planning_managers WHERE organisation_id = 'other-org'");
    }
}
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `php vendor/bin/phpunit --filter "GatewayAccessGuardTest|ManagerRepositoryTest"`
Expected: FAIL with class-not-found errors.

- [ ] **Step 4: Add the time helper every repository uses**

`backend/src/Support/Time.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Support;

final class Time
{
    public static function utc(): \DateTimeZone
    {
        static $utc = null;
        return $utc ??= new \DateTimeZone('UTC');
    }

    /** API format: 2026-10-13T09:00:00Z */
    public static function iso(\DateTimeImmutable $t): string
    {
        return $t->setTimezone(self::utc())->format('Y-m-d\TH:i:s\Z');
    }

    /** MySQL DATETIME, UTC. */
    public static function db(\DateTimeImmutable $t): string
    {
        return $t->setTimezone(self::utc())->format('Y-m-d H:i:s');
    }

    public static function fromDb(string $value): \DateTimeImmutable
    {
        return new \DateTimeImmutable($value, self::utc());
    }

    public static function localMidnight(string $date, \DateTimeZone $tz): \DateTimeImmutable
    {
        return new \DateTimeImmutable($date . ' 00:00:00', $tz);
    }

    public static function isTimezone(string $tz): bool
    {
        return in_array($tz, \DateTimeZone::listIdentifiers(), true);
    }
}
```

- [ ] **Step 5: Implement the manager list**

`backend/src/Auth/ManagerDirectory.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

interface ManagerDirectory
{
    public function isManager(string $email): bool;
}
```

`backend/src/Repo/ManagerRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Auth\ManagerDirectory;
use Planning\Support\Time;

/** Planning's own manager list (BR-12, FR-ACC-03), keyed by lower-cased email. */
final class ManagerRepository implements ManagerDirectory
{
    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    public function isManager(string $email): bool
    {
        $st = $this->pdo->prepare('SELECT 1 FROM planning_managers WHERE organisation_id = ? AND email = ?');
        $st->execute([$this->org, strtolower(trim($email))]);
        return $st->fetchColumn() !== false;
    }

    /** @return list<array{email: string, granted_by: string, granted_at: string}> */
    public function all(): array
    {
        $st = $this->pdo->prepare('SELECT email, granted_by, granted_at FROM planning_managers WHERE organisation_id = ? ORDER BY email');
        $st->execute([$this->org]);
        return array_map(static fn (array $r): array => [
            'email' => $r['email'],
            'granted_by' => $r['granted_by'],
            'granted_at' => Time::iso(Time::fromDb($r['granted_at'])),
        ], $st->fetchAll());
    }

    public function grant(string $email, string $grantedBy, \DateTimeImmutable $at): bool
    {
        $st = $this->pdo->prepare('INSERT IGNORE INTO planning_managers (organisation_id, email, granted_by, granted_at) VALUES (?, ?, ?, ?)');
        $st->execute([$this->org, strtolower(trim($email)), $grantedBy, Time::db($at)]);
        return $st->rowCount() === 1;
    }

    public function revoke(string $email): bool
    {
        $st = $this->pdo->prepare('DELETE FROM planning_managers WHERE organisation_id = ? AND email = ?');
        $st->execute([$this->org, strtolower(trim($email))]);
        return $st->rowCount() === 1;
    }

    public function count(): int
    {
        $st = $this->pdo->prepare('SELECT COUNT(*) FROM planning_managers WHERE organisation_id = ?');
        $st->execute([$this->org]);
        return (int) $st->fetchColumn();
    }
}
```

- [ ] **Step 6: Implement the developer identity and the guard**

`backend/src/Auth/DevIdentity.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

use Planning\Config\Env;
use Planning\Http\Request;

/**
 * Local development sign-in. 127.0.0.1 is not a redirect_uri the gateway
 * knows, so real sign-in is impossible locally. Only active with
 * APP_ENV=development, never on Vercel, and only for requests that reached
 * this machine directly from loopback with no proxy headers.
 */
final class DevIdentity
{
    private const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'x-vercel-id', 'forwarded'];

    public function __construct(private readonly SessionData $session)
    {
    }

    public static function fromEnv(): ?self
    {
        if (Env::get('APP_ENV') !== 'development' || Env::get('VERCEL') !== null) {
            return null;
        }
        $email = strtolower(Env::get('DEV_USER_EMAIL', 'dev@example.com') ?? 'dev@example.com');
        return new self(new SessionData(
            'dev-session',
            'dev:' . $email,
            $email,
            Env::get('DEV_USER_NAME', 'Local Developer') ?? 'Local Developer',
            Env::get('DEV_USER_ROLE', 'user') ?? 'user',
            Env::get('DEV_EMPLOYEE_REF'),
            PHP_INT_MAX,
        ));
    }

    public function allows(Request $request): bool
    {
        if (!in_array($request->server['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
            return false;
        }
        foreach (self::PROXY_HEADERS as $header) {
            if ($request->header($header) !== null) {
                return false;
            }
        }
        return true;
    }

    public function session(): SessionData
    {
        return $this->session;
    }
}
```

`backend/src/Auth/GatewayAccessGuard.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Auth;

use Planning\Http\AccessGuard;
use Planning\Http\AccessResult;
use Planning\Http\HttpError;
use Planning\Http\Request;
use Planning\Http\Route;

/**
 * Who is calling, and may they use this route?
 *  - Programs send a gateway access token (contract SS-6, SS-25) and need the route's scope.
 *  - People carry Planning's session cookie, re-checked with the gateway on every request.
 * Identity never comes from any other header (auth guide §3).
 */
final class GatewayAccessGuard implements AccessGuard
{
    public function __construct(
        private readonly SessionCodec $sessions,
        private readonly SessionLiveness $liveness,
        private readonly TokenVerifier $tokens,
        private readonly ManagerDirectory $managers,
        private readonly ?DevIdentity $dev,
        private readonly bool $secureCookies,
    ) {
    }

    public function check(Route $route, Request $request): AccessResult
    {
        if ($route->access === Route::PUBLIC || $route->access === Route::INTERNAL) {
            return new AccessResult(null);
        }

        $bearer = self::bearer($request);
        if ($bearer !== null) {
            return new AccessResult($this->client($route, $bearer));
        }

        [$principal, $cookies] = $this->person($request);
        if ($route->access === Route::MANAGER && !$principal->isManager) {
            throw HttpError::forbidden('Only Planning Managers can do this.');
        }
        return new AccessResult($principal, $cookies);
    }

    private function client(Route $route, string $token): Principal
    {
        try {
            $claims = $this->tokens->verify($token, 'access');
        } catch (TokenInvalid $e) {
            throw HttpError::unauthorized($e->getMessage());
        }
        $scopes = array_values(array_filter(explode(' ', (string) ($claims['scope'] ?? ''))));
        if ($route->access === Route::PERSON) {
            throw HttpError::forbidden('This endpoint is only for signed-in people.', 'PERSON_REQUIRED');
        }
        if (!in_array($route->scope(), $scopes, true)) {
            throw HttpError::forbidden("This endpoint needs {$route->scope()}.", 'FORBIDDEN', ['required' => [$route->scope()], 'granted' => $scopes]);
        }
        return new Principal('client', (string) ($claims['sub'] ?? 'unknown'), scopes: $scopes);
    }

    /** @return array{0: Principal, 1: list<string>} */
    private function person(Request $request): array
    {
        if ($this->dev !== null && $this->dev->allows($request)) {
            return [$this->principalFor($this->dev->session()), []];
        }

        $session = $this->sessions->decode($request->cookies[SessionCodec::COOKIE] ?? null);
        if ($session === null) {
            throw HttpError::unauthorized('Sign in through the InterlinkERP gateway first.');
        }

        $liveness = $this->liveness->liveness($session->sid, $session->sub);
        if ($liveness === Liveness::Dead) {
            throw new HttpError(401, 'UNAUTHORIZED', 'Your InterlinkERP session has ended.', null, ['Set-Cookie' => $this->sessions->clear($this->secureCookies)]);
        }
        // Only extend the session when the gateway confirmed it (auth guide §6 backstop).
        $cookies = $liveness === Liveness::Live ? [$this->sessions->issue($session, $this->secureCookies)] : [];
        return [$this->principalFor($session), $cookies];
    }

    /** BR-12: gateway admin, or listed email. Anything else, including no role, is not a manager. */
    private function principalFor(SessionData $session): Principal
    {
        $email = strtolower(trim($session->email));
        $isManager = $session->gatewayRole === 'admin' || ($email !== '' && $this->managers->isManager($email));
        return new Principal('person', $session->sub, $email, $session->name, $session->gatewayRole, $session->employeeRef, $isManager);
    }

    private static function bearer(Request $request): ?string
    {
        return preg_match('/^Bearer\s+(\S+)$/i', (string) $request->header('authorization'), $m) ? $m[1] : null;
    }
}
```

- [ ] **Step 7: Add `/api/me`**

`backend/src/Http/Controllers/MeController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Auth\Principal;
use Planning\Http\Request;
use Planning\Http\Response;

final class MeController
{
    /** @param array<string,string> $params */
    public function show(Request $request, array $params, ?Principal $me): Response
    {
        return Response::json(200, [
            'name' => $me?->name,
            'email' => $me?->email,
            'gateway_role' => $me?->gatewayRole,
            'employee_ref' => $me?->employeeRef,
            'is_manager' => $me?->isManager ?? false,
        ]);
    }
}
```

In `backend/src/routes.php`, add before `return $router;`:

```php
    $router->add('GET', '/api/me', Route::PERSON, 'Show who is signed in and what they may do in Planning.', $to('meController', 'show'), Doc::op(
        'Show Current User', 'Find out who is signed in and whether they manage planning',
        ['Deciding which screens to show after sign-in'], ['Listing employees', 'Reading shifts'],
        [], ['name', 'email', 'employee_ref', 'is_manager', 'timezone'], ['Signed-in person'], ['GET /api/my/shifts', 'GET /api/schedule'],
        ['me', 'profile', 'current user', 'whoami', 'permissions'],
    ));
```

In `backend/src/catalog.php`, set `'capabilities'` to:

```php
    'capabilities' => [
        [
            'name' => 'Check Access',
            'icon' => '🔑',
            'description' => 'See who is signed in and whether they can manage planning.',
            'does' => ['See who is signed in', 'Check if someone is a Planning Manager'],
            'best_for' => 'Screens that change depending on who is looking.',
            'endpoints' => ['GET /api/me'],
        ],
    ],
```

- [ ] **Step 8: Wire the guard into `App`**

In `backend/src/App.php`:

1. Replace `REQUIRED_ENV` with:

```php
    public const REQUIRED_ENV = ['SERVICE_ID', 'OPENAPI_EXTENSION_KEY', 'DB_HOST', 'DB_NAME', 'DB_USER', 'GATEWAY_URL', 'PUBLIC_URL', 'SESSION_SECRET'];
```

2. Replace the whole `guard()` method with:

```php
    public function guard(): AccessGuard
    {
        return $this->once('guard', fn () => new GatewayAccessGuard(
            $this->sessions(),
            $this->gateway(),
            $this->tokenVerifier(),
            $this->managers(),
            $this->devIdentity(),
            $this->secureCookies(),
        ));
    }
```

3. Add `use` lines for these classes:
   - `Planning\Auth\DevIdentity`, `Gateway`, `GatewayAccessGuard`, `HttpJwksSource`, `JwksSource`, `SessionCodec`, `TokenVerifier`
   - `Planning\Http\Controllers\MeController`
   - `Planning\Repo\ManagerRepository`
   - `Planning\Support\CurlHttpClient`, `HttpClient`

   Then remove `use Planning\Http\PublicOnlyGuard;` and add the getters below.

```php
    public function http(): HttpClient
    {
        return $this->once('http', static fn () => new CurlHttpClient());
    }

    public function gatewayUrl(): string
    {
        return rtrim(Env::require('GATEWAY_URL'), '/');
    }

    public function publicUrl(): string
    {
        return rtrim(Env::require('PUBLIC_URL'), '/');
    }

    public function secureCookies(): bool
    {
        return str_starts_with($this->publicUrl(), 'https://');
    }

    public function jwks(): JwksSource
    {
        return $this->once('jwks', fn () => new HttpJwksSource($this->http(), $this->gatewayUrl()));
    }

    public function tokenVerifier(): TokenVerifier
    {
        return $this->once('tokenVerifier', fn () => new TokenVerifier($this->jwks(), $this->gatewayUrl(), $this->serviceInfo()->serviceId));
    }

    public function gateway(): Gateway
    {
        return $this->once('gateway', fn () => new Gateway($this->http(), $this->gatewayUrl(), $this->publicUrl()));
    }

    public function sessions(): SessionCodec
    {
        return $this->once('sessions', fn () => new SessionCodec(Env::require('SESSION_SECRET'), $this->clock()));
    }

    public function devIdentity(): ?DevIdentity
    {
        return $this->once('devIdentity', static fn () => DevIdentity::fromEnv());
    }

    public function managers(): ManagerRepository
    {
        return $this->once('managers', fn () => new ManagerRepository($this->pdo(), $this->organisationId()));
    }

    public function meController(): MeController
    {
        return $this->once('meController', static fn () => new MeController());
    }
```

`PublicOnlyGuard` stays in the code as a safe default for any future entry point that has no gateway configuration.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "GatewayAccessGuardTest|ManagerRepositoryTest|OpenApiDocumentTest"`
Expected: PASS, including `OpenApiDocumentTest::test_service_metadata_is_complete`, which now has a capability.

- [ ] **Step 10: Check by hand**

Set `SESSION_SECRET` in `.env` to a 64-character random value (`php -r "echo bin2hex(random_bytes(32));"`), start `php -S 127.0.0.1:8000 router.php`, then:

```bash
curl -s http://127.0.0.1:8000/api/me
curl -s -H "X-Forwarded-For: 1.2.3.4" http://127.0.0.1:8000/api/me
curl -s -H "x-authenticated-user: admin@example.com" -H "X-Forwarded-For: 1.2.3.4" http://127.0.0.1:8000/api/me
```

Expected:
- The first call returns the dev identity from `.env`, with `"is_manager": true` when `DEV_USER_ROLE=admin`.
- The second and third calls return 401 with the error envelope. The forged header is ignored.

- [ ] **Step 11: Commit**

```bash
git add ListOfRequirements.md backend/src backend/tests
git commit -m "feat: enforce gateway session and Planning Manager access on every request"
```

---

### Task 7: Employee roster from intern-database, with a 24-hour directory cache

**Files:**
- Create: `backend/src/Roster/Roster.php`, `RosterPerson.php`, `RosterUnavailable.php`, `UnconfiguredRoster.php`, `InternDatabaseRoster.php`, `DepartmentNames.php`, `DepartmentApi.php`, `ClientCredentials.php`, `DirectoryRefresher.php`
- Create: `backend/src/Repo/DirectoryRepository.php`, `backend/src/Http/Controllers/CronController.php`
- Create: `backend/tests/Support/FakeRoster.php`, `backend/tests/Support/FakeDepartments.php`
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `vercel.json`
- Test: `backend/tests/Unit/Roster/InternDatabaseRosterTest.php`, `ClientCredentialsTest.php`, `backend/tests/Integration/Roster/DirectoryRefresherTest.php`, `backend/tests/Integration/Http/CronControllerTest.php`

**Interfaces:**
- Consumes: `HttpClient`, `FakeHttpClient`, `Clock`, `FixedClock`, `Time`, `DatabaseTestCase`.
- Produces:
  - `Roster::findByEmail(string $email): ?RosterPerson` and `Roster::listPlannable(): list<RosterPerson>`. Both throw `RosterUnavailable`.
  - `RosterPerson(string $ref, string $name, ?string $email, ?string $photoUrl, ?string $departmentId, string $status)`.
  - `InternDatabaseRoster(HttpClient, ClientCredentials, string $baseUrl)`, `PLANNABLE_STATUSES`, `InternDatabaseRoster::person(array $row): RosterPerson`.
  - `DepartmentNames::all(): array<string,string>` (id => name); `DepartmentApi(HttpClient, ClientCredentials, string $baseUrl)`.
  - `ClientCredentials(HttpClient, string $gatewayUrl, string $clientId, string $clientSecret, string $cacheDir, Clock)`, `->token(string $audience): string`.
  - `DirectoryRepository(\PDO, string $org)`. The rows it reads and writes have keys `employee_ref`, `display_name`, `photo_url`, `department_id`, `department_name` and `status`. Methods:
    - `->replaceAll(list<row> $rows, \DateTimeImmutable $fetchedAt): void`
    - `->all(): list<row>`
    - `->find(string $ref): ?row`
    - `->isEmpty(): bool`
    - `->lastFetchedAt(): ?\DateTimeImmutable`
  - `DirectoryRefresher(Roster, DepartmentNames, DirectoryRepository, Clock, string $backoffFile, \Closure $logger)`, `MAX_AGE_SECONDS = 86400`, `->refresh(): bool`, `->refreshIfEmpty(): bool`. Neither method ever throws.
  - `CronController(DirectoryRefresher, ?string $cronSecret)`, `->directory(Request): Response`.
  - Test helpers: `FakeRoster->add(string $ref, string $name, ?string $email = null, ?string $departmentId = null, string $status = 'Active')`, public `$down`; `FakeDepartments` with public `$names`, `$down`.
  - `App` getters: `credentials()`, `roster()`, `departments()`, `directory()`, `directoryRefresher()`, `cronController()`.

The intern-database contract was checked against its live `/openapi.json` on 2026-10-13:
- `GET /api/interns?email=&limit=&offset=` needs the `intern:read` scope and returns `{data: Intern[], pagination: {total}}`.
- `Intern` has `id` (uuid), `first_name`, `last_name`, `email_address`, `department_id`, `photo_url` and `status`.
- `status` is one of `Onboarding`, `Active`, `Offboarding`, `Former`, `Contract Ended`, `Resignation` or `Termination`.

Department-api: `GET /api/departments` needs the `department:read` scope. Planning uses the intern `id` as `employee_ref`.

- [ ] **Step 1: Add the test fakes**

`backend/tests/Support/FakeRoster.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\Roster\Roster;
use Planning\Roster\RosterPerson;
use Planning\Roster\RosterUnavailable;

final class FakeRoster implements Roster
{
    /** @var array<string, RosterPerson> keyed by email (or ref when there is no email) */
    public array $people = [];
    public bool $down = false;

    public function add(string $ref, string $name, ?string $email = null, ?string $departmentId = null, string $status = 'Active'): RosterPerson
    {
        $email = $email === null ? null : strtolower($email);
        $person = new RosterPerson($ref, $name, $email, null, $departmentId, $status);
        $this->people[$email ?? $ref] = $person;
        return $person;
    }

    public function findByEmail(string $email): ?RosterPerson
    {
        if ($this->down) {
            throw new RosterUnavailable('roster is down');
        }
        return $this->people[strtolower($email)] ?? null;
    }

    public function listPlannable(): array
    {
        if ($this->down) {
            throw new RosterUnavailable('roster is down');
        }
        return array_values($this->people);
    }
}
```

`backend/tests/Support/FakeDepartments.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\Roster\DepartmentNames;

final class FakeDepartments implements DepartmentNames
{
    /** @var array<string,string> */
    public array $names = [];
    public bool $down = false;

    public function all(): array
    {
        if ($this->down) {
            throw new \RuntimeException('department-api is down');
        }
        return $this->names;
    }
}
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/Unit/Roster/ClientCredentialsTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Roster;

use PHPUnit\Framework\TestCase;
use Planning\Roster\ClientCredentials;
use Planning\Roster\RosterUnavailable;
use Planning\Tests\Support\FakeHttpClient;
use Planning\Tests\Support\FixedClock;

final class ClientCredentialsTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/planning-cc-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
    }

    public function test_token_is_cached_until_shortly_before_expiry(): void
    {
        $http = (new FakeHttpClient())->on('POST', 'https://gw.test/oauth/token', FakeHttpClient::json(200, ['access_token' => 't1', 'expires_in' => 3600]));
        $clock = FixedClock::at('2026-10-13T00:00:00Z');
        $cc = new ClientCredentials($http, 'https://gw.test', 'id', 'secret', $this->dir, $clock);

        $this->assertSame('t1', $cc->token('intern-database'));
        $this->assertSame('t1', $cc->token('intern-database'));
        $this->assertCount(1, $http->requests);
        $this->assertContains('Authorization: Basic ' . base64_encode('id:secret'), $http->requests[0]['headers']);
        $this->assertSame(['grant_type' => 'client_credentials', 'audience' => 'intern-database'], json_decode((string) $http->requests[0]['body'], true));

        $clock->advance(3550);
        $cc->token('intern-database');
        $this->assertCount(2, $http->requests, 'refetched within 60s of expiry');
    }

    public function test_refusal_throws(): void
    {
        $http = (new FakeHttpClient())->on('POST', 'https://gw.test/oauth/token', FakeHttpClient::json(403, ['error' => 'nope']));
        $cc = new ClientCredentials($http, 'https://gw.test', 'id', 'secret', $this->dir, FixedClock::at('2026-10-13T00:00:00Z'));
        $this->expectException(RosterUnavailable::class);
        $cc->token('intern-database');
    }
}
```

`backend/tests/Unit/Roster/InternDatabaseRosterTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Roster;

use PHPUnit\Framework\TestCase;
use Planning\Roster\ClientCredentials;
use Planning\Roster\InternDatabaseRoster;
use Planning\Roster\RosterUnavailable;
use Planning\Tests\Support\FakeHttpClient;
use Planning\Tests\Support\FixedClock;

final class InternDatabaseRosterTest extends TestCase
{
    private const BASE = 'https://interns.test';

    private function roster(FakeHttpClient $http): InternDatabaseRoster
    {
        $http->on('POST', 'https://gw.test/oauth/token', FakeHttpClient::json(200, ['access_token' => 'tok', 'expires_in' => 3600]));
        $dir = sys_get_temp_dir() . '/planning-roster-' . bin2hex(random_bytes(4));
        mkdir($dir);
        return new InternDatabaseRoster($http, new ClientCredentials($http, 'https://gw.test', 'id', 's', $dir, FixedClock::at('2026-10-13T00:00:00Z')), self::BASE);
    }

    /** @return array<string,mixed> */
    private static function intern(string $id, string $email, string $status = 'Active'): array
    {
        return ['id' => $id, 'ref_number' => "INT-$id", 'first_name' => 'Ana', 'last_name' => "Lim $id", 'email_address' => $email, 'department_id' => 'DEP-1', 'photo_url' => 'https://img.test/a.png', 'status' => $status];
    }

    public function test_find_by_email_matches_case_insensitively(): void
    {
        $http = (new FakeHttpClient())->on('GET', self::BASE . '/api/interns?email=', FakeHttpClient::json(200, ['data' => [self::intern('u1', 'Ana@Example.com')]]));

        $person = $this->roster($http)->findByEmail('ana@example.com');

        $this->assertSame('u1', $person?->ref);
        $this->assertSame('Ana Lim u1', $person?->name);
        $this->assertSame('DEP-1', $person?->departmentId);
        $this->assertSame('https://img.test/a.png', $person?->photoUrl);
        $this->assertContains('Authorization: Bearer tok', $http->requests[1]['headers']);
    }

    public function test_find_by_email_ignores_non_matching_rows(): void
    {
        $http = (new FakeHttpClient())->on('GET', self::BASE . '/api/interns?email=', FakeHttpClient::json(200, ['data' => [self::intern('u1', 'other@example.com')]]));
        $this->assertNull($this->roster($http)->findByEmail('ana@example.com'));
    }

    public function test_list_pages_through_and_keeps_only_plannable_statuses(): void
    {
        $page1 = array_map(static fn (int $i): array => self::intern("a$i", "a$i@x.test"), range(1, 200));
        $page2 = [self::intern('b1', 'b1@x.test', 'Former'), self::intern('b2', 'b2@x.test', 'Offboarding')];
        $http = (new FakeHttpClient())
            ->on('GET', self::BASE . '/api/interns?limit=200&offset=0', FakeHttpClient::json(200, ['data' => $page1, 'pagination' => ['total' => 202]]))
            ->on('GET', self::BASE . '/api/interns?limit=200&offset=200', FakeHttpClient::json(200, ['data' => $page2, 'pagination' => ['total' => 202]]));

        $people = $this->roster($http)->listPlannable();

        $this->assertCount(201, $people);
        $this->assertSame('b2', $people[200]->ref);
    }

    public function test_unsafe_photo_urls_are_dropped(): void
    {
        $row = self::intern('u1', 'a@x.test');
        $row['photo_url'] = 'javascript:alert(1)';
        $this->assertNull(InternDatabaseRoster::person($row)->photoUrl);
    }

    public function test_service_errors_raise_roster_unavailable(): void
    {
        $http = (new FakeHttpClient())->on('GET', self::BASE . '/api/interns', FakeHttpClient::json(500, ['error' => []]));
        $this->expectException(RosterUnavailable::class);
        $this->roster($http)->listPlannable();
    }
}
```

`backend/tests/Integration/Roster/DirectoryRefresherTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Roster;

use Planning\Repo\DirectoryRepository;
use Planning\Roster\DirectoryRefresher;
use Planning\Tests\Support\DatabaseTestCase;
use Planning\Tests\Support\FakeDepartments;
use Planning\Tests\Support\FakeRoster;
use Planning\Tests\Support\FixedClock;

final class DirectoryRefresherTest extends DatabaseTestCase
{
    private FakeRoster $roster;
    private FakeDepartments $departments;
    private DirectoryRepository $directory;
    private FixedClock $clock;
    private string $backoff;

    protected function setUp(): void
    {
        parent::setUp();
        $this->roster = new FakeRoster();
        $this->departments = new FakeDepartments();
        $this->directory = new DirectoryRepository($this->pdo(), self::ORG);
        $this->clock = FixedClock::at('2026-10-13T00:00:00Z');
        $this->backoff = sys_get_temp_dir() . '/planning-backoff-' . bin2hex(random_bytes(4));
    }

    protected function tearDown(): void
    {
        @unlink($this->backoff);
    }

    private function refresher(): DirectoryRefresher
    {
        return new DirectoryRefresher($this->roster, $this->departments, $this->directory, $this->clock, $this->backoff, static function (string $line): void {
        });
    }

    public function test_refresh_stores_people_with_department_names(): void
    {
        $this->roster->add('u1', 'Ana Lim', 'ana@x.test', 'DEP-1');
        $this->departments->names = ['DEP-1' => 'Field Services'];

        $this->assertTrue($this->refresher()->refresh());

        $this->assertSame([[
            'employee_ref' => 'u1', 'display_name' => 'Ana Lim', 'photo_url' => null,
            'department_id' => 'DEP-1', 'department_name' => 'Field Services', 'status' => 'Active',
        ]], $this->directory->all());
        $this->assertEquals($this->clock->now(), $this->directory->lastFetchedAt());
    }

    public function test_roster_failure_keeps_the_old_cache(): void
    {
        $this->roster->add('u1', 'Ana Lim', 'ana@x.test');
        $this->refresher()->refresh();
        $this->roster->down = true;

        $this->assertFalse($this->refresher()->refresh());
        $this->assertCount(1, $this->directory->all());
    }

    public function test_department_failure_still_refreshes_people(): void
    {
        $this->roster->add('u1', 'Ana Lim', 'ana@x.test', 'DEP-1');
        $this->departments->down = true;

        $this->assertTrue($this->refresher()->refresh());
        $this->assertNull($this->directory->all()[0]['department_name']);
    }

    public function test_refresh_if_empty_backs_off_after_a_failure(): void
    {
        $this->roster->down = true;
        $this->assertFalse($this->refresher()->refreshIfEmpty());

        $this->roster->down = false;
        $this->roster->add('u1', 'Ana Lim', 'ana@x.test');
        $this->assertFalse($this->refresher()->refreshIfEmpty(), 'still backing off');

        $this->clock->advance(301);
        $this->assertTrue($this->refresher()->refreshIfEmpty());
        $this->assertFalse($this->refresher()->refreshIfEmpty(), 'not empty any more');
    }
}
```

`backend/tests/Integration/Http/CronControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Http;

use Planning\Http\Controllers\CronController;
use Planning\Http\HttpError;
use Planning\Http\Request;
use Planning\Repo\DirectoryRepository;
use Planning\Roster\DirectoryRefresher;
use Planning\Tests\Support\DatabaseTestCase;
use Planning\Tests\Support\FakeDepartments;
use Planning\Tests\Support\FakeRoster;
use Planning\Tests\Support\FixedClock;

final class CronControllerTest extends DatabaseTestCase
{
    private function controller(?string $secret): CronController
    {
        $roster = new FakeRoster();
        $roster->add('u1', 'Ana Lim', 'ana@x.test');
        $refresher = new DirectoryRefresher($roster, new FakeDepartments(), new DirectoryRepository($this->pdo(), self::ORG), FixedClock::at('2026-10-13T00:00:00Z'), sys_get_temp_dir() . '/planning-cron-test', static function (string $line): void {
        });
        return new CronController($refresher, $secret);
    }

    public function test_wrong_or_missing_secret_is_401(): void
    {
        foreach ([[null, 'Bearer x'], ['right', 'Bearer wrong'], ['right', null]] as [$secret, $header]) {
            try {
                $this->controller($secret)->directory(new Request('GET', '/internal/cron/directory', headers: $header === null ? [] : ['authorization' => $header]));
                $this->fail('Expected 401');
            } catch (HttpError $e) {
                $this->assertSame(401, $e->status);
            }
        }
    }

    public function test_right_secret_refreshes_the_directory(): void
    {
        $response = $this->controller('right')->directory(new Request('GET', '/internal/cron/directory', headers: ['authorization' => 'Bearer right']));
        $this->assertSame(['refreshed' => true], $response->decoded());
    }
}
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `php vendor/bin/phpunit --filter "ClientCredentialsTest|InternDatabaseRosterTest|DirectoryRefresherTest|CronControllerTest"`
Expected: FAIL with class-not-found errors.

- [ ] **Step 4: Implement the roster types**

`backend/src/Roster/RosterPerson.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

final class RosterPerson
{
    public function __construct(
        public readonly string $ref,
        public readonly string $name,
        public readonly ?string $email,
        public readonly ?string $photoUrl,
        public readonly ?string $departmentId,
        public readonly string $status,
    ) {
    }
}
```

`backend/src/Roster/RosterUnavailable.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

final class RosterUnavailable extends \RuntimeException
{
}
```

`backend/src/Roster/Roster.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

/** IF-02. The only code that knows where the employee roster lives (OI-03). */
interface Roster
{
    /** @throws RosterUnavailable */
    public function findByEmail(string $email): ?RosterPerson;

    /**
     * @return list<RosterPerson>
     * @throws RosterUnavailable
     */
    public function listPlannable(): array;
}
```

`backend/src/Roster/DepartmentNames.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

/** IF-03 */
interface DepartmentNames
{
    /** @return array<string,string> department id => name */
    public function all(): array;
}
```

`backend/src/Roster/UnconfiguredRoster.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

/** Used when no API client is configured: behaves like a roster that is down (NFR-06). */
final class UnconfiguredRoster implements Roster, DepartmentNames
{
    private const MESSAGE = 'No InterlinkERP API client is configured (INTERLINK_CLIENT_ID / INTERN_DATABASE_URL / DEPARTMENT_API_URL).';

    public function findByEmail(string $email): ?RosterPerson
    {
        throw new RosterUnavailable(self::MESSAGE);
    }

    public function listPlannable(): array
    {
        throw new RosterUnavailable(self::MESSAGE);
    }

    public function all(): array
    {
        throw new RosterUnavailable(self::MESSAGE);
    }
}
```

- [ ] **Step 5: Implement client credentials, the roster and departments**

`backend/src/Roster/ClientCredentials.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

use Planning\Support\Clock;
use Planning\Support\HttpClient;

/**
 * Service-to-service access tokens (contract SS-26), one per audience, reused
 * until a minute before expiry. Cached on disk because serverless instances
 * share nothing else (performance guide §5b).
 */
final class ClientCredentials
{
    public function __construct(
        private readonly HttpClient $http,
        private readonly string $gatewayUrl,
        private readonly string $clientId,
        private readonly string $clientSecret,
        private readonly string $cacheDir,
        private readonly Clock $clock,
    ) {
    }

    public function token(string $audience): string
    {
        $file = $this->cacheDir . '/planning_cc_' . hash('sha256', $this->clientId . '|' . $audience) . '.json';
        $now = $this->clock->now()->getTimestamp();
        $cached = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (is_array($cached) && is_string($cached['token'] ?? null) && (int) ($cached['exp'] ?? 0) > $now + 60) {
            return $cached['token'];
        }

        $result = $this->http->request(
            'POST',
            $this->gatewayUrl . '/oauth/token',
            ['Content-Type: application/json', 'Authorization: Basic ' . base64_encode($this->clientId . ':' . $this->clientSecret)],
            json_encode(['grant_type' => 'client_credentials', 'audience' => $audience], JSON_THROW_ON_ERROR),
            6,
        );
        $token = $result->json['access_token'] ?? null;
        if ($result->status !== 200 || !is_string($token) || $token === '') {
            throw new RosterUnavailable("The gateway refused a $audience token (HTTP {$result->status}).");
        }
        @file_put_contents($file, json_encode(['token' => $token, 'exp' => $now + max(60, (int) ($result->json['expires_in'] ?? 3600))]), LOCK_EX);
        @chmod($file, 0600);
        return $token;
    }
}
```

`backend/src/Roster/InternDatabaseRoster.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

use Planning\Support\HttpClient;

final class InternDatabaseRoster implements Roster
{
    public const AUDIENCE = 'intern-database';
    public const PLANNABLE_STATUSES = ['Onboarding', 'Active', 'Offboarding'];
    private const PAGE_SIZE = 200;
    private const MAX_PAGES = 25;

    public function __construct(
        private readonly HttpClient $http,
        private readonly ClientCredentials $credentials,
        private readonly string $baseUrl,
    ) {
    }

    public function findByEmail(string $email): ?RosterPerson
    {
        $email = strtolower(trim($email));
        foreach (self::rows($this->get('/api/interns?email=' . rawurlencode($email) . '&limit=5')) as $row) {
            if (strtolower(trim((string) ($row['email_address'] ?? ''))) === $email && isset($row['id'])) {
                return self::person($row);
            }
        }
        return null;
    }

    public function listPlannable(): array
    {
        $people = [];
        for ($page = 0; $page < self::MAX_PAGES; $page++) {
            $offset = $page * self::PAGE_SIZE;
            $json = $this->get('/api/interns?limit=' . self::PAGE_SIZE . "&offset=$offset");
            $rows = self::rows($json);
            foreach ($rows as $row) {
                if (isset($row['id']) && in_array($row['status'] ?? null, self::PLANNABLE_STATUSES, true)) {
                    $people[] = self::person($row);
                }
            }
            $total = (int) ($json['pagination']['total'] ?? 0);
            if (count($rows) < self::PAGE_SIZE || $offset + self::PAGE_SIZE >= $total) {
                break;
            }
        }
        return $people;
    }

    /** @param array<string,mixed> $row */
    public static function person(array $row): RosterPerson
    {
        $name = trim(((string) ($row['first_name'] ?? '')) . ' ' . ((string) ($row['last_name'] ?? '')));
        $email = strtolower(trim((string) ($row['email_address'] ?? '')));
        $department = $row['department_id'] ?? null;
        return new RosterPerson(
            (string) $row['id'],
            $name !== '' ? $name : (string) ($row['ref_number'] ?? $row['id']),
            $email !== '' ? $email : null,
            self::safeImageUrl($row['photo_url'] ?? null),
            is_string($department) && $department !== '' ? $department : null,
            (string) ($row['status'] ?? ''),
        );
    }

    /** @return array<mixed> */
    private function get(string $path): array
    {
        $result = $this->http->request('GET', rtrim($this->baseUrl, '/') . $path, ['Authorization: Bearer ' . $this->credentials->token(self::AUDIENCE)], null, 6);
        if ($result->status !== 200 || $result->json === null) {
            throw new RosterUnavailable("intern-database returned HTTP {$result->status}.");
        }
        return $result->json;
    }

    /**
     * @param array<mixed> $json
     * @return list<array<string,mixed>>
     */
    private static function rows(array $json): array
    {
        $rows = $json['data'] ?? $json['items'] ?? [];
        return is_array($rows) ? array_values(array_filter($rows, 'is_array')) : [];
    }

    /** Only plain https image URLs: they end up in an <img src>. */
    private static function safeImageUrl(mixed $url): ?string
    {
        if (!is_string($url) || !preg_match('#^https://[^\s"\'<>`]+$#i', $url)) {
            return null;
        }
        return filter_var($url, FILTER_VALIDATE_URL) !== false ? $url : null;
    }
}
```

`backend/src/Roster/DepartmentApi.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

use Planning\Support\HttpClient;

final class DepartmentApi implements DepartmentNames
{
    public const AUDIENCE = 'department-api';

    public function __construct(
        private readonly HttpClient $http,
        private readonly ClientCredentials $credentials,
        private readonly string $baseUrl,
    ) {
    }

    public function all(): array
    {
        $result = $this->http->request('GET', rtrim($this->baseUrl, '/') . '/api/departments?limit=200', ['Authorization: Bearer ' . $this->credentials->token(self::AUDIENCE)], null, 6);
        if ($result->status !== 200 || $result->json === null) {
            throw new RosterUnavailable("department-api returned HTTP {$result->status}.");
        }
        $rows = $result->json['data'] ?? (array_is_list($result->json) ? $result->json : []);
        $names = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            if (is_array($row) && isset($row['id'], $row['name']) && is_string($row['name'])) {
                $names[(string) $row['id']] = $row['name'];
            }
        }
        return $names;
    }
}
```

- [ ] **Step 6: Implement the directory cache, the refresher and the cron endpoint**

`backend/src/Repo/DirectoryRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;

/** DR-02: display fields only, at most 24 hours old. No emails or other personal data. */
final class DirectoryRepository
{
    private const COLUMNS = 'employee_ref, display_name, photo_url, department_id, department_name, status';

    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    /** @param list<array{employee_ref: string, display_name: string, photo_url: ?string, department_id: ?string, department_name: ?string, status: string}> $rows */
    public function replaceAll(array $rows, \DateTimeImmutable $fetchedAt): void
    {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('DELETE FROM employee_directory WHERE organisation_id = ?')->execute([$this->org]);
            $insert = $this->pdo->prepare('INSERT INTO employee_directory (organisation_id, ' . self::COLUMNS . ', fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            foreach ($rows as $r) {
                $insert->execute([$this->org, $r['employee_ref'], $r['display_name'], $r['photo_url'], $r['department_id'], $r['department_name'], $r['status'], Time::db($fetchedAt)]);
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /** @return list<array<string, ?string>> */
    public function all(): array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM employee_directory WHERE organisation_id = ? ORDER BY display_name');
        $st->execute([$this->org]);
        return $st->fetchAll();
    }

    /** @return array<string, ?string>|null */
    public function find(string $ref): ?array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM employee_directory WHERE organisation_id = ? AND employee_ref = ?');
        $st->execute([$this->org, $ref]);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public function isEmpty(): bool
    {
        $st = $this->pdo->prepare('SELECT 1 FROM employee_directory WHERE organisation_id = ? LIMIT 1');
        $st->execute([$this->org]);
        return $st->fetchColumn() === false;
    }

    public function lastFetchedAt(): ?\DateTimeImmutable
    {
        $st = $this->pdo->prepare('SELECT MAX(fetched_at) FROM employee_directory WHERE organisation_id = ?');
        $st->execute([$this->org]);
        $value = $st->fetchColumn();
        return is_string($value) ? Time::fromDb($value) : null;
    }
}
```

`backend/src/Roster/DirectoryRefresher.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Roster;

use Planning\Repo\DirectoryRepository;
use Planning\Support\Clock;

/**
 * Keeps employee_directory fresh (DR-02). Never throws: when the roster or
 * department service is down, the old cache stays and planning goes on (NFR-06).
 */
final class DirectoryRefresher
{
    public const MAX_AGE_SECONDS = 86400;
    private const BACKOFF_SECONDS = 300;

    /** @param \Closure(string): void $logger */
    public function __construct(
        private readonly Roster $roster,
        private readonly DepartmentNames $departments,
        private readonly DirectoryRepository $directory,
        private readonly Clock $clock,
        private readonly string $backoffFile,
        private readonly \Closure $logger,
    ) {
    }

    public function refresh(): bool
    {
        try {
            $people = $this->roster->listPlannable();
        } catch (\Throwable $e) {
            ($this->logger)('[planning-api] roster refresh failed: ' . $e->getMessage());
            return false;
        }
        try {
            $names = $this->departments->all();
        } catch (\Throwable $e) {
            ($this->logger)('[planning-api] department names unavailable: ' . $e->getMessage());
            $names = [];
        }
        $rows = array_map(static fn (RosterPerson $p): array => [
            'employee_ref' => $p->ref,
            'display_name' => $p->name,
            'photo_url' => $p->photoUrl,
            'department_id' => $p->departmentId,
            'department_name' => $p->departmentId === null ? null : ($names[$p->departmentId] ?? null),
            'status' => $p->status,
        ], $people);
        try {
            $this->directory->replaceAll($rows, $this->clock->now());
            return true;
        } catch (\Throwable $e) {
            ($this->logger)('[planning-api] directory write failed: ' . $e->getMessage());
            return false;
        }
    }

    /** First-use bootstrap. After a failure, waits 5 minutes before trying again so pages stay fast. */
    public function refreshIfEmpty(): bool
    {
        try {
            if (!$this->directory->isEmpty()) {
                return false;
            }
        } catch (\Throwable) {
            return false;
        }
        $now = $this->clock->now()->getTimestamp();
        $lastFailure = is_file($this->backoffFile) ? (int) file_get_contents($this->backoffFile) : 0;
        if ($now - $lastFailure < self::BACKOFF_SECONDS) {
            return false;
        }
        $ok = $this->refresh();
        if ($ok) {
            @unlink($this->backoffFile);
        } else {
            @file_put_contents($this->backoffFile, (string) $now);
        }
        return $ok;
    }
}
```

`backend/src/Http/Controllers/CronController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Http\HttpError;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Roster\DirectoryRefresher;

/** Vercel cron sends "Authorization: Bearer $CRON_SECRET". Not part of the public API document. */
final class CronController
{
    public function __construct(private readonly DirectoryRefresher $refresher, private readonly ?string $cronSecret)
    {
    }

    public function directory(Request $request): Response
    {
        if ($this->cronSecret === null || !hash_equals('Bearer ' . $this->cronSecret, (string) $request->header('authorization'))) {
            throw HttpError::unauthorized('A valid cron secret is required.');
        }
        return Response::json(200, ['refreshed' => $this->refresher->refresh()]);
    }
}
```

- [ ] **Step 7: Wire it into `App`, the routes and Vercel**

Add these getters to `App`, with `use` lines for:
- `Planning\Roster\ClientCredentials`, `DepartmentApi`, `DepartmentNames`, `DirectoryRefresher`, `InternDatabaseRoster`, `Roster`, `UnconfiguredRoster`
- `Planning\Repo\DirectoryRepository`
- `Planning\Http\Controllers\CronController`

```php
    public function credentials(): ?ClientCredentials
    {
        return $this->once('credentials', function (): ?ClientCredentials {
            $id = Env::get('INTERLINK_CLIENT_ID');
            $secret = Env::get('INTERLINK_CLIENT_SECRET');
            return ($id === null || $secret === null) ? null : new ClientCredentials($this->http(), $this->gatewayUrl(), $id, $secret, sys_get_temp_dir(), $this->clock());
        });
    }

    public function roster(): Roster
    {
        return $this->once('roster', function (): Roster {
            $credentials = $this->credentials();
            $url = Env::get('INTERN_DATABASE_URL');
            return ($credentials === null || $url === null) ? new UnconfiguredRoster() : new InternDatabaseRoster($this->http(), $credentials, $url);
        });
    }

    public function departments(): DepartmentNames
    {
        return $this->once('departments', function (): DepartmentNames {
            $credentials = $this->credentials();
            $url = Env::get('DEPARTMENT_API_URL');
            return ($credentials === null || $url === null) ? new UnconfiguredRoster() : new DepartmentApi($this->http(), $credentials, $url);
        });
    }

    public function directory(): DirectoryRepository
    {
        return $this->once('directory', fn () => new DirectoryRepository($this->pdo(), $this->organisationId()));
    }

    public function directoryRefresher(): DirectoryRefresher
    {
        return $this->once('directoryRefresher', fn () => new DirectoryRefresher(
            $this->roster(),
            $this->departments(),
            $this->directory(),
            $this->clock(),
            sys_get_temp_dir() . '/planning_directory_backoff_' . hash('sha256', $this->organisationId()),
            $this->logger(),
        ));
    }

    public function cronController(): CronController
    {
        return $this->once('cronController', fn () => new CronController($this->directoryRefresher(), Env::get('CRON_SECRET')));
    }
```

In `backend/src/routes.php`, add before `return $router;`:

```php
    $router->add('GET', '/internal/cron/directory', Route::INTERNAL, 'Refresh the cached employee directory.', $to('cronController', 'directory'));
```

In `vercel.json`, add after the `"functions"` block. The schedule `0 18 * * *` runs at 18:00 UTC, which is 02:00 in Malaysia.

```json
  "crons": [
    { "path": "/internal/cron/directory", "schedule": "0 18 * * *" }
  ],
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "ClientCredentialsTest|InternDatabaseRosterTest|DirectoryRefresherTest|CronControllerTest|OpenApiDocumentTest"`
Expected: PASS. `OpenApiDocumentTest` still passes because internal routes are left out of the document.

- [ ] **Step 9: Commit**

```bash
git add backend/src backend/tests vercel.json
git commit -m "feat: load plannable employees from intern-database with a daily directory cache"
```

---

### Task 8: Sign-in page gate

**Files:**
- Create: `backend/src/Web/PageGate.php`, `api/app.php`
- Modify: `backend/src/App.php` (`pageGate()`, `servePage()`), `router.php`, `vercel.json`
- Test: `backend/tests/Unit/Web/PageGateTest.php`

**Interfaces:**
- Consumes: `Gateway`, `TokenVerifier`, `SessionCodec`, `SessionData`, `Liveness`, `Roster`, `DevIdentity`, `Response::withNoStore()`, `SessionCodecTest::valueOf()`.
- Produces: `PageGate(Gateway, TokenVerifier, SessionCodec, Roster, ?DevIdentity, string $publicUrl, string $shellPath, \Closure $logger)`, `->handle(Request): Response`, `PageGate::safeReturnPath(?string): string`, `PageGate::RETURN_COOKIE = 'planning_return_to'`; `App::pageGate()`, `App::servePage()`.

Pages behind the gate: `/`, `/schedule`, `/my`, `/settings`, `/settings/*`, `/not-on-roster`.

- [ ] **Step 1: Write the failing test**

`backend/tests/Unit/Web/PageGateTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Web;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Planning\Auth\Gateway;
use Planning\Auth\SessionCodec;
use Planning\Auth\SessionData;
use Planning\Auth\TokenVerifier;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Tests\Support\FakeHttpClient;
use Planning\Tests\Support\FakeRoster;
use Planning\Tests\Support\FixedClock;
use Planning\Tests\Support\TestTokens;
use Planning\Tests\Unit\Auth\SessionCodecTest;
use Planning\Web\PageGate;

final class PageGateTest extends TestCase
{
    private const GW = TestTokens::ISSUER;
    private const PUBLIC = 'https://planning.test';

    private FakeHttpClient $http;
    private FakeRoster $roster;
    private SessionCodec $codec;
    private string $shell;
    /** @var list<string> */
    private array $logged = [];

    protected function setUp(): void
    {
        $this->http = new FakeHttpClient();
        $this->roster = new FakeRoster();
        $this->codec = new SessionCodec(str_repeat('k', 32), FixedClock::at('2026-10-13T00:00:00Z'));
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><title>Planning</title>');
    }

    protected function tearDown(): void
    {
        unlink($this->shell);
    }

    private function gate(): PageGate
    {
        return new PageGate(
            new Gateway($this->http, self::GW, self::PUBLIC),
            new TokenVerifier(TestTokens::jwks(), TestTokens::ISSUER, TestTokens::AUDIENCE),
            $this->codec,
            $this->roster,
            null,
            self::PUBLIC,
            $this->shell,
            function (string $line): void {
                $this->logged[] = $line;
            },
        );
    }

    private function withSession(string $path): Request
    {
        $value = SessionCodecTest::valueOf($this->codec->issue(new SessionData('sid-1', 'sub-1', 'ana@example.com', 'Ana', 'user', 'u1', 0), true));
        return new Request('GET', $path, cookies: ['planning_session' => $value]);
    }

    private static function cookieNamed(Response $response, string $name): ?string
    {
        foreach ($response->cookies as $cookie) {
            if (str_starts_with($cookie, "$name=")) {
                return $cookie;
            }
        }
        return null;
    }

    public function test_no_session_redirects_to_the_gateway_with_the_return_path(): void
    {
        $response = $this->gate()->handle(new Request('GET', '/schedule', query: ['view' => 'week']));

        $this->assertSame(302, $response->status);
        $this->assertSame(self::GW . '/oauth/authorize?redirect_uri=' . rawurlencode(self::PUBLIC . '/') . '&state=' . rawurlencode('/schedule?view=week'), $response->headers['Location']);
        $this->assertSame('no-store, no-cache, must-revalidate, max-age=0', $response->headers['Cache-Control']);
        $this->assertStringContainsString('planning_return_to=' . rawurlencode('/schedule?view=week'), (string) self::cookieNamed($response, 'planning_return_to'));
    }

    public function test_returning_code_starts_a_session_with_the_roster_reference(): void
    {
        $this->http->on('POST', self::GW . '/oauth/token', FakeHttpClient::json(200, ['token' => TestTokens::make(['email' => 'Ana@Example.com'])]));
        $this->roster->add('u1', 'Ana Lim', 'ana@example.com');

        $response = $this->gate()->handle(new Request('GET', '/', query: ['code' => 'c-1', 'state' => '/schedule']));

        $this->assertSame(302, $response->status);
        $this->assertSame(self::PUBLIC . '/schedule', $response->headers['Location']);
        $session = $this->codec->decode(SessionCodecTest::valueOf((string) self::cookieNamed($response, 'planning_session')));
        $this->assertSame('u1', $session?->employeeRef);
        $this->assertSame('ana@example.com', $session?->email);
    }

    public function test_return_cookie_is_used_when_the_gateway_drops_state(): void
    {
        $this->http->on('POST', self::GW . '/oauth/token', FakeHttpClient::json(200, ['token' => TestTokens::make()]));
        $response = $this->gate()->handle(new Request('GET', '/', query: ['code' => 'c-1'], cookies: ['planning_return_to' => '/settings/roles']));
        $this->assertSame(self::PUBLIC . '/settings/roles', $response->headers['Location']);
    }

    public function test_roster_outage_still_signs_in_without_a_reference(): void
    {
        $this->http->on('POST', self::GW . '/oauth/token', FakeHttpClient::json(200, ['token' => TestTokens::make()]));
        $this->roster->down = true;

        $response = $this->gate()->handle(new Request('GET', '/', query: ['code' => 'c-1']));

        $this->assertSame(302, $response->status);
        $session = $this->codec->decode(SessionCodecTest::valueOf((string) self::cookieNamed($response, 'planning_session')));
        $this->assertNull($session?->employeeRef);
        $this->assertNotEmpty($this->logged);
    }

    public function test_failed_code_exchange_shows_an_error_page_instead_of_looping(): void
    {
        $this->http->on('POST', self::GW . '/oauth/token', FakeHttpClient::json(400, []));
        $response = $this->gate()->handle(new Request('GET', '/', query: ['code' => 'bad']));
        $this->assertSame(502, $response->status);
        $this->assertStringContainsString('Try again', (string) $response->body);
    }

    public function test_live_session_serves_the_shell_and_extends_the_cookie(): void
    {
        $this->http->on('POST', self::GW . '/oauth/introspect', FakeHttpClient::json(200, ['active' => true]));
        $response = $this->gate()->handle($this->withSession('/schedule'));

        $this->assertSame(200, $response->status);
        $this->assertStringContainsString('<title>Planning</title>', (string) $response->body);
        $this->assertSame('no-store, no-cache, must-revalidate, max-age=0', $response->headers['Cache-Control']);
        $this->assertNotNull(self::cookieNamed($response, 'planning_session'));
    }

    public function test_ended_gateway_session_clears_and_redirects(): void
    {
        $this->http->on('POST', self::GW . '/oauth/introspect', FakeHttpClient::json(200, ['active' => false]));
        $response = $this->gate()->handle($this->withSession('/my'));

        $this->assertSame(302, $response->status);
        $this->assertStringContainsString('Max-Age=0', (string) self::cookieNamed($response, 'planning_session'));
    }

    /** @return array<string, array{0: ?string, 1: string}> */
    public static function returnPaths(): array
    {
        return [
            'normal' => ['/schedule?x=1', '/schedule?x=1'],
            'null' => [null, '/'],
            'absolute url' => ['https://evil.test/', '/'],
            'protocol relative' => ['//evil.test/x', '/'],
            'backslash trick' => ['/\\evil.test', '/'],
            'control character' => ["/x\r\nSet-Cookie: a=b", '/'],
        ];
    }

    #[DataProvider('returnPaths')]
    public function test_safe_return_path(?string $input, string $expected): void
    {
        $this->assertSame($expected, PageGate::safeReturnPath($input));
    }
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `php vendor/bin/phpunit --filter PageGateTest`
Expected: FAIL with `Class "Planning\Web\PageGate" not found`.

- [ ] **Step 3: Implement the gate**

`backend/src/Web/PageGate.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Web;

use Planning\Auth\DevIdentity;
use Planning\Auth\Gateway;
use Planning\Auth\Liveness;
use Planning\Auth\SessionCodec;
use Planning\Auth\SessionData;
use Planning\Auth\TokenVerifier;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Roster\Roster;

/**
 * Sign-in flow for page loads (auth guide §4, §5, §7). Every page response
 * and redirect is no-store. A failed code exchange shows an error page
 * rather than redirecting again, so a broken gateway cannot cause a loop.
 */
final class PageGate
{
    public const RETURN_COOKIE = 'planning_return_to';

    /** @param \Closure(string): void $logger */
    public function __construct(
        private readonly Gateway $gateway,
        private readonly TokenVerifier $tokens,
        private readonly SessionCodec $sessions,
        private readonly Roster $roster,
        private readonly ?DevIdentity $dev,
        private readonly string $publicUrl,
        private readonly string $shellPath,
        private readonly \Closure $logger,
    ) {
    }

    public function handle(Request $request): Response
    {
        $code = $request->queryString('code');
        if ($code !== null) {
            return $this->completeSignIn($request, $code);
        }

        if ($this->dev !== null && $this->dev->allows($request)) {
            return $this->shell();
        }

        $session = $this->sessions->decode($request->cookies[SessionCodec::COOKIE] ?? null);
        if ($session === null) {
            return $this->toGateway($request);
        }

        $liveness = $this->gateway->liveness($session->sid, $session->sub);
        if ($liveness === Liveness::Dead) {
            return $this->toGateway($request)->withCookie($this->sessions->clear($this->secure()));
        }
        $response = $this->shell();
        return $liveness === Liveness::Live ? $response->withCookie($this->sessions->issue($session, $this->secure())) : $response;
    }

    public static function safeReturnPath(?string $path): string
    {
        if ($path === null || $path === '' || !str_starts_with($path, '/') || str_starts_with($path, '//')
            || str_contains($path, '\\') || preg_match('/[\x00-\x1f\x7f]/', $path)) {
            return '/';
        }
        return $path;
    }

    private function completeSignIn(Request $request, string $code): Response
    {
        try {
            $claims = $this->tokens->verify($this->gateway->exchangeCode($code), 'identity');
            if (!is_string($claims['sid'] ?? null) || !is_string($claims['sub'] ?? null)) {
                throw new \RuntimeException('The identity token has no sid or sub.');
            }
        } catch (\Throwable $e) {
            ($this->logger)('[planning-web] sign-in failed: ' . $e->getMessage());
            return Response::html(502, '<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><p>Signing in through InterlinkERP did not work. <a href="/">Try again</a>.</p>')->withNoStore();
        }

        $email = strtolower(trim((string) ($claims['email'] ?? '')));
        $employeeRef = null;
        if ($email !== '') {
            try {
                $employeeRef = $this->roster->findByEmail($email)?->ref;
            } catch (\Throwable $e) {
                // Fail soft (auth guide §11): no roster match only means no My Planning yet.
                ($this->logger)('[planning-web] roster lookup failed at sign-in: ' . $e->getMessage());
            }
        }

        $session = new SessionData($claims['sid'], $claims['sub'], $email, (string) ($claims['name'] ?? $email), (string) ($claims['role'] ?? ''), $employeeRef, 0);
        $returnPath = self::safeReturnPath($request->queryString('state') ?? ($request->cookies[self::RETURN_COOKIE] ?? null));

        return Response::redirect($this->publicUrl . $returnPath)
            ->withCookie($this->sessions->issue($session, $this->secure()))
            ->withCookie(self::RETURN_COOKIE . '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
            ->withNoStore();
    }

    private function toGateway(Request $request): Response
    {
        $query = http_build_query(array_diff_key($request->query, ['code' => 1, 'state' => 1]));
        $returnPath = self::safeReturnPath($request->path . ($query !== '' ? '?' . $query : ''));
        $response = Response::redirect($this->gateway->authorizeUrl($returnPath))->withNoStore();
        if ($returnPath !== '/') {
            // Fallback in case the gateway does not echo `state` back.
            $response = $response->withCookie(self::RETURN_COOKIE . '=' . rawurlencode($returnPath) . '; Path=/; Max-Age=300; HttpOnly; SameSite=Lax' . ($this->secure() ? '; Secure' : ''));
        }
        return $response;
    }

    private function shell(): Response
    {
        $html = is_file($this->shellPath) ? (string) file_get_contents($this->shellPath) : '<!doctype html><p>The app has not been built yet. Run npm run build.</p>';
        return Response::html(200, $html)->withNoStore();
    }

    private function secure(): bool
    {
        return str_starts_with($this->publicUrl, 'https://');
    }
}
```

PHP already URL-decodes the `planning_return_to` value into `$_COOKIE`, so `safeReturnPath()` always checks the decoded path.

- [ ] **Step 4: Wire the page entry point**

Add to `App` (with `use Planning\Web\PageGate;`):

```php
    public function pageGate(): PageGate
    {
        return $this->once('pageGate', fn () => new PageGate(
            $this->gateway(),
            $this->tokenVerifier(),
            $this->sessions(),
            $this->roster(),
            $this->devIdentity(),
            $this->publicUrl(),
            dirname(__DIR__, 2) . '/dist/app-shell.html',
            $this->logger(),
        ));
    }

    public function servePage(): void
    {
        try {
            Env::requireAll(self::REQUIRED_ENV);
        } catch (ConfigError $e) {
            ($this->logger())('[planning-web] ' . $e->getMessage());
            Response::html(500, '<!doctype html><p>Planning is misconfigured. See the server log.</p>')->withNoStore()->send();
            return;
        }
        $this->pageGate()->handle(Request::fromGlobals())->send();
    }
```

`api/app.php`:

```php
<?php

declare(strict_types=1);

// Vercel entry for page routes: runs the gateway sign-in flow, then serves the SPA shell.
require __DIR__ . '/../backend/bootstrap.php';

\Planning\App::boot()->servePage();
```

In `router.php`, insert before `require __DIR__ . '/api/index.php';`:

```php
$pages = ['/', '/schedule', '/my', '/settings', '/not-on-roster'];
if (in_array(rtrim($path, '/') === '' ? '/' : rtrim($path, '/'), $pages, true) || str_starts_with($path, '/settings/')) {
    require __DIR__ . '/api/app.php';
    return true;
}
```

In `vercel.json`, add `"api/app.php": { "runtime": "vercel-php@0.9.0" }` to `functions` and insert these rewrites just before the final `/:path*` catch-all:

```json
    { "source": "/", "destination": "/api/app.php" },
    { "source": "/schedule", "destination": "/api/app.php" },
    { "source": "/my", "destination": "/api/app.php" },
    { "source": "/settings", "destination": "/api/app.php" },
    { "source": "/settings/:path*", "destination": "/api/app.php" },
    { "source": "/not-on-roster", "destination": "/api/app.php" },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --testsuite unit`
Expected: PASS, all unit tests so far.

- [ ] **Step 6: Commit**

```bash
git add backend/src api/app.php router.php vercel.json backend/tests/Unit/Web
git commit -m "feat: add gateway sign-in page gate with no-store pages"
```

---

### Task 9: Time intervals, working hours and local days (pure domain)

**Files:**
- Create: `backend/src/Domain/Interval.php`, `WorkingHours.php`, `LocalDays.php`
- Test: `backend/tests/Unit/Domain/IntervalTest.php`, `WorkingHoursTest.php`, `LocalDaysTest.php`

**Interfaces:**
- Consumes: `Time` (Task 6).
- Produces:
  - `Interval(\DateTimeImmutable $start, \DateTimeImmutable $end)` (throws `\InvalidArgumentException` unless end > start), `->overlaps(Interval): bool`, `->intersect(Interval): ?Interval`, `->seconds(): int`, `->hours(): float`.
  - `WorkingHours::DAYS = ['mon','tue','wed','thu','fri','sat','sun']`. `WorkingHours::fromArray(array): WorkingHours` throws `\InvalidArgumentException`, with a message safe to show the user. `->toArray(): array<string, list<array{0:string,1:string}>>` always returns all seven keys. `->intervalsBetween(\DateTimeImmutable $from, \DateTimeImmutable $to, \DateTimeZone $tz): list<Interval>` returns UTC intervals clipped to `[from, to)`.
  - `LocalDays::split(Interval, \DateTimeZone): array<string, Interval>` maps each local date (`Y-m-d`) to the part of the interval that falls on it.

Nothing in `Domain/` may touch the database, HTTP, `App` or the clock.

- [ ] **Step 1: Write the failing tests**

`backend/tests/Unit/Domain/IntervalTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Domain;

use PHPUnit\Framework\TestCase;
use Planning\Domain\Interval;

final class IntervalTest extends TestCase
{
    private static function i(string $start, string $end): Interval
    {
        return new Interval(new \DateTimeImmutable($start), new \DateTimeImmutable($end));
    }

    public function test_end_must_be_after_start(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        self::i('2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z');
    }

    public function test_touching_intervals_do_not_overlap(): void
    {
        $this->assertFalse(self::i('2026-10-13T08:00:00Z', '2026-10-13T10:00:00Z')->overlaps(self::i('2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z')));
        $this->assertTrue(self::i('2026-10-13T08:00:00Z', '2026-10-13T10:01:00Z')->overlaps(self::i('2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z')));
    }

    public function test_intersect_and_hours(): void
    {
        $cut = self::i('2026-10-13T08:00:00Z', '2026-10-13T12:00:00Z')->intersect(self::i('2026-10-13T10:30:00Z', '2026-10-13T20:00:00Z'));
        $this->assertSame(1.5, $cut?->hours());
        $this->assertNull(self::i('2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z')->intersect(self::i('2026-10-13T09:00:00Z', '2026-10-13T10:00:00Z')));
    }
}
```

`backend/tests/Unit/Domain/WorkingHoursTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Domain;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Planning\Domain\Interval;
use Planning\Domain\WorkingHours;
use Planning\Support\Time;

final class WorkingHoursTest extends TestCase
{
    private static function weekdays(): WorkingHours
    {
        $day = [['09:00', '13:00'], ['14:00', '18:00']];
        return WorkingHours::fromArray(['mon' => $day, 'tue' => $day, 'wed' => $day, 'thu' => $day, 'fri' => $day]);
    }

    /** @param list<Interval> $intervals */
    private static function totalHours(array $intervals): float
    {
        return array_sum(array_map(static fn (Interval $i): float => $i->hours(), $intervals));
    }

    public function test_a_kuala_lumpur_week(): void
    {
        $tz = new \DateTimeZone('Asia/Kuala_Lumpur');
        $from = Time::localMidnight('2026-10-12', $tz); // a Monday

        $intervals = self::weekdays()->intervalsBetween($from, $from->modify('+7 days'), $tz);

        $this->assertCount(10, $intervals);
        $this->assertSame('2026-10-12T01:00:00Z', Time::iso($intervals[0]->start));
        $this->assertSame('2026-10-12T05:00:00Z', Time::iso($intervals[0]->end));
        $this->assertEqualsWithDelta(40.0, self::totalHours($intervals), 0.001);
    }

    public function test_intervals_are_clipped_to_the_range(): void
    {
        $tz = new \DateTimeZone('Asia/Kuala_Lumpur');
        $from = new \DateTimeImmutable('2026-10-12T11:00:00+08:00');
        $to = new \DateTimeImmutable('2026-10-12T16:00:00+08:00');

        $this->assertEqualsWithDelta(4.0, self::totalHours(self::weekdays()->intervalsBetween($from, $to, $tz)), 0.001);
    }

    public function test_a_daylight_saving_day_has_25_hours(): void
    {
        $tz = new \DateTimeZone('America/New_York');
        $hours = WorkingHours::fromArray(['sun' => [['00:00', '24:00']]]);

        $intervals = $hours->intervalsBetween(Time::localMidnight('2026-11-01', $tz), Time::localMidnight('2026-11-02', $tz), $tz);

        $this->assertCount(1, $intervals);
        $this->assertEqualsWithDelta(25.0, $intervals[0]->hours(), 0.001);
    }

    public function test_to_array_always_has_seven_sorted_days(): void
    {
        $array = WorkingHours::fromArray(['wed' => [['14:00', '18:00'], ['08:00', '12:00']]])->toArray();
        $this->assertSame(WorkingHours::DAYS, array_keys($array));
        $this->assertSame([['08:00', '12:00'], ['14:00', '18:00']], $array['wed']);
        $this->assertSame([], $array['mon']);
    }

    /** @return array<string, array{0: array<mixed>, 1: string}> */
    public static function invalid(): array
    {
        return [
            'unknown day' => [['fun' => []], 'Unknown weekday "fun"'],
            'not a list' => [['mon' => 'nine to five'], 'mon: give a list'],
            'bad time format' => [['mon' => [['9:00', '13:00']]], 'mon: each range'],
            'end before start' => [['mon' => [['13:00', '09:00']]], 'must end after it starts'],
            'overlapping ranges' => [['mon' => [['09:00', '13:00'], ['12:00', '14:00']]], 'mon: ranges overlap'],
            'hour 25' => [['mon' => [['09:00', '25:00']]], 'mon: each range'],
        ];
    }

    /** @param array<mixed> $data */
    #[DataProvider('invalid')]
    public function test_rejects_invalid_hours(array $data, string $message): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage($message);
        WorkingHours::fromArray($data);
    }
}
```

`backend/tests/Unit/Domain/LocalDaysTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Domain;

use PHPUnit\Framework\TestCase;
use Planning\Domain\Interval;
use Planning\Domain\LocalDays;

final class LocalDaysTest extends TestCase
{
    public function test_an_overnight_shift_splits_at_local_midnight(): void
    {
        $shift = new Interval(new \DateTimeImmutable('2026-10-12T22:00:00+08:00'), new \DateTimeImmutable('2026-10-13T06:00:00+08:00'));

        $days = LocalDays::split($shift, new \DateTimeZone('Asia/Kuala_Lumpur'));

        $this->assertSame(['2026-10-12', '2026-10-13'], array_keys($days));
        $this->assertSame(2.0, $days['2026-10-12']->hours());
        $this->assertSame(6.0, $days['2026-10-13']->hours());
    }

    public function test_a_shift_inside_one_day_stays_whole(): void
    {
        $shift = new Interval(new \DateTimeImmutable('2026-10-12T09:00:00+08:00'), new \DateTimeImmutable('2026-10-12T17:00:00+08:00'));
        $this->assertSame(['2026-10-12'], array_keys(LocalDays::split($shift, new \DateTimeZone('Asia/Kuala_Lumpur'))));
    }

    public function test_the_long_daylight_saving_day_is_one_piece(): void
    {
        $tz = new \DateTimeZone('America/New_York');
        $day = new Interval(new \DateTimeImmutable('2026-11-01 00:00', $tz), new \DateTimeImmutable('2026-11-02 00:00', $tz));

        $days = LocalDays::split($day, $tz);

        $this->assertSame(['2026-11-01'], array_keys($days));
        $this->assertSame(25.0, $days['2026-11-01']->hours());
    }
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `php vendor/bin/phpunit --filter "IntervalTest|WorkingHoursTest|LocalDaysTest"`
Expected: FAIL with class-not-found errors.

- [ ] **Step 3: Implement the three classes**

`backend/src/Domain/Interval.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

/** A half-open span of time [start, end). */
final class Interval
{
    public function __construct(public readonly \DateTimeImmutable $start, public readonly \DateTimeImmutable $end)
    {
        if ($end <= $start) {
            throw new \InvalidArgumentException('An interval must end after it starts.');
        }
    }

    public function overlaps(Interval $other): bool
    {
        return $this->start < $other->end && $other->start < $this->end;
    }

    public function intersect(Interval $other): ?Interval
    {
        $start = $this->start > $other->start ? $this->start : $other->start;
        $end = $this->end < $other->end ? $this->end : $other->end;
        return $start < $end ? new Interval($start, $end) : null;
    }

    public function seconds(): int
    {
        return $this->end->getTimestamp() - $this->start->getTimestamp();
    }

    public function hours(): float
    {
        return $this->seconds() / 3600;
    }
}
```

`backend/src/Domain/WorkingHours.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

/** An employee's regular weekly schedule, in local wall-clock time (FR-CFG-02). */
final class WorkingHours
{
    public const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    /** @param array<string, list<array{0: string, 1: string}>> $days */
    private function __construct(private readonly array $days)
    {
    }

    /** @param array<mixed> $data weekday => list of ["HH:MM", "HH:MM"] */
    public static function fromArray(array $data): self
    {
        $days = array_fill_keys(self::DAYS, []);
        foreach ($data as $day => $ranges) {
            if (!in_array($day, self::DAYS, true)) {
                throw new \InvalidArgumentException("Unknown weekday \"$day\"; use mon to sun.");
            }
            if (!is_array($ranges) || !array_is_list($ranges)) {
                throw new \InvalidArgumentException("$day: give a list of [from, to] pairs.");
            }
            $clean = [];
            foreach ($ranges as $range) {
                if (!is_array($range) || count($range) !== 2 || !is_string($range[0] ?? null) || !is_string($range[1] ?? null)
                    || !self::validTime($range[0]) || !self::validTime($range[1])) {
                    throw new \InvalidArgumentException("$day: each range is [\"HH:MM\", \"HH:MM\"] between 00:00 and 24:00.");
                }
                if ($range[0] >= $range[1]) {
                    throw new \InvalidArgumentException("$day: {$range[0]}-{$range[1]} must end after it starts.");
                }
                $clean[] = [$range[0], $range[1]];
            }
            usort($clean, static fn (array $a, array $b): int => strcmp($a[0], $b[0]));
            for ($i = 1; $i < count($clean); $i++) {
                if ($clean[$i][0] < $clean[$i - 1][1]) {
                    throw new \InvalidArgumentException("$day: ranges overlap.");
                }
            }
            $days[$day] = $clean;
        }
        return new self($days);
    }

    /** @return array<string, list<array{0: string, 1: string}>> */
    public function toArray(): array
    {
        return $this->days;
    }

    /** @return list<Interval> working time inside [from, to), as UTC intervals */
    public function intervalsBetween(\DateTimeImmutable $from, \DateTimeImmutable $to, \DateTimeZone $tz): array
    {
        $range = new Interval($from, $to);
        $utc = new \DateTimeZone('UTC');
        $out = [];
        $end = $to->setTimezone($tz);
        for ($day = $from->setTimezone($tz)->setTime(0, 0); $day < $end; $day = $day->modify('+1 day')) {
            foreach ($this->days[self::DAYS[(int) $day->format('N') - 1]] as [$a, $b]) {
                $piece = (new Interval(self::at($day, $a), self::at($day, $b)))->intersect($range);
                if ($piece !== null) {
                    $out[] = new Interval($piece->start->setTimezone($utc), $piece->end->setTimezone($utc));
                }
            }
        }
        return $out;
    }

    private static function at(\DateTimeImmutable $localMidnight, string $hhmm): \DateTimeImmutable
    {
        if ($hhmm === '24:00') {
            return $localMidnight->modify('+1 day');
        }
        [$h, $m] = array_map('intval', explode(':', $hhmm));
        return $localMidnight->setTime($h, $m);
    }

    private static function validTime(string $t): bool
    {
        return $t === '24:00' || preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t) === 1;
    }
}
```

`backend/src/Domain/LocalDays.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

final class LocalDays
{
    /** @return array<string, Interval> local date (Y-m-d) => the part of $interval on that date */
    public static function split(Interval $interval, \DateTimeZone $tz): array
    {
        $out = [];
        $cursor = $interval->start;
        while ($cursor < $interval->end) {
            $local = $cursor->setTimezone($tz);
            $nextMidnight = $local->setTime(0, 0)->modify('+1 day');
            $pieceEnd = $nextMidnight < $interval->end ? $nextMidnight : $interval->end;
            $out[$local->format('Y-m-d')] = new Interval($cursor, $pieceEnd);
            $cursor = $pieceEnd;
        }
        return $out;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "IntervalTest|WorkingHoursTest|LocalDaysTest"`
Expected: PASS (3, 5 + 6 data sets, 3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/Domain backend/tests/Unit/Domain
git commit -m "feat: add time interval, working hours and local day calculations"
```

---

### Task 10: Allocation (BR-04) and conflicts (BR-01) as pure rules

**Files:**
- Create: `backend/src/Domain/ShiftFacts.php`, `Allocation.php`, `Conflict.php`, `UnavailableSpan.php`, `ConflictDetector.php`
- Test: `backend/tests/Unit/Domain/AllocationTest.php`, `ConflictDetectorTest.php`

**Interfaces:**
- Consumes: `Interval`, `LocalDays` (Task 9).
- Produces:
  - `ShiftFacts(string $id, ?string $employeeRef, ?string $roleId, Interval $interval, int $breakMinutes, int $percent)`.
  - `Allocation::shiftHours(ShiftFacts): float`, `Allocation::allocatedByDay(list<ShiftFacts>, \DateTimeZone): array<string,float>`, `Allocation::availableByDay(list<Interval> $working, list<Interval> $unavailable, \DateTimeZone): array<string,float>`, `Allocation::overAllocatedDays(array $allocated, ?array $available): list<string>`, `Allocation::subtract(Interval, list<Interval>): list<Interval>`.
  - `Conflict(string $rule, string $message)` with rules `OVERLAP`, `UNAVAILABLE`, `ROLE`; `->toArray(): array{rule: string, message: string}`.
  - `UnavailableSpan(Interval $interval, string $kind, string $label)` with kinds `TIME_OFF = 'time_off'`, `HOLIDAY = 'holiday'`.
  - `ConflictDetector::forEmployee(list<ShiftFacts> $shifts, list<UnavailableSpan> $unavailable, list<string> $employeeRoleIds): array<string, list<Conflict>>` (every shift id is a key), `ConflictDetector::peakPercent(ShiftFacts $shift, list<ShiftFacts> $all): int`.

The rules, copied from the spec:
- **BR-01:** a shift conflicts when (a) the shifts overlapping it, counting itself, add up to more than 100% at some moment, (b) it overlaps time off or a public holiday, or (c) its role isn't one of the employee's roles. Rule (c) is checked only when the employee has roles. Open shifts never conflict. Over-allocation is not a conflict.
- **BR-04:** allocated hours = (duration − break) × percent. Time outside working hours counts. Available hours per day = working hours minus unavailability, and flexible-hours employees have no limit. A day is over-allocated when allocated hours exceed available hours. A shift spanning midnight counts on each day it covers, and its break is shared out in proportion to the time on each day.

- [ ] **Step 1: Write the failing tests**

`backend/tests/Unit/Domain/AllocationTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Domain;

use PHPUnit\Framework\TestCase;
use Planning\Domain\Allocation;
use Planning\Domain\Interval;
use Planning\Domain\ShiftFacts;
use Planning\Domain\WorkingHours;
use Planning\Support\Time;

final class AllocationTest extends TestCase
{
    private \DateTimeZone $kl;

    protected function setUp(): void
    {
        $this->kl = new \DateTimeZone('Asia/Kuala_Lumpur');
    }

    private static function shift(string $start, string $end, int $break = 0, int $percent = 100, string $id = 's1'): ShiftFacts
    {
        return new ShiftFacts($id, 'E1', null, new Interval(new \DateTimeImmutable($start), new \DateTimeImmutable($end)), $break, $percent);
    }

    public function test_shift_hours_subtract_break_and_apply_percent(): void
    {
        $this->assertSame(7.0, Allocation::shiftHours(self::shift('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00', 60)));
        $this->assertSame(3.5, Allocation::shiftHours(self::shift('2026-10-12T09:00:00+08:00', '2026-10-12T17:00:00+08:00', 60, 50)));
    }

    public function test_overnight_shift_counts_on_both_days_with_break_shared(): void
    {
        $byDay = Allocation::allocatedByDay([self::shift('2026-10-12T22:00:00+08:00', '2026-10-13T06:00:00+08:00', 60)], $this->kl);
        $this->assertSame(['2026-10-12' => 1.75, '2026-10-13' => 5.25], $byDay);
    }

    public function test_available_hours_subtract_time_off(): void
    {
        $day = [['09:00', '13:00'], ['14:00', '18:00']];
        $from = Time::localMidnight('2026-10-12', $this->kl);
        $working = WorkingHours::fromArray(['mon' => $day])->intervalsBetween($from, $from->modify('+1 day'), $this->kl);
        $leave = new Interval(new \DateTimeImmutable('2026-10-12T14:00:00+08:00'), new \DateTimeImmutable('2026-10-12T18:00:00+08:00'));

        $this->assertSame(['2026-10-12' => 4.0], Allocation::availableByDay($working, [$leave], $this->kl));
    }

    public function test_over_allocated_days_include_days_without_working_hours(): void
    {
        $allocated = ['2026-10-12' => 9.0, '2026-10-13' => 2.0, '2026-10-17' => 4.0];
        $available = ['2026-10-12' => 8.0, '2026-10-13' => 8.0];

        $this->assertSame(['2026-10-12', '2026-10-17'], Allocation::overAllocatedDays($allocated, $available));
        $this->assertSame([], Allocation::overAllocatedDays($allocated, null), 'flexible hours are never over-allocated');
    }

    public function test_subtract_splits_around_a_cut(): void
    {
        $base = new Interval(new \DateTimeImmutable('2026-10-12T00:00:00Z'), new \DateTimeImmutable('2026-10-12T10:00:00Z'));
        $cut = new Interval(new \DateTimeImmutable('2026-10-12T04:00:00Z'), new \DateTimeImmutable('2026-10-12T06:00:00Z'));

        $pieces = Allocation::subtract($base, [$cut]);

        $this->assertCount(2, $pieces);
        $this->assertSame(4.0, $pieces[0]->hours());
        $this->assertSame(4.0, $pieces[1]->hours());
    }
}
```

`backend/tests/Unit/Domain/ConflictDetectorTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Domain;

use PHPUnit\Framework\TestCase;
use Planning\Domain\Conflict;
use Planning\Domain\ConflictDetector;
use Planning\Domain\Interval;
use Planning\Domain\ShiftFacts;
use Planning\Domain\UnavailableSpan;

final class ConflictDetectorTest extends TestCase
{
    private static function at(string $hhmm): \DateTimeImmutable
    {
        return new \DateTimeImmutable("2026-10-12T{$hhmm}:00+08:00");
    }

    private static function shift(string $id, string $from, string $to, int $percent = 100, ?string $role = null): ShiftFacts
    {
        return new ShiftFacts($id, 'E1', $role, new Interval(self::at($from), self::at($to)), 0, $percent);
    }

    /** @param array<string, list<Conflict>> $result */
    private static function rules(array $result, string $id): array
    {
        return array_map(static fn (Conflict $c): string => $c->rule, $result[$id]);
    }

    public function test_two_full_overlapping_shifts_both_conflict(): void
    {
        $result = ConflictDetector::forEmployee([self::shift('a', '09:00', '13:00'), self::shift('b', '12:00', '17:00')], [], []);
        $this->assertSame([Conflict::OVERLAP], self::rules($result, 'a'));
        $this->assertSame([Conflict::OVERLAP], self::rules($result, 'b'));
    }

    public function test_half_time_shifts_may_overlap(): void
    {
        $result = ConflictDetector::forEmployee([self::shift('a', '09:00', '17:00', 50), self::shift('b', '09:00', '17:00', 50)], [], []);
        $this->assertSame([], $result['a']);
        $this->assertSame([], $result['b']);
    }

    public function test_back_to_back_shifts_do_not_conflict(): void
    {
        $result = ConflictDetector::forEmployee([self::shift('a', '09:00', '13:00'), self::shift('b', '13:00', '17:00')], [], []);
        $this->assertSame([], $result['a']);
    }

    public function test_peak_is_measured_inside_the_shift(): void
    {
        $all = [self::shift('a', '09:00', '17:00', 60), self::shift('b', '09:00', '11:00', 30), self::shift('c', '15:00', '17:00', 30)];
        $this->assertSame(90, ConflictDetector::peakPercent($all[0], $all));
    }

    public function test_time_off_and_holidays(): void
    {
        $leave = new UnavailableSpan(new Interval(self::at('12:00'), self::at('18:00')), UnavailableSpan::TIME_OFF, 'Medical appointment');
        $result = ConflictDetector::forEmployee([self::shift('a', '09:00', '13:00'), self::shift('b', '08:00', '12:00')], [$leave], []);

        $this->assertSame([Conflict::UNAVAILABLE], self::rules($result, 'a'));
        $this->assertSame('The employee is on time off: Medical appointment.', $result['a'][0]->message);
        $this->assertSame([], $result['b']);

        $holiday = new UnavailableSpan(new Interval(self::at('00:00'), self::at('23:59')), UnavailableSpan::HOLIDAY, 'Deepavali');
        $result = ConflictDetector::forEmployee([self::shift('a', '09:00', '13:00')], [$holiday], []);
        $this->assertSame('Falls on a public holiday: Deepavali.', $result['a'][0]->message);
    }

    public function test_role_rule_only_when_the_employee_has_roles(): void
    {
        $shift = self::shift('a', '09:00', '13:00', 100, 'role-tech');
        $this->assertSame([Conflict::ROLE], self::rules(ConflictDetector::forEmployee([$shift], [], ['role-reception']), 'a'));
        $this->assertSame([], ConflictDetector::forEmployee([$shift], [], ['role-tech'])['a']);
        $this->assertSame([], ConflictDetector::forEmployee([$shift], [], [])['a']);
    }
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `php vendor/bin/phpunit --filter "AllocationTest|ConflictDetectorTest"`
Expected: FAIL with class-not-found errors.

- [ ] **Step 3: Implement the value types**

`backend/src/Domain/ShiftFacts.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

/** The parts of a shift the planning rules need. */
final class ShiftFacts
{
    public function __construct(
        public readonly string $id,
        public readonly ?string $employeeRef,
        public readonly ?string $roleId,
        public readonly Interval $interval,
        public readonly int $breakMinutes,
        public readonly int $percent,
    ) {
    }
}
```

`backend/src/Domain/Conflict.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

final class Conflict
{
    public const OVERLAP = 'overlap';
    public const UNAVAILABLE = 'unavailable';
    public const ROLE = 'role';

    public function __construct(public readonly string $rule, public readonly string $message)
    {
    }

    /** @return array{rule: string, message: string} */
    public function toArray(): array
    {
        return ['rule' => $this->rule, 'message' => $this->message];
    }
}
```

`backend/src/Domain/UnavailableSpan.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

final class UnavailableSpan
{
    public const TIME_OFF = 'time_off';
    public const HOLIDAY = 'holiday';

    public function __construct(public readonly Interval $interval, public readonly string $kind, public readonly string $label)
    {
    }
}
```

- [ ] **Step 4: Implement the rules**

`backend/src/Domain/Allocation.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

/** BR-04 */
final class Allocation
{
    public static function shiftHours(ShiftFacts $shift): float
    {
        $paidSeconds = max(0, $shift->interval->seconds() - $shift->breakMinutes * 60);
        return round($paidSeconds / 3600 * $shift->percent / 100, 2);
    }

    /**
     * @param list<ShiftFacts> $shifts one employee's shifts
     * @return array<string, float> local date => allocated hours
     */
    public static function allocatedByDay(array $shifts, \DateTimeZone $tz): array
    {
        $byDay = [];
        foreach ($shifts as $shift) {
            $total = $shift->interval->seconds();
            $paidRatio = max(0, $total - $shift->breakMinutes * 60) / $total;
            foreach (LocalDays::split($shift->interval, $tz) as $date => $piece) {
                $byDay[$date] = ($byDay[$date] ?? 0.0) + $piece->hours() * $paidRatio * $shift->percent / 100;
            }
        }
        ksort($byDay);
        return array_map(static fn (float $h): float => round($h, 2), $byDay);
    }

    /**
     * @param list<Interval> $working
     * @param list<Interval> $unavailable
     * @return array<string, float> local date => available hours
     */
    public static function availableByDay(array $working, array $unavailable, \DateTimeZone $tz): array
    {
        $byDay = [];
        foreach ($working as $interval) {
            foreach (self::subtract($interval, $unavailable) as $piece) {
                foreach (LocalDays::split($piece, $tz) as $date => $part) {
                    $byDay[$date] = ($byDay[$date] ?? 0.0) + $part->hours();
                }
            }
        }
        ksort($byDay);
        return array_map(static fn (float $h): float => round($h, 2), $byDay);
    }

    /**
     * @param array<string, float> $allocatedByDay
     * @param array<string, float>|null $availableByDay null = flexible hours
     * @return list<string>
     */
    public static function overAllocatedDays(array $allocatedByDay, ?array $availableByDay): array
    {
        if ($availableByDay === null) {
            return [];
        }
        $over = [];
        foreach ($allocatedByDay as $date => $hours) {
            if ($hours > ($availableByDay[$date] ?? 0.0) + 0.005) {
                $over[] = (string) $date;
            }
        }
        return $over;
    }

    /**
     * @param list<Interval> $cuts
     * @return list<Interval> what is left of $base after removing every cut
     */
    public static function subtract(Interval $base, array $cuts): array
    {
        $pieces = [$base];
        foreach ($cuts as $cut) {
            $next = [];
            foreach ($pieces as $piece) {
                if (!$piece->overlaps($cut)) {
                    $next[] = $piece;
                    continue;
                }
                if ($cut->start > $piece->start) {
                    $next[] = new Interval($piece->start, $cut->start);
                }
                if ($cut->end < $piece->end) {
                    $next[] = new Interval($cut->end, $piece->end);
                }
            }
            $pieces = $next;
        }
        return $pieces;
    }
}
```

`backend/src/Domain/ConflictDetector.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Domain;

/** BR-01 */
final class ConflictDetector
{
    /**
     * @param list<ShiftFacts> $shifts every shift of ONE employee that could overlap the ones being checked
     * @param list<UnavailableSpan> $unavailable
     * @param list<string> $employeeRoleIds empty = role rule not checked
     * @return array<string, list<Conflict>> shift id => conflicts (empty list when none)
     */
    public static function forEmployee(array $shifts, array $unavailable, array $employeeRoleIds): array
    {
        $result = [];
        foreach ($shifts as $shift) {
            $conflicts = [];
            $peak = self::peakPercent($shift, $shifts);
            if ($peak > 100) {
                $conflicts[] = new Conflict(Conflict::OVERLAP, "Overlaps other shifts; allocation reaches {$peak}%.");
            }
            foreach ($unavailable as $span) {
                if ($span->interval->overlaps($shift->interval)) {
                    $conflicts[] = new Conflict(Conflict::UNAVAILABLE, $span->kind === UnavailableSpan::HOLIDAY
                        ? "Falls on a public holiday: {$span->label}."
                        : 'The employee is on time off' . ($span->label !== '' ? ": {$span->label}" : '') . '.');
                    break;
                }
            }
            if ($shift->roleId !== null && $employeeRoleIds !== [] && !in_array($shift->roleId, $employeeRoleIds, true)) {
                $conflicts[] = new Conflict(Conflict::ROLE, 'The employee does not have this shift\'s role.');
            }
            $result[$shift->id] = $conflicts;
        }
        return $result;
    }

    /**
     * Highest total allocated percentage at any moment inside $shift, counting $shift itself.
     *
     * @param list<ShiftFacts> $all
     */
    public static function peakPercent(ShiftFacts $shift, array $all): int
    {
        $events = [];
        foreach ($all as $other) {
            $overlap = $other->interval->intersect($shift->interval);
            if ($overlap === null) {
                continue;
            }
            $events[] = [$overlap->start->getTimestamp(), $other->percent];
            $events[] = [$overlap->end->getTimestamp(), -$other->percent];
        }
        // At the same instant, endings (negative) come before starts, so back-to-back shifts never add up.
        usort($events, static fn (array $a, array $b): int => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
        $current = 0;
        $peak = 0;
        foreach ($events as [, $delta]) {
            $current += $delta;
            $peak = max($peak, $current);
        }
        return $peak;
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "AllocationTest|ConflictDetectorTest"`
Expected: PASS (5, 6).

- [ ] **Step 6: Commit**

```bash
git add backend/src/Domain backend/tests/Unit/Domain
git commit -m "feat: add allocation and conflict rules"
```

---

### Task 11: Input validation, API test harness, settings and roles

**Files:**
- Create: `backend/src/Http/Input.php`
- Create: `backend/src/Repo/SettingsRepository.php`, `backend/src/Repo/RoleRepository.php`
- Create: `backend/src/Http/Controllers/SettingsController.php`, `backend/src/Http/Controllers/RoleController.php`
- Create: `backend/tests/Support/TestGuard.php`, `backend/tests/Support/ApiTestCase.php`, `backend/tests/Support/FakeHolidayProvider.php`
- Create: `backend/src/Holidays/HolidayProvider.php`, `backend/src/Holidays/NullHolidayProvider.php` (needed by `ApiTestCase`; used in Task 13)
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Unit/Http/InputTest.php`, `backend/tests/Integration/Api/SettingsApiTest.php`, `backend/tests/Integration/Api/RolesApiTest.php`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces:
  - `Input(array $data)` with these methods:
    - `->has(string): bool`, `->raw(string): mixed`
    - `->string(string $key, int $max, bool $required = false): ?string`
    - `->int(string $key, int $min, int $max, ?int $default = null): ?int`
    - `->bool(string $key, bool $default = false): bool`
    - `->instant(string $key, bool $required = false): ?\DateTimeImmutable` (UTC, truncated to the minute)
    - `->date(string $key, bool $required = false): ?string`
    - `->dateRange(string $fromKey, string $toKey, int $maxDays): ?array{0:string,1:string}`
    - `->stringList(string $key, int $maxItems, bool $required = false): ?list<string>`
    - `->error(string $key, string $message): void`, `->check(): void` (throws a 422 `HttpError`)
  - `SettingsRepository(\PDO, string $org, string $defaultTimezone)`, `->get(): array{country_code: ?string, region_code: ?string, timezone: string}`, `->timezone(): \DateTimeZone`, `->save(?string $country, ?string $region, string $timezone, \DateTimeImmutable $now): void`.
  - `RoleRepository(\PDO, string $org)`. Each role is `array{id, name, color, archived: bool}`. Methods:
    - `->all(bool $includeArchived = true): list<role>`
    - `->find(string $id): ?role`
    - `->nameTaken(string $name, ?string $exceptId): bool`
    - `->create(string $name, string $color, \DateTimeImmutable $now): role`
    - `->update(string $id, array $fields, \DateTimeImmutable $now): role`
    - `->ids(): array<string, bool>` (id => archived)
  - `HolidayProvider::isConfigured(): bool`, `HolidayProvider::holidays(int $year, string $countryCode, ?string $regionCode): list<array{key: string, date: string, name: string}>`; `NullHolidayProvider`.
  - Endpoints:
    - `GET /api/roles` (person; `?include_archived=true` includes archived roles)
    - `POST /api/roles` and `PATCH /api/roles/{id}` (manager)
    - `GET /api/settings` and `PATCH /api/settings` (manager)
  - `ApiTestCase` with:
    - `$app`, `$guard`, `$clock` (2026-10-13T02:00:00Z, a Tuesday), `$roster`, `$departments`, `$holidayProvider`
    - `asManager(string $email = 'mona@example.com')`, `asEmployee(?string $ref, string $email = 'ana@example.com')`, `asNobody()`
    - `call(string $method, string $path, ?array $body = null, array $query = []): array{0:int, 1:mixed}`
    - `addEmployee(string $ref, string $name, ?string $departmentId = null, ?string $departmentName = null): void`
    - `addRole(string $name, string $color = '#3B82F6'): string` (returns the new role id)
  - `App` getters: `defaultTimezone()`, `settings()`, `roles()`, `holidayProvider()`, `settingsController()`, `roleController()`.

- [ ] **Step 1: Write the failing `Input` test**

`backend/tests/Unit/Http/InputTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Unit\Http;

use PHPUnit\Framework\TestCase;
use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Support\Time;

final class InputTest extends TestCase
{
    /** @return array<string,string> */
    private static function errors(Input $in): array
    {
        try {
            $in->check();
            return [];
        } catch (HttpError $e) {
            return $e->details;
        }
    }

    public function test_instant_needs_an_offset_and_is_stored_in_utc_to_the_minute(): void
    {
        $in = new Input(['a' => '2026-10-13T09:00:30+08:00', 'b' => '2026-10-13T09:00:00', 'c' => '2026-02-30T09:00:00+08:00']);

        $this->assertSame('2026-10-13T01:00:00Z', Time::iso($in->instant('a')));
        $this->assertNull($in->instant('b'));
        $this->assertNull($in->instant('c'));
        $errors = self::errors($in);
        $this->assertStringContainsString('time zone offset', $errors['b']);
        $this->assertSame('Not a real date-time.', $errors['c']);
    }

    public function test_required_string_and_length(): void
    {
        $in = new Input(['name' => '  ', 'long' => str_repeat('x', 6)]);
        $in->string('name', 10, true);
        $in->string('long', 5);
        $this->assertSame(['name' => 'This field is required.', 'long' => 'Must be at most 5 characters.'], self::errors($in));
    }

    public function test_int_rejects_strings_and_out_of_range(): void
    {
        $in = new Input(['a' => '5', 'b' => 101, 'c' => 50]);
        $this->assertSame(1, $in->int('a', 1, 100, 1));
        $in->int('b', 1, 100);
        $this->assertSame(50, $in->int('c', 1, 100));
        $this->assertSame(['a' => 'Must be a whole number.', 'b' => 'Must be between 1 and 100.'], self::errors($in));
    }

    public function test_dates_and_ranges(): void
    {
        $in = new Input(['from' => '2026-10-12', 'to' => '2026-10-18', 'bad' => '2026-13-01']);
        $this->assertSame(['2026-10-12', '2026-10-18'], $in->dateRange('from', 'to', 62));
        $this->assertNull($in->date('bad'));

        $tooLong = new Input(['from' => '2026-01-01', 'to' => '2026-12-31']);
        $this->assertNull($tooLong->dateRange('from', 'to', 62));
        $this->assertSame(['to' => 'The range can be at most 62 days.'], self::errors($tooLong));

        $backwards = new Input(['from' => '2026-10-12', 'to' => '2026-10-11']);
        $this->assertNull($backwards->dateRange('from', 'to', 62));
    }

    public function test_string_list(): void
    {
        $in = new Input(['ok' => ['a', 'b', 'a'], 'bad' => ['a', 3], 'map' => ['x' => 'a']]);
        $this->assertSame(['a', 'b'], $in->stringList('ok', 10));
        $this->assertNull($in->stringList('bad', 10));
        $this->assertNull($in->stringList('map', 10));
        $this->assertArrayHasKey('bad', self::errors($in));
    }
}
```

- [ ] **Step 2: Run it to make sure it fails, then implement `Input`**

Run: `php vendor/bin/phpunit --filter InputTest`
Expected: FAIL with `Class "Planning\Http\Input" not found`.

`backend/src/Http/Input.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http;

use Planning\Support\Time;

/**
 * Reads and validates one request body or query string, collecting every
 * problem so the caller gets all field errors in one 422 (contract SS-11).
 */
final class Input
{
    /** @var array<string,string> */
    private array $errors = [];

    /** @param array<string,mixed> $data */
    public function __construct(private readonly array $data)
    {
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->data);
    }

    public function raw(string $key): mixed
    {
        return $this->data[$key] ?? null;
    }

    public function string(string $key, int $max, bool $required = false): ?string
    {
        $value = $this->data[$key] ?? null;
        if ($value === null || (is_string($value) && trim($value) === '')) {
            if ($required) {
                $this->error($key, 'This field is required.');
            }
            return null;
        }
        if (!is_string($value)) {
            $this->error($key, 'Must be a string.');
            return null;
        }
        $value = trim($value);
        if (mb_strlen($value) > $max) {
            $this->error($key, "Must be at most $max characters.");
            return null;
        }
        return $value;
    }

    public function int(string $key, int $min, int $max, ?int $default = null): ?int
    {
        $value = $this->data[$key] ?? null;
        if ($value === null) {
            return $default;
        }
        if (!is_int($value)) {
            $this->error($key, 'Must be a whole number.');
            return $default;
        }
        if ($value < $min || $value > $max) {
            $this->error($key, "Must be between $min and $max.");
            return $default;
        }
        return $value;
    }

    public function bool(string $key, bool $default = false): bool
    {
        $value = $this->data[$key] ?? null;
        if ($value === null) {
            return $default;
        }
        if (!is_bool($value)) {
            $this->error($key, 'Must be true or false.');
            return $default;
        }
        return $value;
    }

    /** ISO 8601 with an explicit offset; returned in UTC, seconds dropped. */
    public function instant(string $key, bool $required = false): ?\DateTimeImmutable
    {
        $value = $this->data[$key] ?? null;
        if ($value === null || $value === '') {
            if ($required) {
                $this->error($key, 'This field is required.');
            }
            return null;
        }
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/', $value)) {
            $this->error($key, 'Use an ISO 8601 date-time with a time zone offset, e.g. 2026-10-13T09:00:00+08:00.');
            return null;
        }
        try {
            $parsed = new \DateTimeImmutable($value);
        } catch (\Exception) {
            $this->error($key, 'Not a real date-time.');
            return null;
        }
        if ($parsed->format('Y-m-d') !== substr($value, 0, 10)) {
            $this->error($key, 'Not a real date-time.');
            return null;
        }
        $utc = $parsed->setTimezone(Time::utc());
        return $utc->setTime((int) $utc->format('H'), (int) $utc->format('i'));
    }

    public function date(string $key, bool $required = false): ?string
    {
        $value = $this->data[$key] ?? null;
        if ($value === null || $value === '') {
            if ($required) {
                $this->error($key, 'This field is required.');
            }
            return null;
        }
        $parsed = is_string($value) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $value, Time::utc()) : false;
        if ($parsed === false || $parsed->format('Y-m-d') !== $value) {
            $this->error($key, 'Use a real date in YYYY-MM-DD format.');
            return null;
        }
        return $value;
    }

    /** @return array{0: string, 1: string}|null inclusive [from, to] */
    public function dateRange(string $fromKey, string $toKey, int $maxDays): ?array
    {
        $from = $this->date($fromKey, true);
        $to = $this->date($toKey, true);
        if ($from === null || $to === null) {
            return null;
        }
        $days = intdiv(strtotime($to . 'T00:00:00Z') - strtotime($from . 'T00:00:00Z'), 86400) + 1;
        if ($days < 1) {
            $this->error($toKey, "Must be on or after $fromKey.");
            return null;
        }
        if ($days > $maxDays) {
            $this->error($toKey, "The range can be at most $maxDays days.");
            return null;
        }
        return [$from, $to];
    }

    /** @return list<string>|null */
    public function stringList(string $key, int $maxItems, bool $required = false): ?array
    {
        $value = $this->data[$key] ?? null;
        if ($value === null) {
            if ($required) {
                $this->error($key, 'This field is required.');
            }
            return null;
        }
        if (!is_array($value) || !array_is_list($value) || count($value) > $maxItems) {
            $this->error($key, "Must be a list of at most $maxItems strings.");
            return null;
        }
        foreach ($value as $item) {
            if (!is_string($item) || $item === '' || strlen($item) > 64) {
                $this->error($key, 'Every item must be a non-empty string of at most 64 characters.');
                return null;
            }
        }
        return array_values(array_unique($value));
    }

    public function error(string $key, string $message): void
    {
        $this->errors[$key] ??= $message;
    }

    public function check(): void
    {
        if ($this->errors !== []) {
            throw HttpError::validation($this->errors);
        }
    }
}
```

Run: `php vendor/bin/phpunit --filter InputTest`
Expected: PASS (5 tests).

- [ ] **Step 3: Add the holiday provider contract**

`ApiTestCase` replaces the holiday provider, so its interface has to exist before Task 13.

`backend/src/Holidays/HolidayProvider.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Holidays;

/** IF-06. Which provider to use is open issue OI-02; add one adapter class when it is decided. */
interface HolidayProvider
{
    public function isConfigured(): bool;

    /** @return list<array{key: string, date: string, name: string}> key is stable across syncs */
    public function holidays(int $year, string $countryCode, ?string $regionCode): array;
}
```

`backend/src/Holidays/NullHolidayProvider.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Holidays;

final class NullHolidayProvider implements HolidayProvider
{
    public function isConfigured(): bool
    {
        return false;
    }

    public function holidays(int $year, string $countryCode, ?string $regionCode): array
    {
        return [];
    }
}
```

`backend/tests/Support/FakeHolidayProvider.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\Holidays\HolidayProvider;

final class FakeHolidayProvider implements HolidayProvider
{
    public bool $configured = false;
    /** @var list<array{key: string, date: string, name: string}> */
    public array $list = [];
    /** @var list<array{0: int, 1: string, 2: ?string}> */
    public array $calls = [];

    public function isConfigured(): bool
    {
        return $this->configured;
    }

    public function holidays(int $year, string $countryCode, ?string $regionCode): array
    {
        $this->calls[] = [$year, $countryCode, $regionCode];
        return $this->list;
    }
}
```

- [ ] **Step 4: Add the API test harness**

`backend/tests/Support/TestGuard.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\Auth\Principal;
use Planning\Http\AccessGuard;
use Planning\Http\AccessResult;
use Planning\Http\HttpError;
use Planning\Http\Request;
use Planning\Http\Route;

/** Same access rules as GatewayAccessGuard, with the principal set directly by the test. */
final class TestGuard implements AccessGuard
{
    public ?Principal $principal = null;

    public function check(Route $route, Request $request): AccessResult
    {
        if ($route->access === Route::PUBLIC || $route->access === Route::INTERNAL) {
            return new AccessResult(null);
        }
        if ($this->principal === null) {
            throw HttpError::unauthorized('Not signed in.');
        }
        if ($route->access === Route::MANAGER && !$this->principal->isManager) {
            throw HttpError::forbidden('Only Planning Managers can do this.');
        }
        return new AccessResult($this->principal);
    }
}
```

`backend/tests/Support/ApiTestCase.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Support;

use Planning\App;
use Planning\Auth\Principal;
use Planning\Http\Request;
use Planning\Roster\DirectoryRefresher;
use Planning\Support\Time;

/** Drives the real kernel, routes, controllers and MySQL, with fakes for everything outside Planning. */
abstract class ApiTestCase extends DatabaseTestCase
{
    protected App $app;
    protected TestGuard $guard;
    protected FixedClock $clock;
    protected FakeRoster $roster;
    protected FakeDepartments $departments;
    protected FakeHolidayProvider $holidayProvider;
    private string $backoffFile;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('ORGANISATION_ID=' . self::ORG);
        putenv('DEFAULT_TIMEZONE=Asia/Kuala_Lumpur');

        $this->app = new App();
        $this->clock = FixedClock::at('2026-10-13T02:00:00Z');
        $this->guard = new TestGuard();
        $this->roster = new FakeRoster();
        $this->departments = new FakeDepartments();
        $this->holidayProvider = new FakeHolidayProvider();
        $this->backoffFile = sys_get_temp_dir() . '/planning-test-backoff-' . bin2hex(random_bytes(4));

        $logger = static function (string $line): void {
        };
        $this->app->override('pdo', $this->pdo());
        $this->app->override('clock', $this->clock);
        $this->app->override('guard', $this->guard);
        $this->app->override('logger', $logger);
        $this->app->override('roster', $this->roster);
        $this->app->override('departments', $this->departments);
        $this->app->override('holidayProvider', $this->holidayProvider);
        $this->app->override('directoryRefresher', new DirectoryRefresher($this->roster, $this->departments, $this->app->directory(), $this->clock, $this->backoffFile, $logger));

        $this->asManager();
    }

    protected function tearDown(): void
    {
        @unlink($this->backoffFile);
        putenv('ORGANISATION_ID');
        putenv('DEFAULT_TIMEZONE');
        parent::tearDown();
    }

    protected function asManager(string $email = 'mona@example.com'): void
    {
        $this->guard->principal = new Principal('person', 'sub-' . $email, $email, 'Mona Manager', 'user', null, true);
    }

    protected function asEmployee(?string $ref, string $email = 'ana@example.com'): void
    {
        $this->guard->principal = new Principal('person', 'sub-' . $email, $email, 'Ana Lim', 'user', $ref, false);
    }

    protected function asNobody(): void
    {
        $this->guard->principal = null;
    }

    /**
     * @param array<string,mixed>|null $body
     * @param array<string,string|int> $query
     * @return array{0: int, 1: mixed}
     */
    protected function call(string $method, string $path, ?array $body = null, array $query = []): array
    {
        $request = new Request(
            $method,
            $path,
            array_map('strval', $query),
            ['content-type' => 'application/json'],
            $body === null ? '' : json_encode($body, JSON_THROW_ON_ERROR),
        );
        $response = $this->app->kernel()->handle($request);
        return [$response->status, $response->decoded()];
    }

    protected function addEmployee(string $ref, string $name, ?string $departmentId = null, ?string $departmentName = null): void
    {
        $this->pdo()->prepare('INSERT INTO employee_directory (organisation_id, employee_ref, display_name, photo_url, department_id, department_name, status, fetched_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
            ->execute([self::ORG, $ref, $name, $departmentId, $departmentName, 'Active', Time::db($this->clock->now())]);
    }

    protected function addRole(string $name, string $color = '#3B82F6'): string
    {
        [$status, $body] = $this->call('POST', '/api/roles', ['name' => $name, 'color' => $color]);
        $this->assertSame(201, $status, json_encode($body));
        return $body['role']['id'];
    }
}
```

- [ ] **Step 5: Write the failing API tests**

`backend/tests/Integration/Api/SettingsApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Tests\Support\ApiTestCase;

final class SettingsApiTest extends ApiTestCase
{
    public function test_defaults_come_from_the_environment(): void
    {
        [$status, $body] = $this->call('GET', '/api/settings');
        $this->assertSame(200, $status);
        $this->assertSame(['country_code' => null, 'region_code' => null, 'timezone' => 'Asia/Kuala_Lumpur'], $body['settings']);
    }

    public function test_patch_saves_and_keeps_absent_fields(): void
    {
        $this->call('PATCH', '/api/settings', ['country_code' => 'MY', 'region_code' => 'MY-10']);
        [$status, $body] = $this->call('PATCH', '/api/settings', ['timezone' => 'Asia/Singapore']);

        $this->assertSame(200, $status);
        $this->assertSame(['country_code' => 'MY', 'region_code' => 'MY-10', 'timezone' => 'Asia/Singapore'], $body['settings']);
    }

    public function test_invalid_values_are_422_with_fields(): void
    {
        [$status, $body] = $this->call('PATCH', '/api/settings', ['country_code' => 'my', 'timezone' => 'Mars/Olympus']);
        $this->assertSame(422, $status);
        $this->assertSame(['country_code', 'timezone'], array_keys($body['error']['details']));
    }

    public function test_employees_cannot_read_settings(): void
    {
        $this->asEmployee('E1');
        $this->assertSame(403, $this->call('GET', '/api/settings')[0]);
    }
}
```

`backend/tests/Integration/Api/RolesApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Tests\Support\ApiTestCase;

final class RolesApiTest extends ApiTestCase
{
    public function test_create_and_list(): void
    {
        [$status, $body] = $this->call('POST', '/api/roles', ['name' => ' Technician ', 'color' => '#22c55e']);

        $this->assertSame(201, $status);
        $this->assertSame('Technician', $body['role']['name']);
        $this->assertSame('#22C55E', $body['role']['color']);
        $this->assertFalse($body['role']['archived']);

        $this->asEmployee('E1');
        [$status, $list] = $this->call('GET', '/api/roles');
        $this->assertSame(200, $status);
        $this->assertSame(['Technician'], array_column($list['roles'], 'name'));
    }

    public function test_duplicate_names_ignore_case(): void
    {
        $this->addRole('Technician');
        [$status, $body] = $this->call('POST', '/api/roles', ['name' => 'technician', 'color' => '#000000']);
        $this->assertSame(409, $status);
        $this->assertSame('ROLE_NAME_TAKEN', $body['error']['code']);
    }

    public function test_validation(): void
    {
        [$status, $body] = $this->call('POST', '/api/roles', ['name' => '', 'color' => 'green']);
        $this->assertSame(422, $status);
        $this->assertSame(['name', 'color'], array_keys($body['error']['details']));
    }

    public function test_rename_recolour_and_archive(): void
    {
        $id = $this->addRole('Technician');

        [$status, $body] = $this->call('PATCH', "/api/roles/$id", ['name' => 'Field Technician', 'archived' => true]);

        $this->assertSame(200, $status);
        $this->assertSame('Field Technician', $body['role']['name']);
        $this->assertTrue($body['role']['archived']);
        $this->assertSame([], $this->call('GET', '/api/roles')[1]['roles'], 'archived roles are hidden by default');
        $this->assertCount(1, $this->call('GET', '/api/roles', null, ['include_archived' => 'true'])[1]['roles']);
    }

    public function test_unknown_role_is_404(): void
    {
        $this->assertSame(404, $this->call('PATCH', '/api/roles/nope', ['name' => 'X'])[0]);
    }

    public function test_employees_cannot_create_roles(): void
    {
        $this->asEmployee('E1');
        $this->assertSame(403, $this->call('POST', '/api/roles', ['name' => 'X', 'color' => '#000000'])[0]);
    }

    public function test_signed_out_is_401(): void
    {
        $this->asNobody();
        $this->assertSame(401, $this->call('GET', '/api/roles')[0]);
    }
}
```

Run: `php vendor/bin/phpunit --filter "SettingsApiTest|RolesApiTest"`
Expected: FAIL, because the routes don't exist yet (404s) and `App::override('holidayProvider')` refers to code not written yet.

- [ ] **Step 6: Implement the repositories**

`backend/src/Repo/SettingsRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;

final class SettingsRepository
{
    public function __construct(private readonly PDO $pdo, private readonly string $org, private readonly string $defaultTimezone)
    {
    }

    /** @return array{country_code: ?string, region_code: ?string, timezone: string} */
    public function get(): array
    {
        $st = $this->pdo->prepare('SELECT country_code, region_code, timezone FROM organisation_settings WHERE organisation_id = ?');
        $st->execute([$this->org]);
        $row = $st->fetch();
        return $row === false ? ['country_code' => null, 'region_code' => null, 'timezone' => $this->defaultTimezone] : $row;
    }

    public function timezone(): \DateTimeZone
    {
        return new \DateTimeZone($this->get()['timezone']);
    }

    public function save(?string $countryCode, ?string $regionCode, string $timezone, \DateTimeImmutable $now): void
    {
        $this->pdo->prepare(
            'INSERT INTO organisation_settings (organisation_id, country_code, region_code, timezone, updated_at) VALUES (?, ?, ?, ?, ?) AS new
             ON DUPLICATE KEY UPDATE country_code = new.country_code, region_code = new.region_code, timezone = new.timezone, updated_at = new.updated_at',
        )->execute([$this->org, $countryCode, $regionCode, $timezone, Time::db($now)]);
    }
}
```

`backend/src/Repo/RoleRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;
use Planning\Support\Uuid;

final class RoleRepository
{
    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    /** @return list<array{id: string, name: string, color: string, archived: bool}> */
    public function all(bool $includeArchived = true): array
    {
        $st = $this->pdo->prepare('SELECT id, name, color, archived_at FROM roles WHERE organisation_id = ?' . ($includeArchived ? '' : ' AND archived_at IS NULL') . ' ORDER BY name');
        $st->execute([$this->org]);
        return array_map(self::map(...), $st->fetchAll());
    }

    /** @return array{id: string, name: string, color: string, archived: bool}|null */
    public function find(string $id): ?array
    {
        $st = $this->pdo->prepare('SELECT id, name, color, archived_at FROM roles WHERE organisation_id = ? AND id = ?');
        $st->execute([$this->org, $id]);
        $row = $st->fetch();
        return $row === false ? null : self::map($row);
    }

    /** @return array<string, bool> role id => archived */
    public function ids(): array
    {
        $out = [];
        foreach ($this->all() as $role) {
            $out[$role['id']] = $role['archived'];
        }
        return $out;
    }

    public function nameTaken(string $name, ?string $exceptId): bool
    {
        $st = $this->pdo->prepare('SELECT 1 FROM roles WHERE organisation_id = ? AND name = ? AND id <> ?');
        $st->execute([$this->org, $name, $exceptId ?? '']);
        return $st->fetchColumn() !== false;
    }

    /** @return array{id: string, name: string, color: string, archived: bool} */
    public function create(string $name, string $color, \DateTimeImmutable $now): array
    {
        $id = Uuid::v4();
        $this->pdo->prepare('INSERT INTO roles (id, organisation_id, name, color, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)')
            ->execute([$id, $this->org, $name, $color, Time::db($now), Time::db($now)]);
        return $this->find($id) ?? throw new \LogicException('Role vanished after insert.');
    }

    /**
     * @param array{name?: string, color?: string, archived?: bool} $fields
     * @return array{id: string, name: string, color: string, archived: bool}
     */
    public function update(string $id, array $fields, \DateTimeImmutable $now): array
    {
        $sets = [];
        $args = [];
        if (array_key_exists('name', $fields)) {
            $sets[] = 'name = ?';
            $args[] = $fields['name'];
        }
        if (array_key_exists('color', $fields)) {
            $sets[] = 'color = ?';
            $args[] = $fields['color'];
        }
        if (array_key_exists('archived', $fields)) {
            $sets[] = 'archived_at = ' . ($fields['archived'] ? 'COALESCE(archived_at, ?)' : 'NULL');
            if ($fields['archived']) {
                $args[] = Time::db($now);
            }
        }
        $sets[] = 'updated_at = ?';
        $args[] = Time::db($now);
        $args[] = $this->org;
        $args[] = $id;
        $this->pdo->prepare('UPDATE roles SET ' . implode(', ', $sets) . ' WHERE organisation_id = ? AND id = ?')->execute($args);
        return $this->find($id) ?? throw new \LogicException('Role vanished after update.');
    }

    /**
     * @param array{id: string, name: string, color: string, archived_at: ?string} $row
     * @return array{id: string, name: string, color: string, archived: bool}
     */
    private static function map(array $row): array
    {
        return ['id' => $row['id'], 'name' => $row['name'], 'color' => $row['color'], 'archived' => $row['archived_at'] !== null];
    }
}
```

- [ ] **Step 7: Implement the controllers**

`backend/src/Http/Controllers/SettingsController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\SettingsRepository;
use Planning\Support\Clock;
use Planning\Support\Time;

final class SettingsController
{
    public function __construct(private readonly SettingsRepository $settings, private readonly Clock $clock)
    {
    }

    public function show(Request $request): Response
    {
        return Response::json(200, ['settings' => $this->settings->get()]);
    }

    public function update(Request $request): Response
    {
        $current = $this->settings->get();
        $in = new Input($request->json());
        $country = $in->has('country_code') ? $in->string('country_code', 2) : $current['country_code'];
        $region = $in->has('region_code') ? $in->string('region_code', 10) : $current['region_code'];
        $timezone = $in->has('timezone') ? $in->string('timezone', 64, true) : $current['timezone'];
        if ($country !== null && !preg_match('/^[A-Z]{2}$/', $country)) {
            $in->error('country_code', 'Use a two-letter ISO country code in capitals, such as MY.');
        }
        if ($region !== null && !preg_match('/^[A-Z0-9-]{1,10}$/', $region)) {
            $in->error('region_code', 'Use a region code such as MY-10.');
        }
        if ($timezone !== null && !Time::isTimezone($timezone)) {
            $in->error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
        }
        $in->check();

        $this->settings->save($country, $region, (string) $timezone, $this->clock->now());
        return Response::json(200, ['settings' => $this->settings->get()]);
    }
}
```

`backend/src/Http/Controllers/RoleController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\RoleRepository;
use Planning\Support\Clock;

/** FR-CFG-01 */
final class RoleController
{
    private const COLOR = '/^#[0-9a-fA-F]{6}$/';

    public function __construct(private readonly RoleRepository $roles, private readonly Clock $clock)
    {
    }

    public function index(Request $request): Response
    {
        return Response::json(200, ['roles' => $this->roles->all($request->queryString('include_archived') === 'true')]);
    }

    public function store(Request $request): Response
    {
        $in = new Input($request->json());
        $name = $in->string('name', 80, true);
        $color = $in->string('color', 7, true);
        if ($color !== null && !preg_match(self::COLOR, $color)) {
            $in->error('color', 'Use a hex colour such as #3B82F6.');
        }
        $in->check();
        if ($this->roles->nameTaken((string) $name, null)) {
            throw HttpError::conflict('ROLE_NAME_TAKEN', "A role named \"$name\" already exists.");
        }
        return Response::json(201, ['role' => $this->roles->create((string) $name, strtoupper((string) $color), $this->clock->now())]);
    }

    /** @param array<string,string> $params */
    public function update(Request $request, array $params): Response
    {
        $role = $this->roles->find($params['id']) ?? throw HttpError::notFound('No role with that id.');
        $in = new Input($request->json());
        $fields = [];
        if ($in->has('name')) {
            $fields['name'] = $in->string('name', 80, true);
        }
        if ($in->has('color')) {
            $color = $in->string('color', 7, true);
            if ($color !== null && !preg_match(self::COLOR, $color)) {
                $in->error('color', 'Use a hex colour such as #3B82F6.');
            }
            $fields['color'] = strtoupper((string) $color);
        }
        if ($in->has('archived')) {
            $fields['archived'] = $in->bool('archived');
        }
        $in->check();
        if (isset($fields['name']) && $this->roles->nameTaken($fields['name'], $role['id'])) {
            throw HttpError::conflict('ROLE_NAME_TAKEN', "A role named \"{$fields['name']}\" already exists.");
        }
        return Response::json(200, ['role' => $this->roles->update($role['id'], $fields, $this->clock->now())]);
    }
}
```

- [ ] **Step 8: Wire routes, catalogue and `App`**

Add to `App` (with `use` for `Planning\Repo\{SettingsRepository, RoleRepository}`, `Planning\Holidays\{HolidayProvider, NullHolidayProvider}`, `Planning\Http\Controllers\{SettingsController, RoleController}`):

```php
    public function defaultTimezone(): string
    {
        $tz = Env::get('DEFAULT_TIMEZONE', 'UTC') ?? 'UTC';
        return Time::isTimezone($tz) ? $tz : 'UTC';
    }

    public function settings(): SettingsRepository
    {
        return $this->once('settings', fn () => new SettingsRepository($this->pdo(), $this->organisationId(), $this->defaultTimezone()));
    }

    public function roles(): RoleRepository
    {
        return $this->once('roles', fn () => new RoleRepository($this->pdo(), $this->organisationId()));
    }

    public function holidayProvider(): HolidayProvider
    {
        return $this->once('holidayProvider', static fn () => new NullHolidayProvider());
    }

    public function settingsController(): SettingsController
    {
        return $this->once('settingsController', fn () => new SettingsController($this->settings(), $this->clock()));
    }

    public function roleController(): RoleController
    {
        return $this->once('roleController', fn () => new RoleController($this->roles(), $this->clock()));
    }
```

Also add `use Planning\Support\Time;` to `App`.

Add to `backend/src/routes.php` before `return $router;`:

```php
    $router->add('GET', '/api/roles', Route::PERSON, 'List the roles shifts can require.', $to('roleController', 'index'), Doc::op(
        'List Roles', 'See the job roles shifts are planned for', ['Filling a role picker', 'Showing role names and colours on a schedule'], ['Finding which employees hold a role'],
        ['include_archived'], ['roles[].id', 'roles[].name', 'roles[].color', 'roles[].archived'], ['Signed-in person'], ['POST /api/roles', 'GET /api/employees'],
        ['roles', 'job roles', 'positions', 'skills'],
    ));
    $router->add('POST', '/api/roles', Route::MANAGER, 'Create a role.', $to('roleController', 'store'), Doc::op(
        'Create Role', 'Add a job role that shifts can require', ['Setting up a new kind of work to plan'], ['Renaming an existing role'],
        ['name', 'color'], ['role'], ['Planning Manager', 'Name not already used'], ['GET /api/roles', 'PATCH /api/roles/{id}'],
        ['role', 'create role', 'add position'],
    ));
    $router->add('PATCH', '/api/roles/{id}', Route::MANAGER, 'Rename, recolour or archive a role.', $to('roleController', 'update'), Doc::op(
        'Update Role', 'Change or retire a role', ['Renaming a role', 'Archiving a role nobody uses any more'], ['Creating a role'],
        ['name', 'color', 'archived'], ['role'], ['Planning Manager', 'Role exists'], ['GET /api/roles'],
        ['role', 'archive role', 'rename role'],
    ));
    $router->add('GET', '/api/settings', Route::MANAGER, 'Read organisation planning settings.', $to('settingsController', 'show'), Doc::op(
        'Read Settings', 'See the organisation country, region and time zone', ['Showing the settings page'], ['Reading an employee time zone'],
        [], ['settings.country_code', 'settings.region_code', 'settings.timezone'], ['Planning Manager'], ['PATCH /api/settings'],
        ['settings', 'configuration', 'time zone', 'country'],
    ));
    $router->add('PATCH', '/api/settings', Route::MANAGER, 'Change organisation planning settings.', $to('settingsController', 'update'), Doc::op(
        'Update Settings', 'Set the organisation country, region and time zone', ['Choosing which public holidays apply', 'Changing the default time zone'], ['Changing one employee\'s time zone'],
        ['country_code', 'region_code', 'timezone'], ['settings'], ['Planning Manager'], ['GET /api/settings', 'POST /api/holiday-syncs'],
        ['settings', 'time zone', 'country', 'region'],
    ));
```

Append to `capabilities` in `backend/src/catalog.php`:

```php
        [
            'name' => 'Configure Planning',
            'icon' => '⚙️',
            'description' => 'Set up the roles and organisation settings planning relies on.',
            'does' => ['Create and archive roles', 'Set the organisation time zone and country'],
            'best_for' => 'Planning Managers setting Planning up for their team.',
            'endpoints' => ['GET /api/roles', 'POST /api/roles', 'PATCH /api/roles/{id}', 'GET /api/settings', 'PATCH /api/settings'],
        ],
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "InputTest|SettingsApiTest|RolesApiTest|OpenApiDocumentTest"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: add roles and organisation settings APIs"
```

---

### Task 12: Employees, planning profiles, and time zone in `/api/me`

**Files:**
- Create: `backend/src/Repo/ProfileRepository.php`, `backend/src/Http/Controllers/EmployeeController.php`
- Modify: `backend/src/Http/Controllers/MeController.php`, `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Integration/Api/EmployeesApiTest.php`

**Interfaces:**
- Consumes: `DirectoryRepository`, `DirectoryRefresher`, `RoleRepository`, `SettingsRepository`, `WorkingHours`, `Input`.
- Produces:
  - `ProfileRepository(\PDO, string $org)`. A profile is `array{employee_ref, role_ids: list<string>, default_role_id: ?string, timezone: ?string, working_hours: ?array}`. Methods:
    - `->find(string $ref): profile`, which returns `ProfileRepository::blank($ref)` when no profile exists (FR-CFG-02 AC1)
    - `->all(): array<string ref, profile>`
    - `->save(string $ref, list<string> $roleIds, ?string $defaultRoleId, ?string $timezone, ?array $workingHours, \DateTimeImmutable $now): void`
    - `ProfileRepository::blank(string $ref): profile`
  - `GET /api/employees` (manager) returns `{employees: [{employee_ref, name, photo_url, department_id, department_name, status, role_ids, default_role_id, timezone, effective_timezone, working_hours}]}`.
  - `PATCH /api/employees/{ref}` (manager) takes any of `role_ids`, `default_role_id`, `timezone`, `working_hours` (`null` means flexible hours).
  - `GET /api/me` adds `timezone` (the employee's profile time zone, else the organisation's) and `organisation_timezone`.
  - `App` getters: `profiles()`, `employeeController()`; `meController()` changes.

- [ ] **Step 1: Write the failing test**

`backend/tests/Integration/Api/EmployeesApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Tests\Support\ApiTestCase;

final class EmployeesApiTest extends ApiTestCase
{
    private const HOURS = ['mon' => [['09:00', '13:00'], ['14:00', '18:00']]];

    public function test_never_configured_employee_has_no_roles_and_flexible_hours(): void
    {
        $this->addEmployee('E1', 'Ana Lim', 'DEP-1', 'Field Services');

        [$status, $body] = $this->call('GET', '/api/employees');

        $this->assertSame(200, $status);
        $this->assertSame([[
            'employee_ref' => 'E1', 'name' => 'Ana Lim', 'photo_url' => null, 'department_id' => 'DEP-1',
            'department_name' => 'Field Services', 'status' => 'Active', 'role_ids' => [], 'default_role_id' => null,
            'timezone' => null, 'effective_timezone' => 'Asia/Kuala_Lumpur', 'working_hours' => null,
        ]], $body['employees']);
    }

    public function test_empty_directory_is_filled_from_the_roster_on_first_use(): void
    {
        $this->roster->add('u7', 'Bo Tan', 'bo@x.test');
        $this->assertSame(['Bo Tan'], array_column($this->call('GET', '/api/employees')[1]['employees'], 'name'));
    }

    public function test_save_profile(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $tech = $this->addRole('Technician');
        $desk = $this->addRole('Reception');

        [$status, $body] = $this->call('PATCH', '/api/employees/E1', [
            'role_ids' => [$tech, $desk], 'default_role_id' => $tech, 'timezone' => 'Asia/Singapore', 'working_hours' => self::HOURS,
        ]);

        $this->assertSame(200, $status, json_encode($body));
        $employee = $body['employee'];
        $this->assertEqualsCanonicalizing([$tech, $desk], $employee['role_ids']);
        $this->assertSame($tech, $employee['default_role_id']);
        $this->assertSame('Asia/Singapore', $employee['effective_timezone']);
        $this->assertSame([['09:00', '13:00'], ['14:00', '18:00']], $employee['working_hours']['mon']);
        $this->assertSame([], $employee['working_hours']['sun']);
    }

    public function test_partial_patch_keeps_other_fields_and_null_hours_means_flexible(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $tech = $this->addRole('Technician');
        $this->call('PATCH', '/api/employees/E1', ['role_ids' => [$tech], 'working_hours' => self::HOURS]);

        [, $body] = $this->call('PATCH', '/api/employees/E1', ['working_hours' => null]);

        $this->assertSame([$tech], $body['employee']['role_ids']);
        $this->assertNull($body['employee']['working_hours']);
    }

    public function test_validation(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $tech = $this->addRole('Technician');

        [$status, $body] = $this->call('PATCH', '/api/employees/E1', [
            'role_ids' => ['nope'], 'default_role_id' => $tech, 'timezone' => 'Nowhere/Land', 'working_hours' => ['mon' => [['18:00', '09:00']]],
        ]);

        $this->assertSame(422, $status);
        $this->assertSame(['working_hours', 'role_ids', 'default_role_id', 'timezone'], array_keys($body['error']['details']));
        $this->assertStringContainsString('must end after it starts', $body['error']['details']['working_hours']);
    }

    public function test_unknown_employee_is_404(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $this->assertSame(404, $this->call('PATCH', '/api/employees/E404', ['timezone' => null])[0]);
    }

    public function test_employees_cannot_list_or_edit(): void
    {
        $this->asEmployee('E1');
        $this->assertSame(403, $this->call('GET', '/api/employees')[0]);
        $this->assertSame(403, $this->call('PATCH', '/api/employees/E1', [])[0]);
    }

    public function test_me_reports_the_effective_time_zone(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $this->call('PATCH', '/api/employees/E1', ['timezone' => 'Asia/Singapore']);

        $this->asEmployee('E1');
        [, $me] = $this->call('GET', '/api/me');
        $this->assertSame('Asia/Singapore', $me['timezone']);
        $this->assertSame('Asia/Kuala_Lumpur', $me['organisation_timezone']);

        $this->asEmployee(null, 'nobody@example.com');
        $this->assertSame('Asia/Kuala_Lumpur', $this->call('GET', '/api/me')[1]['timezone']);
    }
}
```

Run: `php vendor/bin/phpunit --filter EmployeesApiTest`
Expected: FAIL (404s, and `/api/me` has no `timezone`).

- [ ] **Step 2: Implement the profile repository**

`backend/src/Repo/ProfileRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;

/** FR-CFG-02. Planning-owned facts about an employee; the roster owns everything else. */
final class ProfileRepository
{
    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    /** @return array{employee_ref: string, role_ids: list<string>, default_role_id: ?string, timezone: ?string, working_hours: ?array} */
    public static function blank(string $ref): array
    {
        return ['employee_ref' => $ref, 'role_ids' => [], 'default_role_id' => null, 'timezone' => null, 'working_hours' => null];
    }

    /** @return array{employee_ref: string, role_ids: list<string>, default_role_id: ?string, timezone: ?string, working_hours: ?array} */
    public function find(string $ref): array
    {
        $st = $this->pdo->prepare('SELECT default_role_id, timezone, working_hours FROM employee_profiles WHERE organisation_id = ? AND employee_ref = ?');
        $st->execute([$this->org, $ref]);
        $row = $st->fetch();
        $roles = $this->pdo->prepare('SELECT role_id FROM employee_roles WHERE organisation_id = ? AND employee_ref = ? ORDER BY role_id');
        $roles->execute([$this->org, $ref]);
        return self::shape($ref, $row === false ? null : $row, $roles->fetchAll(PDO::FETCH_COLUMN));
    }

    /** @return array<string, array{employee_ref: string, role_ids: list<string>, default_role_id: ?string, timezone: ?string, working_hours: ?array}> */
    public function all(): array
    {
        $profiles = [];
        $st = $this->pdo->prepare('SELECT employee_ref, default_role_id, timezone, working_hours FROM employee_profiles WHERE organisation_id = ?');
        $st->execute([$this->org]);
        foreach ($st->fetchAll() as $row) {
            $profiles[$row['employee_ref']] = self::shape($row['employee_ref'], $row, []);
        }
        $st = $this->pdo->prepare('SELECT employee_ref, role_id FROM employee_roles WHERE organisation_id = ? ORDER BY role_id');
        $st->execute([$this->org]);
        foreach ($st->fetchAll() as $row) {
            $profiles[$row['employee_ref']] ??= self::blank($row['employee_ref']);
            $profiles[$row['employee_ref']]['role_ids'][] = $row['role_id'];
        }
        return $profiles;
    }

    /**
     * @param list<string> $roleIds
     * @param array<string, list<array{0: string, 1: string}>>|null $workingHours null = flexible hours
     */
    public function save(string $ref, array $roleIds, ?string $defaultRoleId, ?string $timezone, ?array $workingHours, \DateTimeImmutable $now): void
    {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare(
                'INSERT INTO employee_profiles (organisation_id, employee_ref, default_role_id, timezone, working_hours, updated_at) VALUES (?, ?, ?, ?, ?, ?) AS new
                 ON DUPLICATE KEY UPDATE default_role_id = new.default_role_id, timezone = new.timezone, working_hours = new.working_hours, updated_at = new.updated_at',
            )->execute([$this->org, $ref, $defaultRoleId, $timezone, $workingHours === null ? null : json_encode($workingHours, JSON_THROW_ON_ERROR), Time::db($now)]);
            $this->pdo->prepare('DELETE FROM employee_roles WHERE organisation_id = ? AND employee_ref = ?')->execute([$this->org, $ref]);
            $insert = $this->pdo->prepare('INSERT INTO employee_roles (organisation_id, employee_ref, role_id) VALUES (?, ?, ?)');
            foreach ($roleIds as $roleId) {
                $insert->execute([$this->org, $ref, $roleId]);
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * @param array<string, ?string>|null $row
     * @param list<string> $roleIds
     * @return array{employee_ref: string, role_ids: list<string>, default_role_id: ?string, timezone: ?string, working_hours: ?array}
     */
    private static function shape(string $ref, ?array $row, array $roleIds): array
    {
        $hours = $row['working_hours'] ?? null;
        return [
            'employee_ref' => $ref,
            'role_ids' => array_values($roleIds),
            'default_role_id' => $row['default_role_id'] ?? null,
            'timezone' => $row['timezone'] ?? null,
            'working_hours' => $hours === null ? null : json_decode($hours, true),
        ];
    }
}
```

- [ ] **Step 3: Implement the employee controller and extend `/api/me`**

`backend/src/Http/Controllers/EmployeeController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Domain\WorkingHours;
use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\DirectoryRepository;
use Planning\Repo\ProfileRepository;
use Planning\Repo\RoleRepository;
use Planning\Repo\SettingsRepository;
use Planning\Roster\DirectoryRefresher;
use Planning\Support\Clock;
use Planning\Support\Time;

/** Roster employees (IF-02) joined with their planning profile (FR-CFG-02). */
final class EmployeeController
{
    public function __construct(
        private readonly DirectoryRepository $directory,
        private readonly DirectoryRefresher $refresher,
        private readonly ProfileRepository $profiles,
        private readonly RoleRepository $roles,
        private readonly SettingsRepository $settings,
        private readonly Clock $clock,
    ) {
    }

    public function index(Request $request): Response
    {
        $this->refresher->refreshIfEmpty();
        $profiles = $this->profiles->all();
        $orgTz = $this->settings->get()['timezone'];
        $employees = array_map(
            fn (array $row): array => self::shape($row, $profiles[$row['employee_ref']] ?? ProfileRepository::blank($row['employee_ref']), $orgTz),
            $this->directory->all(),
        );
        return Response::json(200, ['employees' => $employees]);
    }

    /** @param array<string,string> $params */
    public function update(Request $request, array $params): Response
    {
        $ref = $params['ref'];
        $row = $this->directory->find($ref);
        if ($row === null && !$this->directory->isEmpty()) {
            throw HttpError::notFound('No employee with that reference on the roster.');
        }
        $current = $this->profiles->find($ref);
        $in = new Input($request->json());

        $workingHours = $current['working_hours'];
        if ($in->has('working_hours')) {
            $raw = $in->raw('working_hours');
            if ($raw === null) {
                $workingHours = null;
            } elseif (!is_array($raw)) {
                $in->error('working_hours', 'Give an object keyed by weekday, or null for flexible hours.');
            } else {
                try {
                    $workingHours = WorkingHours::fromArray($raw)->toArray();
                } catch (\InvalidArgumentException $e) {
                    $in->error('working_hours', $e->getMessage());
                }
            }
        }
        $roleIds = $in->has('role_ids') ? ($in->stringList('role_ids', 50) ?? []) : $current['role_ids'];
        $known = $this->roles->ids();
        foreach ($roleIds as $roleId) {
            if (!array_key_exists($roleId, $known)) {
                $in->error('role_ids', "Unknown role $roleId.");
                break;
            }
        }
        $default = $in->has('default_role_id') ? $in->string('default_role_id', 36) : $current['default_role_id'];
        if ($default !== null && !in_array($default, $roleIds, true)) {
            $in->error('default_role_id', 'The default role must be one of the employee\'s roles.');
        }
        $timezone = $in->has('timezone') ? $in->string('timezone', 64) : $current['timezone'];
        if ($timezone !== null && !Time::isTimezone($timezone)) {
            $in->error('timezone', 'Unknown time zone. Use an IANA name such as Asia/Kuala_Lumpur.');
        }
        $in->check();

        $this->profiles->save($ref, $roleIds, $default, $timezone, $workingHours, $this->clock->now());
        $row ??= ['employee_ref' => $ref, 'display_name' => 'Unknown employee', 'photo_url' => null, 'department_id' => null, 'department_name' => null, 'status' => 'unknown'];
        return Response::json(200, ['employee' => self::shape($row, $this->profiles->find($ref), $this->settings->get()['timezone'])]);
    }

    /**
     * @param array<string, ?string> $row directory row
     * @param array{employee_ref: string, role_ids: list<string>, default_role_id: ?string, timezone: ?string, working_hours: ?array} $profile
     * @return array<string, mixed>
     */
    private static function shape(array $row, array $profile, string $orgTimezone): array
    {
        return [
            'employee_ref' => $row['employee_ref'],
            'name' => $row['display_name'],
            'photo_url' => $row['photo_url'],
            'department_id' => $row['department_id'],
            'department_name' => $row['department_name'],
            'status' => $row['status'],
            'role_ids' => $profile['role_ids'],
            'default_role_id' => $profile['default_role_id'],
            'timezone' => $profile['timezone'],
            'effective_timezone' => $profile['timezone'] ?? $orgTimezone,
            'working_hours' => $profile['working_hours'],
        ];
    }
}
```

The validation test expects the error keys in the order `working_hours`, `role_ids`, `default_role_id`, `timezone`. That is the order `update()` checks them in, so keep that order if you change the method.

Replace `backend/src/Http/Controllers/MeController.php` with:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Auth\Principal;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\ProfileRepository;
use Planning\Repo\SettingsRepository;

final class MeController
{
    public function __construct(private readonly ProfileRepository $profiles, private readonly SettingsRepository $settings)
    {
    }

    /** @param array<string,string> $params */
    public function show(Request $request, array $params, ?Principal $me): Response
    {
        $orgTimezone = $this->settings->get()['timezone'];
        $timezone = $me?->employeeRef !== null ? ($this->profiles->find($me->employeeRef)['timezone'] ?? $orgTimezone) : $orgTimezone;
        return Response::json(200, [
            'name' => $me?->name,
            'email' => $me?->email,
            'gateway_role' => $me?->gatewayRole,
            'employee_ref' => $me?->employeeRef,
            'is_manager' => $me?->isManager ?? false,
            'timezone' => $timezone,
            'organisation_timezone' => $orgTimezone,
        ]);
    }
}
```

- [ ] **Step 4: Wire routes, catalogue and `App`**

In `App`, replace `meController()` and add the new getters (with `use Planning\Repo\ProfileRepository;` and `use Planning\Http\Controllers\EmployeeController;`):

```php
    public function meController(): MeController
    {
        return $this->once('meController', fn () => new MeController($this->profiles(), $this->settings()));
    }

    public function profiles(): ProfileRepository
    {
        return $this->once('profiles', fn () => new ProfileRepository($this->pdo(), $this->organisationId()));
    }

    public function employeeController(): EmployeeController
    {
        return $this->once('employeeController', fn () => new EmployeeController(
            $this->directory(), $this->directoryRefresher(), $this->profiles(), $this->roles(), $this->settings(), $this->clock(),
        ));
    }
```

Routes (before `return $router;`):

```php
    $router->add('GET', '/api/employees', Route::MANAGER, 'List plannable employees with their roles and working hours.', $to('employeeController', 'index'), Doc::op(
        'List Employees', 'See who can be planned and how', ['Choosing who to put on a shift', 'Reviewing roles and working hours'], ['Reading shifts', 'Looking up personal details'],
        [], ['employees[].employee_ref', 'employees[].name', 'employees[].role_ids', 'employees[].working_hours'], ['Planning Manager'], ['PATCH /api/employees/{ref}', 'GET /api/schedule'],
        ['employees', 'staff', 'roster', 'team', 'people'],
    ));
    $router->add('PATCH', '/api/employees/{ref}', Route::MANAGER, 'Set an employee\'s planning roles, default role, time zone and working hours.', $to('employeeController', 'update'), Doc::op(
        'Update Planning Profile', 'Change how an employee can be planned', ['Giving someone a role', 'Setting part-time working hours', 'Marking someone as flexible hours'], ['Changing personal details on the roster'],
        ['role_ids', 'default_role_id', 'timezone', 'working_hours'], ['employee'], ['Planning Manager', 'Employee on the roster'], ['GET /api/employees', 'GET /api/roles'],
        ['working hours', 'schedule', 'roles', 'part time', 'flexible'],
    ));
```

Append to `capabilities`:

```php
        [
            'name' => 'Manage Team Profiles',
            'icon' => '👥',
            'description' => 'See plannable employees and set their roles and working hours.',
            'does' => ['List the team', 'Give an employee roles', 'Set working hours or flexible hours'],
            'best_for' => 'Managers preparing who can be scheduled for what.',
            'endpoints' => ['GET /api/employees', 'PATCH /api/employees/{ref}'],
        ],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "EmployeesApiTest|OpenApiDocumentTest|GatewayAccessGuardTest"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: add employee planning profiles and report time zone in /api/me"
```

---

### Task 13: Time off and public holidays

**Files:**
- Create: `backend/src/Repo/UnavailabilityRepository.php`, `backend/src/Repo/HolidayRepository.php`
- Create: `backend/src/Http/Controllers/UnavailabilityController.php`, `backend/src/Http/Controllers/HolidayController.php`
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Integration/Api/UnavailabilityApiTest.php`, `backend/tests/Integration/Api/HolidaysApiTest.php`

**Interfaces:**
- Consumes: `Input`, `DirectoryRepository`, `SettingsRepository`, `HolidayProvider`, `Time`, `Uuid`.
- Produces:
  - `UnavailabilityRepository(\PDO, string $org)`. A record is `array{id, employee_ref, start: \DateTimeImmutable, end: \DateTimeImmutable, reason: string}`. Methods:
    - `->between(\DateTimeImmutable $from, \DateTimeImmutable $to, ?string $employeeRef = null): list<record>` returns records that overlap `[from, to)`.
    - `->find(string $id): ?record`
    - `->create(string $ref, \DateTimeImmutable $start, \DateTimeImmutable $end, string $reason, string $by, \DateTimeImmutable $now): record`
    - `->update(string $id, \DateTimeImmutable $start, \DateTimeImmutable $end, string $reason, \DateTimeImmutable $now): record`
    - `->delete(string $id): bool`
    - `UnavailabilityRepository::toApi(record): array{id, employee_ref, start_at, end_at, reason}`
  - `HolidayRepository(\PDO, string $org)`. A holiday is `array{id, date, name, source, hidden: bool, edited: bool}`. Methods:
    - `->forYear(int $year): list<holiday>`
    - `->visibleBetween(string $fromDate, string $toDate): list<array{date: string, name: string}>` (both dates inclusive)
    - `->find(string $id): ?holiday`
    - `->createManual(string $date, string $name, \DateTimeImmutable $now): holiday`
    - `->update(string $id, ?string $name, ?bool $hidden, \DateTimeImmutable $now): holiday`
    - `->delete(string $id): void`
    - `->syncFromProvider(list<array{key, date, name}> $holidays, \DateTimeImmutable $now): array{added: int, updated: int}`
  - Endpoints:
    - `GET /api/unavailabilities?from=&to=[&employee_ref=]`, `POST /api/unavailabilities`, `PATCH /api/unavailabilities/{id}`, `DELETE /api/unavailabilities/{id}` (all manager)
    - `GET /api/holidays?year=`, `POST /api/holidays`, `PATCH /api/holidays/{id}`, `DELETE /api/holidays/{id}`, `POST /api/holiday-syncs` (all manager)
  - `App` getters: `unavailability()`, `holidays()`, `unavailabilityController()`, `holidayController()`.

Rules:
- Time off may last up to 366 days.
- Provider holidays can be renamed or hidden, but not deleted, because they would come back on the next sync.
- A sync updates provider holidays nobody has edited, and never changes `hidden` (FR-CFG-04 AC2).

- [ ] **Step 1: Write the failing tests**

`backend/tests/Integration/Api/UnavailabilityApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Tests\Support\ApiTestCase;

final class UnavailabilityApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->addEmployee('E1', 'Ana Lim');
    }

    /** @return array<string,mixed> */
    private function create(string $start = '2026-10-16T00:00:00+08:00', string $end = '2026-10-17T00:00:00+08:00'): array
    {
        [$status, $body] = $this->call('POST', '/api/unavailabilities', ['employee_ref' => 'E1', 'start_at' => $start, 'end_at' => $end, 'reason' => 'Annual leave']);
        $this->assertSame(201, $status, json_encode($body));
        return $body['unavailability'];
    }

    public function test_create_and_list_overlapping_the_range(): void
    {
        $created = $this->create();
        $this->assertSame(['id' => $created['id'], 'employee_ref' => 'E1', 'start_at' => '2026-10-15T16:00:00Z', 'end_at' => '2026-10-16T16:00:00Z', 'reason' => 'Annual leave'], $created);

        $this->assertCount(1, $this->call('GET', '/api/unavailabilities', null, ['from' => '2026-10-12', 'to' => '2026-10-18'])[1]['unavailabilities']);
        $this->assertCount(0, $this->call('GET', '/api/unavailabilities', null, ['from' => '2026-10-19', 'to' => '2026-10-25'])[1]['unavailabilities']);
        $this->assertCount(0, $this->call('GET', '/api/unavailabilities', null, ['from' => '2026-10-12', 'to' => '2026-10-18', 'employee_ref' => 'E2'])[1]['unavailabilities']);
    }

    public function test_validation(): void
    {
        [$status, $body] = $this->call('POST', '/api/unavailabilities', ['employee_ref' => 'E9', 'start_at' => '2026-10-16T10:00:00+08:00', 'end_at' => '2026-10-16T09:00:00+08:00']);
        $this->assertSame(422, $status);
        $this->assertSame(['employee_ref', 'end_at'], array_keys($body['error']['details']));

        $this->assertSame(422, $this->call('GET', '/api/unavailabilities', null, ['from' => '2026-10-12'])[0]);
    }

    public function test_update_and_delete(): void
    {
        $id = $this->create()['id'];

        [$status, $body] = $this->call('PATCH', "/api/unavailabilities/$id", ['reason' => 'Sick leave', 'end_at' => '2026-10-18T00:00:00+08:00']);
        $this->assertSame(200, $status);
        $this->assertSame('Sick leave', $body['unavailability']['reason']);
        $this->assertSame('2026-10-17T16:00:00Z', $body['unavailability']['end_at']);

        $this->assertSame(204, $this->call('DELETE', "/api/unavailabilities/$id")[0]);
        $this->assertSame(404, $this->call('DELETE', "/api/unavailabilities/$id")[0]);
    }
}
```

`backend/tests/Integration/Api/HolidaysApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Tests\Support\ApiTestCase;

final class HolidaysApiTest extends ApiTestCase
{
    public function test_manual_holiday_lifecycle(): void
    {
        [$status, $body] = $this->call('POST', '/api/holidays', ['date' => '2026-11-08', 'name' => 'Deepavali']);
        $this->assertSame(201, $status);
        $id = $body['holiday']['id'];
        $this->assertSame(['id' => $id, 'date' => '2026-11-08', 'name' => 'Deepavali', 'source' => 'manual', 'hidden' => false, 'edited' => false], $body['holiday']);

        $this->assertSame(['Deepavali'], array_column($this->call('GET', '/api/holidays', null, ['year' => 2026])[1]['holidays'], 'name'));

        [, $body] = $this->call('PATCH', "/api/holidays/$id", ['hidden' => true]);
        $this->assertTrue($body['holiday']['hidden']);

        $this->assertSame(204, $this->call('DELETE', "/api/holidays/$id")[0]);
        $this->assertSame([], $this->call('GET', '/api/holidays', null, ['year' => 2026])[1]['holidays']);
    }

    public function test_sync_needs_a_provider_and_a_country(): void
    {
        $this->assertSame('HOLIDAY_PROVIDER_NOT_CONFIGURED', $this->call('POST', '/api/holiday-syncs', ['year' => 2026])[1]['error']['code']);

        $this->holidayProvider->configured = true;
        $this->assertSame('COUNTRY_NOT_SET', $this->call('POST', '/api/holiday-syncs', ['year' => 2026])[1]['error']['code']);
    }

    public function test_resync_keeps_hidden_and_edited_holidays(): void
    {
        $this->holidayProvider->configured = true;
        $this->holidayProvider->list = [
            ['key' => 'MY-2026-11-08', 'date' => '2026-11-08', 'name' => 'Deepavali'],
            ['key' => 'MY-2026-12-25', 'date' => '2026-12-25', 'name' => 'Christmas'],
        ];
        $this->call('PATCH', '/api/settings', ['country_code' => 'MY', 'region_code' => 'MY-10']);

        [$status, $body] = $this->call('POST', '/api/holiday-syncs', ['year' => 2026]);
        $this->assertSame(201, $status);
        $this->assertSame(['added' => 2, 'updated' => 0], $body);
        $this->assertSame([[2026, 'MY', 'MY-10']], $this->holidayProvider->calls);

        $holidays = $this->call('GET', '/api/holidays', null, ['year' => 2026])[1]['holidays'];
        $this->call('PATCH', "/api/holidays/{$holidays[0]['id']}", ['hidden' => true]);
        $this->call('PATCH', "/api/holidays/{$holidays[1]['id']}", ['name' => 'Christmas Day']);
        $this->assertSame('PROVIDER_HOLIDAY', $this->call('DELETE', "/api/holidays/{$holidays[0]['id']}")[1]['error']['code']);

        $this->holidayProvider->list[0]['name'] = 'Deepavali (Diwali)';
        $this->holidayProvider->list[1]['name'] = 'Christmas (provider)';
        $this->call('POST', '/api/holiday-syncs', ['year' => 2026]);

        $after = $this->call('GET', '/api/holidays', null, ['year' => 2026])[1]['holidays'];
        $this->assertSame(['Deepavali (Diwali)', true], [$after[0]['name'], $after[0]['hidden']], 'hidden stays hidden; unedited name refreshes');
        $this->assertSame('Christmas Day', $after[1]['name'], 'a manager\'s rename survives a sync');
    }

    public function test_validation(): void
    {
        [$status, $body] = $this->call('POST', '/api/holidays', ['date' => '2026-02-30', 'name' => '']);
        $this->assertSame(422, $status);
        $this->assertSame(['date', 'name'], array_keys($body['error']['details']));
    }
}
```

Run: `php vendor/bin/phpunit --filter "UnavailabilityApiTest|HolidaysApiTest"`
Expected: FAIL (404s).

- [ ] **Step 2: Implement the repositories**

`backend/src/Repo/UnavailabilityRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;
use Planning\Support\Uuid;

/**
 * FR-CFG-03, DR-03: personal time off stored by Planning until an HR leave
 * service exists. Everything that reads time off goes through between(), so
 * swapping in that service later means replacing this class only.
 */
final class UnavailabilityRepository
{
    private const COLUMNS = 'id, employee_ref, start_at, end_at, reason';

    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    /** @return list<array{id: string, employee_ref: string, start: \DateTimeImmutable, end: \DateTimeImmutable, reason: string}> */
    public function between(\DateTimeImmutable $from, \DateTimeImmutable $to, ?string $employeeRef = null): array
    {
        $sql = 'SELECT ' . self::COLUMNS . ' FROM unavailabilities WHERE organisation_id = ? AND start_at < ? AND end_at > ?';
        $args = [$this->org, Time::db($to), Time::db($from)];
        if ($employeeRef !== null) {
            $sql .= ' AND employee_ref = ?';
            $args[] = $employeeRef;
        }
        $st = $this->pdo->prepare($sql . ' ORDER BY start_at');
        $st->execute($args);
        return array_map(self::map(...), $st->fetchAll());
    }

    /** @return array{id: string, employee_ref: string, start: \DateTimeImmutable, end: \DateTimeImmutable, reason: string}|null */
    public function find(string $id): ?array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM unavailabilities WHERE organisation_id = ? AND id = ?');
        $st->execute([$this->org, $id]);
        $row = $st->fetch();
        return $row === false ? null : self::map($row);
    }

    /** @return array{id: string, employee_ref: string, start: \DateTimeImmutable, end: \DateTimeImmutable, reason: string} */
    public function create(string $ref, \DateTimeImmutable $start, \DateTimeImmutable $end, string $reason, string $by, \DateTimeImmutable $now): array
    {
        $id = Uuid::v4();
        $this->pdo->prepare('INSERT INTO unavailabilities (id, organisation_id, employee_ref, start_at, end_at, reason, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $this->org, $ref, Time::db($start), Time::db($end), $reason, $by, Time::db($now), Time::db($now)]);
        return $this->find($id) ?? throw new \LogicException('Time off vanished after insert.');
    }

    /** @return array{id: string, employee_ref: string, start: \DateTimeImmutable, end: \DateTimeImmutable, reason: string} */
    public function update(string $id, \DateTimeImmutable $start, \DateTimeImmutable $end, string $reason, \DateTimeImmutable $now): array
    {
        $this->pdo->prepare('UPDATE unavailabilities SET start_at = ?, end_at = ?, reason = ?, updated_at = ? WHERE organisation_id = ? AND id = ?')
            ->execute([Time::db($start), Time::db($end), $reason, Time::db($now), $this->org, $id]);
        return $this->find($id) ?? throw new \LogicException('Time off vanished after update.');
    }

    public function delete(string $id): bool
    {
        $st = $this->pdo->prepare('DELETE FROM unavailabilities WHERE organisation_id = ? AND id = ?');
        $st->execute([$this->org, $id]);
        return $st->rowCount() === 1;
    }

    /**
     * @param array{id: string, employee_ref: string, start: \DateTimeImmutable, end: \DateTimeImmutable, reason: string} $record
     * @return array{id: string, employee_ref: string, start_at: string, end_at: string, reason: string}
     */
    public static function toApi(array $record): array
    {
        return ['id' => $record['id'], 'employee_ref' => $record['employee_ref'], 'start_at' => Time::iso($record['start']), 'end_at' => Time::iso($record['end']), 'reason' => $record['reason']];
    }

    /** @param array<string,string> $row */
    private static function map(array $row): array
    {
        return ['id' => $row['id'], 'employee_ref' => $row['employee_ref'], 'start' => Time::fromDb($row['start_at']), 'end' => Time::fromDb($row['end_at']), 'reason' => $row['reason']];
    }
}
```

`backend/src/Repo/HolidayRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;
use Planning\Support\Uuid;

/** FR-CFG-04 */
final class HolidayRepository
{
    private const COLUMNS = 'id, holiday_date, name, source, hidden, edited';

    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    /** @return list<array{id: string, date: string, name: string, source: string, hidden: bool, edited: bool}> */
    public function forYear(int $year): array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM public_holidays WHERE organisation_id = ? AND holiday_date BETWEEN ? AND ? ORDER BY holiday_date, name');
        $st->execute([$this->org, "$year-01-01", "$year-12-31"]);
        return array_map(self::map(...), $st->fetchAll());
    }

    /** @return list<array{date: string, name: string}> visible holidays from $fromDate to $toDate inclusive */
    public function visibleBetween(string $fromDate, string $toDate): array
    {
        $st = $this->pdo->prepare('SELECT holiday_date AS date, name FROM public_holidays WHERE organisation_id = ? AND hidden = 0 AND holiday_date BETWEEN ? AND ? ORDER BY holiday_date');
        $st->execute([$this->org, $fromDate, $toDate]);
        return $st->fetchAll();
    }

    /** @return array{id: string, date: string, name: string, source: string, hidden: bool, edited: bool}|null */
    public function find(string $id): ?array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM public_holidays WHERE organisation_id = ? AND id = ?');
        $st->execute([$this->org, $id]);
        $row = $st->fetch();
        return $row === false ? null : self::map($row);
    }

    /** @return array{id: string, date: string, name: string, source: string, hidden: bool, edited: bool} */
    public function createManual(string $date, string $name, \DateTimeImmutable $now): array
    {
        $id = Uuid::v4();
        $this->pdo->prepare("INSERT INTO public_holidays (id, organisation_id, holiday_date, name, source, provider_key, edited, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', NULL, 0, 0, ?, ?)")
            ->execute([$id, $this->org, $date, $name, Time::db($now), Time::db($now)]);
        return $this->find($id) ?? throw new \LogicException('Holiday vanished after insert.');
    }

    /** @return array{id: string, date: string, name: string, source: string, hidden: bool, edited: bool} */
    public function update(string $id, ?string $name, ?bool $hidden, \DateTimeImmutable $now): array
    {
        if ($name !== null) {
            $this->pdo->prepare('UPDATE public_holidays SET name = ?, edited = 1, updated_at = ? WHERE organisation_id = ? AND id = ?')->execute([$name, Time::db($now), $this->org, $id]);
        }
        if ($hidden !== null) {
            $this->pdo->prepare('UPDATE public_holidays SET hidden = ?, updated_at = ? WHERE organisation_id = ? AND id = ?')->execute([$hidden ? 1 : 0, Time::db($now), $this->org, $id]);
        }
        return $this->find($id) ?? throw new \LogicException('Holiday vanished after update.');
    }

    public function delete(string $id): void
    {
        $this->pdo->prepare('DELETE FROM public_holidays WHERE organisation_id = ? AND id = ?')->execute([$this->org, $id]);
    }

    /**
     * New provider holidays are added. Existing ones are refreshed unless a
     * manager renamed them. `hidden` is never touched (FR-CFG-04 AC2).
     *
     * @param list<array{key: string, date: string, name: string}> $holidays
     * @return array{added: int, updated: int}
     */
    public function syncFromProvider(array $holidays, \DateTimeImmutable $now): array
    {
        $added = 0;
        $updated = 0;
        $find = $this->pdo->prepare('SELECT id, edited, holiday_date, name FROM public_holidays WHERE organisation_id = ? AND provider_key = ?');
        $insert = $this->pdo->prepare("INSERT INTO public_holidays (id, organisation_id, holiday_date, name, source, provider_key, edited, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, 'provider', ?, 0, 0, ?, ?)");
        $refresh = $this->pdo->prepare('UPDATE public_holidays SET holiday_date = ?, name = ?, updated_at = ? WHERE id = ?');
        foreach ($holidays as $h) {
            $find->execute([$this->org, $h['key']]);
            $existing = $find->fetch();
            if ($existing === false) {
                $insert->execute([Uuid::v4(), $this->org, $h['date'], $h['name'], $h['key'], Time::db($now), Time::db($now)]);
                $added++;
            } elseif ((int) $existing['edited'] === 0 && ($existing['holiday_date'] !== $h['date'] || $existing['name'] !== $h['name'])) {
                $refresh->execute([$h['date'], $h['name'], Time::db($now), $existing['id']]);
                $updated++;
            }
        }
        return ['added' => $added, 'updated' => $updated];
    }

    /** @param array<string,string|int> $row */
    private static function map(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'date' => (string) $row['holiday_date'],
            'name' => (string) $row['name'],
            'source' => (string) $row['source'],
            'hidden' => (int) $row['hidden'] === 1,
            'edited' => (int) $row['edited'] === 1,
        ];
    }
}
```

- [ ] **Step 3: Implement the controllers**

`backend/src/Http/Controllers/UnavailabilityController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Auth\Principal;
use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\DirectoryRepository;
use Planning\Repo\SettingsRepository;
use Planning\Repo\UnavailabilityRepository;
use Planning\Support\Clock;
use Planning\Support\Time;

final class UnavailabilityController
{
    private const MAX_SECONDS = 366 * 86400;

    public function __construct(
        private readonly UnavailabilityRepository $unavailability,
        private readonly DirectoryRepository $directory,
        private readonly SettingsRepository $settings,
        private readonly Clock $clock,
    ) {
    }

    public function index(Request $request): Response
    {
        $in = new Input($request->query);
        $range = $in->dateRange('from', 'to', 366);
        $ref = $in->string('employee_ref', 64);
        $in->check();
        $tz = $this->settings->timezone();
        $records = $this->unavailability->between(Time::localMidnight($range[0], $tz), Time::localMidnight($range[1], $tz)->modify('+1 day'), $ref);
        return Response::json(200, ['unavailabilities' => array_map(UnavailabilityRepository::toApi(...), $records)]);
    }

    /** @param array<string,string> $params */
    public function store(Request $request, array $params, ?Principal $me): Response
    {
        $in = new Input($request->json());
        $ref = $in->string('employee_ref', 64, true);
        if ($ref !== null && !$this->directory->isEmpty() && $this->directory->find($ref) === null) {
            $in->error('employee_ref', 'Not on the employee roster.');
        }
        $start = $in->instant('start_at', true);
        $end = $in->instant('end_at', true);
        $reason = $in->string('reason', 200) ?? '';
        self::checkSpan($in, $start, $end);
        $in->check();
        $record = $this->unavailability->create((string) $ref, $start, $end, $reason, $me?->actorId() ?? 'unknown', $this->clock->now());
        return Response::json(201, ['unavailability' => UnavailabilityRepository::toApi($record)]);
    }

    /** @param array<string,string> $params */
    public function update(Request $request, array $params): Response
    {
        $current = $this->unavailability->find($params['id']) ?? throw HttpError::notFound('No time off with that id.');
        $in = new Input($request->json());
        $start = $in->has('start_at') ? $in->instant('start_at', true) : $current['start'];
        $end = $in->has('end_at') ? $in->instant('end_at', true) : $current['end'];
        $reason = $in->has('reason') ? ($in->string('reason', 200) ?? '') : $current['reason'];
        self::checkSpan($in, $start, $end);
        $in->check();
        $record = $this->unavailability->update($current['id'], $start, $end, $reason, $this->clock->now());
        return Response::json(200, ['unavailability' => UnavailabilityRepository::toApi($record)]);
    }

    /** @param array<string,string> $params */
    public function destroy(Request $request, array $params): Response
    {
        if (!$this->unavailability->delete($params['id'])) {
            throw HttpError::notFound('No time off with that id.');
        }
        return Response::noContent();
    }

    private static function checkSpan(Input $in, ?\DateTimeImmutable $start, ?\DateTimeImmutable $end): void
    {
        if ($start === null || $end === null) {
            return;
        }
        if ($end <= $start) {
            $in->error('end_at', 'Time off must end after it starts.');
        } elseif ($end->getTimestamp() - $start->getTimestamp() > self::MAX_SECONDS) {
            $in->error('end_at', 'Time off can last at most 366 days.');
        }
    }
}
```

`backend/src/Http/Controllers/HolidayController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Holidays\HolidayProvider;
use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\HolidayRepository;
use Planning\Repo\SettingsRepository;
use Planning\Support\Clock;

/** FR-CFG-04 */
final class HolidayController
{
    public function __construct(
        private readonly HolidayRepository $holidays,
        private readonly HolidayProvider $provider,
        private readonly SettingsRepository $settings,
        private readonly Clock $clock,
    ) {
    }

    public function index(Request $request): Response
    {
        $year = $request->queryString('year') ?? $this->clock->now()->setTimezone($this->settings->timezone())->format('Y');
        if (!ctype_digit($year) || (int) $year < 2000 || (int) $year > 2100) {
            throw HttpError::validation(['year' => 'Use a year between 2000 and 2100.']);
        }
        return Response::json(200, ['holidays' => $this->holidays->forYear((int) $year)]);
    }

    public function store(Request $request): Response
    {
        $in = new Input($request->json());
        $date = $in->date('date', true);
        $name = $in->string('name', 160, true);
        $in->check();
        return Response::json(201, ['holiday' => $this->holidays->createManual((string) $date, (string) $name, $this->clock->now())]);
    }

    /** @param array<string,string> $params */
    public function update(Request $request, array $params): Response
    {
        $holiday = $this->holidays->find($params['id']) ?? throw HttpError::notFound('No holiday with that id.');
        $in = new Input($request->json());
        $name = $in->has('name') ? $in->string('name', 160, true) : null;
        $hidden = $in->has('hidden') ? $in->bool('hidden') : null;
        $in->check();
        return Response::json(200, ['holiday' => $this->holidays->update($holiday['id'], $name, $hidden, $this->clock->now())]);
    }

    /** @param array<string,string> $params */
    public function destroy(Request $request, array $params): Response
    {
        $holiday = $this->holidays->find($params['id']) ?? throw HttpError::notFound('No holiday with that id.');
        if ($holiday['source'] === 'provider') {
            throw HttpError::conflict('PROVIDER_HOLIDAY', 'Holidays from the provider would come back on the next sync. Hide this holiday instead.');
        }
        $this->holidays->delete($holiday['id']);
        return Response::noContent();
    }

    public function sync(Request $request): Response
    {
        $in = new Input($request->json());
        $year = $in->int('year', 2000, 2100);
        if ($year === null) {
            $in->error('year', 'This field is required.');
        }
        $in->check();
        if (!$this->provider->isConfigured()) {
            throw HttpError::conflict('HOLIDAY_PROVIDER_NOT_CONFIGURED', 'No public holiday provider is configured yet (open issue OI-02). Add holidays by hand for now.');
        }
        $settings = $this->settings->get();
        if ($settings['country_code'] === null) {
            throw HttpError::conflict('COUNTRY_NOT_SET', 'Set the organisation country in settings before syncing holidays.');
        }
        $list = $this->provider->holidays((int) $year, $settings['country_code'], $settings['region_code']);
        return Response::json(201, $this->holidays->syncFromProvider($list, $this->clock->now()));
    }
}
```

- [ ] **Step 4: Wire routes, catalogue and `App`**

`App` getters (with matching `use` lines):

```php
    public function unavailability(): UnavailabilityRepository
    {
        return $this->once('unavailability', fn () => new UnavailabilityRepository($this->pdo(), $this->organisationId()));
    }

    public function holidays(): HolidayRepository
    {
        return $this->once('holidays', fn () => new HolidayRepository($this->pdo(), $this->organisationId()));
    }

    public function unavailabilityController(): UnavailabilityController
    {
        return $this->once('unavailabilityController', fn () => new UnavailabilityController($this->unavailability(), $this->directory(), $this->settings(), $this->clock()));
    }

    public function holidayController(): HolidayController
    {
        return $this->once('holidayController', fn () => new HolidayController($this->holidays(), $this->holidayProvider(), $this->settings(), $this->clock()));
    }
```

Routes:

```php
    $router->add('GET', '/api/unavailabilities', Route::MANAGER, 'List time off overlapping a date range.', $to('unavailabilityController', 'index'), Doc::op(
        'List Time Off', 'See when employees are away', ['Checking who is on leave this week'], ['Listing public holidays'],
        ['from', 'to', 'employee_ref'], ['unavailabilities[]'], ['Planning Manager'], ['POST /api/unavailabilities', 'GET /api/schedule'],
        ['time off', 'leave', 'absence', 'vacation', 'unavailable'],
    ));
    $router->add('POST', '/api/unavailabilities', Route::MANAGER, 'Record time off for an employee.', $to('unavailabilityController', 'store'), Doc::op(
        'Record Time Off', 'Mark an employee as unavailable', ['An employee is on leave, sick or training'], ['Adding a company-wide holiday'],
        ['employee_ref', 'start_at', 'end_at', 'reason'], ['unavailability'], ['Planning Manager', 'Employee on the roster'], ['GET /api/unavailabilities'],
        ['leave', 'sick', 'time off', 'absence'],
    ));
    $router->add('PATCH', '/api/unavailabilities/{id}', Route::MANAGER, 'Change recorded time off.', $to('unavailabilityController', 'update'), Doc::op(
        'Update Time Off', 'Correct the dates or reason of time off', ['Leave was extended or shortened'], ['Recording new time off'],
        ['start_at', 'end_at', 'reason'], ['unavailability'], ['Planning Manager'], ['GET /api/unavailabilities'],
        ['leave', 'time off', 'edit'],
    ));
    $router->add('DELETE', '/api/unavailabilities/{id}', Route::MANAGER, 'Remove recorded time off.', $to('unavailabilityController', 'destroy'), Doc::op(
        'Delete Time Off', 'Remove time off recorded by mistake', ['Leave was cancelled'], ['Shortening leave'],
        ['id'], [], ['Planning Manager'], ['GET /api/unavailabilities'],
        ['leave', 'time off', 'cancel'],
    ));
    $router->add('GET', '/api/holidays', Route::MANAGER, 'List public holidays for a year.', $to('holidayController', 'index'), Doc::op(
        'List Holidays', 'See the public holidays planning respects', ['Reviewing the holiday calendar'], ['Listing personal leave'],
        ['year'], ['holidays[]'], ['Planning Manager'], ['POST /api/holidays', 'POST /api/holiday-syncs'],
        ['holidays', 'public holiday', 'calendar'],
    ));
    $router->add('POST', '/api/holidays', Route::MANAGER, 'Add a public holiday by hand.', $to('holidayController', 'store'), Doc::op(
        'Add Holiday', 'Add a holiday the provider does not know', ['A state or company holiday is missing'], ['Loading a whole year of holidays'],
        ['date', 'name'], ['holiday'], ['Planning Manager'], ['GET /api/holidays'],
        ['holiday', 'add holiday', 'company holiday'],
    ));
    $router->add('PATCH', '/api/holidays/{id}', Route::MANAGER, 'Rename, hide or show a public holiday.', $to('holidayController', 'update'), Doc::op(
        'Update Holiday', 'Rename or hide a holiday', ['The organisation works on a public holiday', 'Correcting a holiday name'], ['Adding a holiday'],
        ['name', 'hidden'], ['holiday'], ['Planning Manager'], ['GET /api/holidays'],
        ['holiday', 'hide holiday', 'rename'],
    ));
    $router->add('DELETE', '/api/holidays/{id}', Route::MANAGER, 'Delete a manually added public holiday.', $to('holidayController', 'destroy'), Doc::op(
        'Delete Holiday', 'Remove a holiday added by hand', ['A manual holiday was added by mistake'], ['Removing a provider holiday (hide it instead)'],
        ['id'], [], ['Planning Manager', 'Holiday was added by hand'], ['PATCH /api/holidays/{id}'],
        ['holiday', 'delete holiday'],
    ));
    $router->add('POST', '/api/holiday-syncs', Route::MANAGER, 'Load a year of public holidays from the holiday provider.', $to('holidayController', 'sync'), Doc::op(
        'Sync Holidays', 'Load public holidays for the organisation\'s country and region', ['Starting a new year', 'After changing the country or region'], ['Adding one holiday by hand'],
        ['year'], ['added', 'updated'], ['Planning Manager', 'Country set in settings', 'Holiday provider configured'], ['PATCH /api/settings', 'GET /api/holidays'],
        ['holidays', 'sync', 'import', 'public holidays'],
    ));
```

Append to `capabilities`:

```php
        [
            'name' => 'Track Time Off',
            'icon' => '🏖️',
            'description' => 'Record when people are away and which public holidays apply.',
            'does' => ['Record leave for an employee', 'Add, hide or sync public holidays'],
            'best_for' => 'Keeping the schedule from planning people who are away.',
            'endpoints' => [
                'GET /api/unavailabilities', 'POST /api/unavailabilities', 'PATCH /api/unavailabilities/{id}', 'DELETE /api/unavailabilities/{id}',
                'GET /api/holidays', 'POST /api/holidays', 'PATCH /api/holidays/{id}', 'DELETE /api/holidays/{id}', 'POST /api/holiday-syncs',
            ],
        ],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "UnavailabilityApiTest|HolidaysApiTest|OpenApiDocumentTest"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: record time off and manage public holidays"
```

---

### Task 14: Planning Manager list API (FR-ACC-03)

**Files:**
- Create: `backend/src/Http/Controllers/ManagerController.php`
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Integration/Api/ManagersApiTest.php`

**Interfaces:**
- Consumes: `ManagerRepository` (Task 6), `Roster` (Task 7), `Input`.
- Produces:
  - `GET /api/managers` returns `{managers: [{email, granted_by, granted_at}], note}`.
  - `POST /api/managers {email}` returns 201 for a new grant, 200 if the person already had one, 422 if they're not on the roster, and 503 `ROSTER_UNAVAILABLE` if the roster can't be reached.
  - `DELETE /api/managers/{email}[?confirm=true]` returns 204, 404 if the person isn't listed, or 409 `LAST_MANAGER`. The 409 applies when a non-admin removes themselves while they are the only listed manager.
  - `App::managerController()`.

- [ ] **Step 1: Write the failing test**

`backend/tests/Integration/Api/ManagersApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Auth\Principal;
use Planning\Tests\Support\ApiTestCase;

final class ManagersApiTest extends ApiTestCase
{
    public function test_grant_is_idempotent_and_listed(): void
    {
        $this->roster->add('u1', 'Bo Tan', 'bo@example.com');

        $this->assertSame(201, $this->call('POST', '/api/managers', ['email' => 'Bo@Example.com'])[0]);
        [$status, $body] = $this->call('POST', '/api/managers', ['email' => 'bo@example.com']);

        $this->assertSame(200, $status);
        $this->assertSame(['email' => 'bo@example.com', 'granted_by' => 'mona@example.com', 'granted_at' => '2026-10-13T02:00:00Z'], $body['manager']);
        $this->assertSame(['bo@example.com'], array_column($this->call('GET', '/api/managers')[1]['managers'], 'email'));
    }

    public function test_grant_requires_someone_on_the_roster(): void
    {
        [$status, $body] = $this->call('POST', '/api/managers', ['email' => 'ghost@example.com']);
        $this->assertSame(422, $status);
        $this->assertSame('This email is not on the employee roster.', $body['error']['details']['email']);

        $this->assertSame(422, $this->call('POST', '/api/managers', ['email' => 'not-an-email'])[0]);

        $this->roster->down = true;
        [$status, $body] = $this->call('POST', '/api/managers', ['email' => 'bo@example.com']);
        $this->assertSame(503, $status);
        $this->assertSame('ROSTER_UNAVAILABLE', $body['error']['code']);
    }

    public function test_revoke(): void
    {
        $this->roster->add('u1', 'Bo Tan', 'bo@example.com');
        $this->call('POST', '/api/managers', ['email' => 'bo@example.com']);

        $this->assertSame(204, $this->call('DELETE', '/api/managers/bo@example.com')[0]);
        $this->assertSame(404, $this->call('DELETE', '/api/managers/bo@example.com')[0]);
    }

    public function test_last_listed_manager_is_warned_before_removing_themselves(): void
    {
        $this->roster->add('u1', 'Bo Tan', 'bo@example.com');
        $this->call('POST', '/api/managers', ['email' => 'bo@example.com']);
        $this->asManager('bo@example.com');

        [$status, $body] = $this->call('DELETE', '/api/managers/bo@example.com');
        $this->assertSame(409, $status);
        $this->assertSame('LAST_MANAGER', $body['error']['code']);

        $this->assertSame(204, $this->call('DELETE', '/api/managers/bo@example.com', null, ['confirm' => 'true'])[0]);
    }

    public function test_gateway_admins_are_not_warned(): void
    {
        $this->roster->add('u1', 'Bo Tan', 'bo@example.com');
        $this->call('POST', '/api/managers', ['email' => 'bo@example.com']);
        $this->guard->principal = new Principal('person', 'sub-bo', 'bo@example.com', 'Bo', 'admin', null, true);

        $this->assertSame(204, $this->call('DELETE', '/api/managers/bo@example.com')[0]);
    }

    public function test_employees_cannot_manage_managers(): void
    {
        $this->asEmployee('E1');
        $this->assertSame(403, $this->call('GET', '/api/managers')[0]);
        $this->assertSame(403, $this->call('POST', '/api/managers', ['email' => 'ana@example.com'])[0]);
    }
}
```

Run: `php vendor/bin/phpunit --filter ManagersApiTest`
Expected: FAIL (404s).

- [ ] **Step 2: Implement the controller**

`backend/src/Http/Controllers/ManagerController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Auth\Principal;
use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\ManagerRepository;
use Planning\Roster\Roster;
use Planning\Roster\RosterUnavailable;
use Planning\Support\Clock;

/** FR-ACC-03, BR-12 */
final class ManagerController
{
    public function __construct(private readonly ManagerRepository $managers, private readonly Roster $roster, private readonly Clock $clock)
    {
    }

    public function index(Request $request): Response
    {
        return Response::json(200, [
            'managers' => $this->managers->all(),
            'note' => 'InterlinkERP gateway admins are always Planning Managers and are not listed here.',
        ]);
    }

    /** @param array<string,string> $params */
    public function store(Request $request, array $params, ?Principal $me): Response
    {
        $in = new Input($request->json());
        $email = $in->string('email', 254, true);
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $in->error('email', 'Not a valid email address.');
        }
        $in->check();
        $email = strtolower((string) $email);

        try {
            $person = $this->roster->findByEmail($email);
        } catch (RosterUnavailable) {
            throw new HttpError(503, 'ROSTER_UNAVAILABLE', 'The employee roster cannot be reached right now. Try again shortly.');
        }
        if ($person === null) {
            throw HttpError::validation(['email' => 'This email is not on the employee roster.']);
        }

        $created = $this->managers->grant($email, $me?->actorId() ?? 'unknown', $this->clock->now());
        $grant = array_values(array_filter($this->managers->all(), static fn (array $m): bool => $m['email'] === $email))[0];
        return Response::json($created ? 201 : 200, ['manager' => $grant]);
    }

    /** @param array<string,string> $params */
    public function destroy(Request $request, array $params, ?Principal $me): Response
    {
        $email = strtolower(trim($params['email']));
        if (!$this->managers->isManager($email)) {
            throw HttpError::notFound('That person is not on the Planning Manager list.');
        }
        $removingSelf = $me !== null && $me->email === $email && $me->gatewayRole !== 'admin';
        if ($removingSelf && $this->managers->count() === 1 && $request->queryString('confirm') !== 'true') {
            throw HttpError::conflict('LAST_MANAGER', 'You are the last listed Planning Manager. After this, only gateway admins can manage planning. Repeat with ?confirm=true to continue.');
        }
        $this->managers->revoke($email);
        return Response::noContent();
    }
}
```

- [ ] **Step 3: Wire routes, catalogue and `App`**

```php
    public function managerController(): ManagerController
    {
        return $this->once('managerController', fn () => new ManagerController($this->managers(), $this->roster(), $this->clock()));
    }
```

Routes:

```php
    $router->add('GET', '/api/managers', Route::MANAGER, 'List people granted Planning Manager access.', $to('managerController', 'index'), Doc::op(
        'List Planning Managers', 'See who can manage planning', ['Reviewing who has manager access'], ['Listing employees'],
        [], ['managers[].email', 'managers[].granted_by', 'managers[].granted_at'], ['Planning Manager'], ['POST /api/managers', 'DELETE /api/managers/{email}'],
        ['managers', 'permissions', 'access', 'admins'],
    ));
    $router->add('POST', '/api/managers', Route::MANAGER, 'Grant Planning Manager access to someone on the roster.', $to('managerController', 'store'), Doc::op(
        'Grant Manager Access', 'Let someone plan and publish shifts', ['A new supervisor needs to plan shifts'], ['Giving someone a planning role'],
        ['email'], ['manager'], ['Planning Manager', 'Person is on the employee roster'], ['GET /api/managers'],
        ['grant', 'permission', 'manager', 'access'],
    ));
    $router->add('DELETE', '/api/managers/{email}', Route::MANAGER, 'Revoke Planning Manager access.', $to('managerController', 'destroy'), Doc::op(
        'Revoke Manager Access', 'Stop someone managing planning', ['A supervisor changes team or leaves'], ['Removing an employee from the roster'],
        ['email', 'confirm'], [], ['Planning Manager', 'Person is listed'], ['GET /api/managers'],
        ['revoke', 'remove manager', 'permission'],
    ));
```

Append to the "Check Access" capability's `endpoints`: `'GET /api/managers', 'POST /api/managers', 'DELETE /api/managers/{email}'`. Also add `'Grant or revoke Planning Manager access'` to its `does` list.

- [ ] **Step 4: Run all tests so far**

Run: `php vendor/bin/phpunit`
Expected: PASS, both suites.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: let managers grant and revoke Planning Manager access"
```

---

### Task 15: Create, read and edit shifts, with conflict warnings and a notification outbox

**Files:**
- Create: `backend/src/Repo/ShiftRecord.php`, `backend/src/Repo/ShiftRepository.php`, `backend/src/Repo/Outbox.php`
- Create: `backend/src/Scheduling/ConflictContext.php`, `backend/src/Scheduling/ShiftService.php`
- Create: `backend/src/Http/Controllers/ShiftController.php`
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Integration/Api/ShiftsApiTest.php`

**Interfaces:**
- Consumes: Domain (Tasks 9–10), `Input`, repositories from Tasks 7, 11–13.
- Produces:
  - `ShiftRecord` fields, in this order: `id`, `employeeRef`, `roleId`, `start`, `end`, `breakMinutes`, `percent`, `note`, `state`, `publishedAt`, `ackBy`, `ackAt`, `version`, `createdBy`, `deletedAt = null`. Methods:
    - `ShiftRecord::fromRow(array)`, `->with(array<string,mixed> $changes): ShiftRecord`
    - `->facts(): ShiftFacts`, `->isPublished(): bool`
    - `->toApi(list<Conflict> $conflicts = []): array`, `->toMyApi(): array`
  - `ShiftRepository(\PDO, string $org)`. Methods:
    - `->find(string $id, bool $withDeleted = false): ?ShiftRecord`
    - `->overlapping(\DateTimeImmutable $from, \DateTimeImmutable $to): list<ShiftRecord>`
    - `->forEmployeeOverlapping(string $ref, \DateTimeImmutable $from, \DateTimeImmutable $to): list<ShiftRecord>`
    - `->insert(ShiftRecord, \DateTimeImmutable $now): void`
    - `->update(ShiftRecord, int $expectedVersion, \DateTimeImmutable $now): bool`
    - `->softDelete(string $id, string $by, \DateTimeImmutable $now): void`, `->restore(string $id, \DateTimeImmutable $now): void`
    - `->publish(list<string> $ids, \DateTimeImmutable $now): list<ShiftRecord>`
    - `->publishedForEmployee(string $ref, \DateTimeImmutable $from, \DateTimeImmutable $to): list<ShiftRecord>`
  - `Outbox(\PDO, string $org)`. Methods: `->add(string $kind, ?string $employeeRef, ?string $subjectId, array $payload, \DateTimeImmutable $deliverAfter, \DateTimeImmutable $now): void`, `->cancelPending(string $kind, string $subjectId, \DateTimeImmutable $now): int`, `->all(): list<array{kind, employee_ref, subject_id, payload: array, deliver_after: string, cancelled: bool}>`. Kinds used in M1: `schedule_published`, `shift_changed`, `shift_assigned`, `shift_unassigned`, `shift_deleted`.
  - `ConflictContext(ShiftRepository, ProfileRepository, UnavailabilityRepository, HolidayRepository, SettingsRepository)`, `->conflictsFor(ShiftRecord): list<Conflict>`, `->timezoneFor(array $profile): \DateTimeZone`, `ConflictContext::spans(list $timeOff, list $holidays, \DateTimeZone): list<UnavailableSpan>`.
  - `ShiftService(ShiftRepository, ProfileRepository, RoleRepository, DirectoryRepository, ConflictContext, Outbox, Clock)`, constants `MAX_DURATION_SECONDS = 604800` and `UNDO_SECONDS = 30`. `->create(array $body, Principal): array{shift: ShiftRecord, conflicts: list<Conflict>}` and `->update(string $id, array $body, Principal): array{shift, conflicts}`. Task 16 adds `delete`, `restore` and `duplicate`.
  - Endpoints:
    - `POST /api/shifts` returns 201 `{shift}`.
    - `GET /api/shifts/{id}` returns `{shift}`.
    - `PATCH /api/shifts/{id}` requires `version` and returns `{shift}`.
    - Errors: 409 `SHIFT_CONFLICT` with `details.conflicts`, 409 `STALE_SHIFT`, 422.
  - Shift JSON: `{id, employee_ref, role_id, start_at, end_at, break_minutes, allocated_percent, allocated_hours, note, state, published_at, version, conflicts: [{rule, message}], conflict_acknowledged}`.
  - `App` getters: `shifts()`, `outbox()`, `conflictContext()`, `shiftService()`, `shiftController()`.

- [ ] **Step 1: Write the failing test**

`backend/tests/Integration/Api/ShiftsApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Repo\Outbox;
use Planning\Tests\Support\ApiTestCase;

final class ShiftsApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->addEmployee('E1', 'Ana Lim');
        $this->addEmployee('E2', 'Bo Tan');
    }

    /**
     * @param array<string,mixed> $overrides
     * @return array{0: int, 1: mixed}
     */
    private function create(array $overrides = []): array
    {
        return $this->call('POST', '/api/shifts', array_merge([
            'employee_ref' => 'E1', 'start_at' => '2026-10-14T09:00:00+08:00', 'end_at' => '2026-10-14T17:00:00+08:00', 'break_minutes' => 60,
        ], $overrides));
    }

    /** @return array<string,mixed> */
    private function created(array $overrides = []): array
    {
        [$status, $body] = $this->create($overrides);
        $this->assertSame(201, $status, json_encode($body));
        return $body['shift'];
    }

    private function markPublished(string $id): void
    {
        $this->pdo()->prepare("UPDATE shifts SET state = 'published', published_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$id]);
    }

    /** @return list<array<string,mixed>> */
    private function outbox(): array
    {
        return (new Outbox($this->pdo(), self::ORG))->all();
    }

    public function test_times_alone_make_an_open_draft_shift(): void
    {
        [$status, $body] = $this->call('POST', '/api/shifts', ['start_at' => '2026-10-14T09:00:00+08:00', 'end_at' => '2026-10-14T13:00:00+08:00']);

        $this->assertSame(201, $status);
        $shift = $body['shift'];
        $this->assertNull($shift['employee_ref']);
        $this->assertSame('draft', $shift['state']);
        $this->assertSame('2026-10-14T01:00:00Z', $shift['start_at']);
        $this->assertSame(100, $shift['allocated_percent']);
        $this->assertSame(4, (int) $shift['allocated_hours']);
        $this->assertSame(1, $shift['version']);
        $this->assertSame([], $shift['conflicts']);
    }

    public function test_default_role_is_used_unless_role_is_sent(): void
    {
        $tech = $this->addRole('Technician');
        $this->call('PATCH', '/api/employees/E1', ['role_ids' => [$tech], 'default_role_id' => $tech]);

        $this->assertSame($tech, $this->created()['role_id']);
        $this->assertNull($this->created(['role_id' => null, 'start_at' => '2026-10-15T09:00:00+08:00', 'end_at' => '2026-10-15T17:00:00+08:00'])['role_id']);
    }

    public function test_overnight_shift_is_one_shift(): void
    {
        $shift = $this->created(['start_at' => '2026-10-14T22:00:00+08:00', 'end_at' => '2026-10-15T06:00:00+08:00', 'break_minutes' => 0]);
        $this->assertSame('2026-10-14T14:00:00Z', $shift['start_at']);
        $this->assertSame('2026-10-14T22:00:00Z', $shift['end_at']);
        $this->assertSame(8, (int) $shift['allocated_hours']);
    }

    public function test_bad_input_names_every_field(): void
    {
        $archived = $this->addRole('Old');
        $this->call('PATCH', "/api/roles/$archived", ['archived' => true]);

        [$status, $body] = $this->call('POST', '/api/shifts', [
            'employee_ref' => 'E404', 'role_id' => $archived, 'start_at' => '2026-10-14T09:00:00', 'end_at' => '2026-02-30T10:00:00+08:00', 'allocated_percent' => 0,
        ]);
        $this->assertSame(422, $status);
        $this->assertEqualsCanonicalizing(['employee_ref', 'role_id', 'start_at', 'end_at', 'allocated_percent'], array_keys($body['error']['details']));

        [, $body] = $this->create(['end_at' => '2026-10-14T08:00:00+08:00']);
        $this->assertSame('The shift must end after it starts.', $body['error']['details']['end_at']);

        [, $body] = $this->create(['break_minutes' => 480]);
        $this->assertSame('The break must be shorter than the shift.', $body['error']['details']['break_minutes']);

        [, $body] = $this->create(['end_at' => '2026-10-22T09:00:00+08:00']);
        $this->assertSame('A shift can last at most 7 days.', $body['error']['details']['end_at']);
    }

    public function test_conflict_warns_and_can_be_acknowledged(): void
    {
        $this->call('POST', '/api/unavailabilities', ['employee_ref' => 'E1', 'start_at' => '2026-10-16T00:00:00+08:00', 'end_at' => '2026-10-17T00:00:00+08:00', 'reason' => 'Annual leave']);
        $friday = ['start_at' => '2026-10-16T09:00:00+08:00', 'end_at' => '2026-10-16T17:00:00+08:00'];

        [$status, $body] = $this->create($friday);
        $this->assertSame(409, $status);
        $this->assertSame('SHIFT_CONFLICT', $body['error']['code']);
        $this->assertSame('unavailable', $body['error']['details']['conflicts'][0]['rule']);

        $shift = $this->created($friday + ['acknowledge_conflicts' => true]);
        $this->assertTrue($shift['conflict_acknowledged']);
        $this->assertSame('The employee is on time off: Annual leave.', $shift['conflicts'][0]['message']);
    }

    public function test_overlap_with_another_shift_is_a_conflict(): void
    {
        $this->created();
        [$status, $body] = $this->create(['start_at' => '2026-10-14T16:00:00+08:00', 'end_at' => '2026-10-14T20:00:00+08:00', 'break_minutes' => 0]);
        $this->assertSame(409, $status);
        $this->assertSame('overlap', $body['error']['details']['conflicts'][0]['rule']);
    }

    public function test_move_and_resize_with_optimistic_concurrency(): void
    {
        $shift = $this->created();

        [$status, $moved] = $this->call('PATCH', "/api/shifts/{$shift['id']}", ['version' => 1, 'start_at' => '2026-10-15T09:00:00+08:00', 'end_at' => '2026-10-15T18:00:00+08:00']);
        $this->assertSame(200, $status);
        $this->assertSame('2026-10-15T01:00:00Z', $moved['shift']['start_at']);
        $this->assertSame(2, $moved['shift']['version']);

        [$status, $body] = $this->call('PATCH', "/api/shifts/{$shift['id']}", ['version' => 1, 'note' => 'Bring keys']);
        $this->assertSame(409, $status);
        $this->assertSame('STALE_SHIFT', $body['error']['code']);

        $this->assertSame(422, $this->call('PATCH', "/api/shifts/{$shift['id']}", ['note' => 'no version'])[0]);
    }

    public function test_reassigning_a_published_shift_notifies_both_employees(): void
    {
        $shift = $this->created();
        $this->markPublished($shift['id']);

        [$status, $body] = $this->call('PATCH', "/api/shifts/{$shift['id']}", ['version' => 1, 'employee_ref' => 'E2']);

        $this->assertSame(200, $status);
        $this->assertSame('published', $body['shift']['state'], 'BR-11: stays published');
        $this->assertSame([['shift_unassigned', 'E1'], ['shift_assigned', 'E2']], array_map(static fn (array $r): array => [$r['kind'], $r['employee_ref']], $this->outbox()));
    }

    public function test_changing_a_published_note_notifies_and_drafts_notify_nobody(): void
    {
        $draft = $this->created();
        $this->call('PATCH', "/api/shifts/{$draft['id']}", ['version' => 1, 'note' => 'x']);
        $this->assertSame([], $this->outbox());

        $published = $this->created(['start_at' => '2026-10-20T09:00:00+08:00', 'end_at' => '2026-10-20T17:00:00+08:00']);
        $this->markPublished($published['id']);
        $this->call('PATCH', "/api/shifts/{$published['id']}", ['version' => 1, 'note' => 'Bring keys']);

        $rows = $this->outbox();
        $this->assertSame('shift_changed', $rows[0]['kind']);
        $this->assertSame(['shift_id' => $published['id'], 'changed' => ['note']], $rows[0]['payload']);
    }

    public function test_show_and_missing(): void
    {
        $shift = $this->created();
        $this->assertSame($shift['id'], $this->call('GET', "/api/shifts/{$shift['id']}")[1]['shift']['id']);
        $this->assertSame(404, $this->call('GET', '/api/shifts/nope')[0]);
        $this->assertSame(404, $this->call('PATCH', '/api/shifts/nope', ['version' => 1])[0]);
    }

    public function test_employees_cannot_plan(): void
    {
        $this->asEmployee('E1');
        $this->assertSame(403, $this->create()[0]);
    }
}
```

Run: `php vendor/bin/phpunit --filter ShiftsApiTest`
Expected: FAIL (404s).

- [ ] **Step 2: Implement the shift record and repository**

`backend/src/Repo/ShiftRecord.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use Planning\Domain\Allocation;
use Planning\Domain\Conflict;
use Planning\Domain\Interval;
use Planning\Domain\ShiftFacts;
use Planning\Support\Time;

final class ShiftRecord
{
    public function __construct(
        public readonly string $id,
        public readonly ?string $employeeRef,
        public readonly ?string $roleId,
        public readonly \DateTimeImmutable $start,
        public readonly \DateTimeImmutable $end,
        public readonly int $breakMinutes,
        public readonly int $percent,
        public readonly ?string $note,
        public readonly string $state,
        public readonly ?\DateTimeImmutable $publishedAt,
        public readonly ?string $ackBy,
        public readonly ?\DateTimeImmutable $ackAt,
        public readonly int $version,
        public readonly string $createdBy,
        public readonly ?\DateTimeImmutable $deletedAt = null,
    ) {
    }

    /** @param array<string, string|int|null> $row */
    public static function fromRow(array $row): self
    {
        $at = static fn (mixed $v): ?\DateTimeImmutable => $v === null ? null : Time::fromDb((string) $v);
        return new self(
            (string) $row['id'],
            $row['employee_ref'] === null ? null : (string) $row['employee_ref'],
            $row['role_id'] === null ? null : (string) $row['role_id'],
            Time::fromDb((string) $row['start_at']),
            Time::fromDb((string) $row['end_at']),
            (int) $row['break_minutes'],
            (int) $row['allocated_percent'],
            $row['note'] === null ? null : (string) $row['note'],
            (string) $row['state'],
            $at($row['published_at']),
            $row['conflict_acknowledged_by'] === null ? null : (string) $row['conflict_acknowledged_by'],
            $at($row['conflict_acknowledged_at']),
            (int) $row['version'],
            (string) $row['created_by'],
            $at($row['deleted_at']),
        );
    }

    /** @param array<string, mixed> $changes property name => new value */
    public function with(array $changes): self
    {
        $values = get_object_vars($this);
        foreach ($changes as $name => $value) {
            if (!array_key_exists($name, $values)) {
                throw new \InvalidArgumentException("ShiftRecord has no field $name.");
            }
            $values[$name] = $value;
        }
        return new self(...$values);
    }

    public function facts(): ShiftFacts
    {
        return new ShiftFacts($this->id, $this->employeeRef, $this->roleId, new Interval($this->start, $this->end), $this->breakMinutes, $this->percent);
    }

    public function isPublished(): bool
    {
        return $this->state === 'published';
    }

    /**
     * @param list<Conflict> $conflicts
     * @return array<string, mixed>
     */
    public function toApi(array $conflicts = []): array
    {
        return [
            'id' => $this->id,
            'employee_ref' => $this->employeeRef,
            'role_id' => $this->roleId,
            'start_at' => Time::iso($this->start),
            'end_at' => Time::iso($this->end),
            'break_minutes' => $this->breakMinutes,
            'allocated_percent' => $this->percent,
            'allocated_hours' => Allocation::shiftHours($this->facts()),
            'note' => $this->note,
            'state' => $this->state,
            'published_at' => $this->publishedAt === null ? null : Time::iso($this->publishedAt),
            'version' => $this->version,
            'conflicts' => array_map(static fn (Conflict $c): array => $c->toArray(), $conflicts),
            'conflict_acknowledged' => $this->ackAt !== null,
        ];
    }

    /** What an employee sees of their own published shift (FR-MYP-01). @return array<string, mixed> */
    public function toMyApi(): array
    {
        return [
            'id' => $this->id,
            'role_id' => $this->roleId,
            'start_at' => Time::iso($this->start),
            'end_at' => Time::iso($this->end),
            'break_minutes' => $this->breakMinutes,
            'allocated_hours' => Allocation::shiftHours($this->facts()),
            'note' => $this->note,
        ];
    }
}
```

`backend/src/Repo/ShiftRepository.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;

final class ShiftRepository
{
    private const COLUMNS = 'id, employee_ref, role_id, start_at, end_at, break_minutes, allocated_percent, note, state, published_at, conflict_acknowledged_by, conflict_acknowledged_at, version, created_by, deleted_at';

    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    public function find(string $id, bool $withDeleted = false): ?ShiftRecord
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM shifts WHERE organisation_id = ? AND id = ?' . ($withDeleted ? '' : ' AND deleted_at IS NULL'));
        $st->execute([$this->org, $id]);
        $row = $st->fetch();
        return $row === false ? null : ShiftRecord::fromRow($row);
    }

    /** @return list<ShiftRecord> live shifts overlapping [from, to), open shifts included */
    public function overlapping(\DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM shifts WHERE organisation_id = ? AND deleted_at IS NULL AND start_at < ? AND end_at > ? ORDER BY start_at, id');
        $st->execute([$this->org, Time::db($to), Time::db($from)]);
        return array_map(ShiftRecord::fromRow(...), $st->fetchAll());
    }

    /** @return list<ShiftRecord> */
    public function forEmployeeOverlapping(string $ref, \DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM shifts WHERE organisation_id = ? AND employee_ref = ? AND deleted_at IS NULL AND start_at < ? AND end_at > ? ORDER BY start_at, id');
        $st->execute([$this->org, $ref, Time::db($to), Time::db($from)]);
        return array_map(ShiftRecord::fromRow(...), $st->fetchAll());
    }

    public function insert(ShiftRecord $s, \DateTimeImmutable $now): void
    {
        $this->pdo->prepare(
            'INSERT INTO shifts (id, organisation_id, employee_ref, role_id, start_at, end_at, break_minutes, allocated_percent, note, state, published_at,
              conflict_acknowledged_by, conflict_acknowledged_at, version, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )->execute([
            $s->id, $this->org, $s->employeeRef, $s->roleId, Time::db($s->start), Time::db($s->end), $s->breakMinutes, $s->percent, $s->note, $s->state,
            $s->publishedAt === null ? null : Time::db($s->publishedAt), $s->ackBy, $s->ackAt === null ? null : Time::db($s->ackAt),
            $s->version, $s->createdBy, Time::db($now), Time::db($now),
        ]);
    }

    /** Saves only if nobody else saved since $expectedVersion; bumps the version. */
    public function update(ShiftRecord $s, int $expectedVersion, \DateTimeImmutable $now): bool
    {
        $st = $this->pdo->prepare(
            'UPDATE shifts SET employee_ref = ?, role_id = ?, start_at = ?, end_at = ?, break_minutes = ?, allocated_percent = ?, note = ?,
              conflict_acknowledged_by = ?, conflict_acknowledged_at = ?, version = version + 1, updated_at = ?
             WHERE organisation_id = ? AND id = ? AND version = ? AND deleted_at IS NULL',
        );
        $st->execute([
            $s->employeeRef, $s->roleId, Time::db($s->start), Time::db($s->end), $s->breakMinutes, $s->percent, $s->note,
            $s->ackBy, $s->ackAt === null ? null : Time::db($s->ackAt), Time::db($now), $this->org, $s->id, $expectedVersion,
        ]);
        return $st->rowCount() === 1;
    }

    public function softDelete(string $id, string $by, \DateTimeImmutable $now): void
    {
        $this->pdo->prepare('UPDATE shifts SET deleted_at = ?, deleted_by = ?, version = version + 1, updated_at = ? WHERE organisation_id = ? AND id = ? AND deleted_at IS NULL')
            ->execute([Time::db($now), $by, Time::db($now), $this->org, $id]);
    }

    public function restore(string $id, \DateTimeImmutable $now): void
    {
        $this->pdo->prepare('UPDATE shifts SET deleted_at = NULL, deleted_by = NULL, version = version + 1, updated_at = ? WHERE organisation_id = ? AND id = ?')
            ->execute([Time::db($now), $this->org, $id]);
    }

    /**
     * Publishes the listed drafts (deleted and already-published ids are skipped).
     *
     * @param list<string> $ids
     * @return list<ShiftRecord> the shifts this call published
     */
    public function publish(array $ids, \DateTimeImmutable $now): array
    {
        if ($ids === []) {
            return [];
        }
        $marks = implode(', ', array_fill(0, count($ids), '?'));
        $this->pdo->beginTransaction();
        try {
            $select = $this->pdo->prepare('SELECT id FROM shifts WHERE organisation_id = ? AND deleted_at IS NULL AND state = \'draft\' AND id IN (' . $marks . ') ORDER BY start_at, id FOR UPDATE');
            $select->execute([$this->org, ...$ids]);
            $toPublish = $select->fetchAll(PDO::FETCH_COLUMN);
            if ($toPublish !== []) {
                $marks = implode(', ', array_fill(0, count($toPublish), '?'));
                $this->pdo->prepare('UPDATE shifts SET state = \'published\', published_at = ?, version = version + 1, updated_at = ? WHERE organisation_id = ? AND id IN (' . $marks . ')')
                    ->execute([Time::db($now), Time::db($now), $this->org, ...$toPublish]);
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        return array_values(array_filter(array_map(fn (string $id): ?ShiftRecord => $this->find($id), $toPublish)));
    }

    /** @return list<ShiftRecord> */
    public function publishedForEmployee(string $ref, \DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $st = $this->pdo->prepare('SELECT ' . self::COLUMNS . " FROM shifts WHERE organisation_id = ? AND employee_ref = ? AND state = 'published' AND deleted_at IS NULL AND start_at < ? AND end_at > ? ORDER BY start_at");
        $st->execute([$this->org, $ref, Time::db($to), Time::db($from)]);
        return array_map(ShiftRecord::fromRow(...), $st->fetchAll());
    }
}
```

`backend/src/Repo/Outbox.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Repo;

use PDO;
use Planning\Support\Time;

/**
 * Notifications waiting to be delivered. M1 only records them; M2 adds
 * delivery (roadmap). Writing them in the same request as the change means
 * nothing is lost when delivery is added.
 */
final class Outbox
{
    public function __construct(private readonly PDO $pdo, private readonly string $org)
    {
    }

    /** @param array<string, mixed> $payload */
    public function add(string $kind, ?string $employeeRef, ?string $subjectId, array $payload, \DateTimeImmutable $deliverAfter, \DateTimeImmutable $now): void
    {
        $this->pdo->prepare('INSERT INTO notification_outbox (organisation_id, kind, employee_ref, subject_id, payload, deliver_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$this->org, $kind, $employeeRef, $subjectId, json_encode($payload, JSON_THROW_ON_ERROR), Time::db($deliverAfter), Time::db($now)]);
    }

    public function cancelPending(string $kind, string $subjectId, \DateTimeImmutable $now): int
    {
        $st = $this->pdo->prepare('UPDATE notification_outbox SET cancelled_at = ? WHERE organisation_id = ? AND kind = ? AND subject_id = ? AND delivered_at IS NULL AND cancelled_at IS NULL');
        $st->execute([Time::db($now), $this->org, $kind, $subjectId]);
        return $st->rowCount();
    }

    /** @return list<array{kind: string, employee_ref: ?string, subject_id: ?string, payload: array<string,mixed>, deliver_after: string, cancelled: bool}> */
    public function all(): array
    {
        $st = $this->pdo->prepare('SELECT kind, employee_ref, subject_id, payload, deliver_after, cancelled_at FROM notification_outbox WHERE organisation_id = ? ORDER BY id');
        $st->execute([$this->org]);
        return array_map(static fn (array $r): array => [
            'kind' => $r['kind'],
            'employee_ref' => $r['employee_ref'],
            'subject_id' => $r['subject_id'],
            'payload' => json_decode($r['payload'], true),
            'deliver_after' => Time::iso(Time::fromDb($r['deliver_after'])),
            'cancelled' => $r['cancelled_at'] !== null,
        ], $st->fetchAll());
    }
}
```

- [ ] **Step 3: Implement conflict context and the shift service**

`backend/src/Scheduling/ConflictContext.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Scheduling;

use Planning\Domain\Conflict;
use Planning\Domain\ConflictDetector;
use Planning\Domain\Interval;
use Planning\Domain\UnavailableSpan;
use Planning\Repo\HolidayRepository;
use Planning\Repo\ProfileRepository;
use Planning\Repo\SettingsRepository;
use Planning\Repo\ShiftRecord;
use Planning\Repo\ShiftRepository;
use Planning\Repo\UnavailabilityRepository;
use Planning\Support\Time;

/** Loads what BR-01 needs for one shift and runs the pure detector. */
final class ConflictContext
{
    public function __construct(
        private readonly ShiftRepository $shifts,
        private readonly ProfileRepository $profiles,
        private readonly UnavailabilityRepository $unavailability,
        private readonly HolidayRepository $holidays,
        private readonly SettingsRepository $settings,
    ) {
    }

    /** @return list<Conflict> conflicts the shift would have if saved as given */
    public function conflictsFor(ShiftRecord $candidate): array
    {
        if ($candidate->employeeRef === null) {
            return [];
        }
        $profile = $this->profiles->find($candidate->employeeRef);
        $tz = $this->timezoneFor($profile);

        $others = array_filter(
            $this->shifts->forEmployeeOverlapping($candidate->employeeRef, $candidate->start, $candidate->end),
            static fn (ShiftRecord $s): bool => $s->id !== $candidate->id,
        );
        $facts = array_map(static fn (ShiftRecord $s) => $s->facts(), array_values($others));
        $facts[] = $candidate->facts();

        $spans = self::spans(
            $this->unavailability->between($candidate->start, $candidate->end, $candidate->employeeRef),
            $this->holidays->visibleBetween($candidate->start->setTimezone($tz)->format('Y-m-d'), $candidate->end->setTimezone($tz)->format('Y-m-d')),
            $tz,
        );
        return ConflictDetector::forEmployee($facts, $spans, $profile['role_ids'])[$candidate->id];
    }

    /** @param array{timezone: ?string} $profile */
    public function timezoneFor(array $profile): \DateTimeZone
    {
        return new \DateTimeZone($profile['timezone'] ?? $this->settings->get()['timezone']);
    }

    /**
     * @param list<array{start: \DateTimeImmutable, end: \DateTimeImmutable, reason: string}> $timeOff
     * @param list<array{date: string, name: string}> $holidays dates are whole days in $tz
     * @return list<UnavailableSpan>
     */
    public static function spans(array $timeOff, array $holidays, \DateTimeZone $tz): array
    {
        $spans = array_map(
            static fn (array $u): UnavailableSpan => new UnavailableSpan(new Interval($u['start'], $u['end']), UnavailableSpan::TIME_OFF, $u['reason']),
            $timeOff,
        );
        foreach ($holidays as $holiday) {
            $start = Time::localMidnight($holiday['date'], $tz);
            $spans[] = new UnavailableSpan(new Interval($start, $start->modify('+1 day')), UnavailableSpan::HOLIDAY, $holiday['name']);
        }
        return $spans;
    }
}
```

`backend/src/Scheduling/ShiftService.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Scheduling;

use Planning\Auth\Principal;
use Planning\Domain\Conflict;
use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Repo\DirectoryRepository;
use Planning\Repo\Outbox;
use Planning\Repo\ProfileRepository;
use Planning\Repo\RoleRepository;
use Planning\Repo\ShiftRecord;
use Planning\Repo\ShiftRepository;
use Planning\Support\Clock;
use Planning\Support\Uuid;

/** FR-SHF-*, BR-01/02/11. Managers are warned about conflicts, never blocked (FR-SHF-09). */
final class ShiftService
{
    public const MAX_DURATION_SECONDS = 7 * 86400;
    public const UNDO_SECONDS = 30;

    private const NOTIFY_FIELDS = ['employeeRef' => 'employee', 'roleId' => 'role', 'start' => 'start', 'end' => 'end', 'breakMinutes' => 'break', 'percent' => 'allocation', 'note' => 'note'];

    public function __construct(
        private readonly ShiftRepository $shifts,
        private readonly ProfileRepository $profiles,
        private readonly RoleRepository $roles,
        private readonly DirectoryRepository $directory,
        private readonly ConflictContext $context,
        private readonly Outbox $outbox,
        private readonly Clock $clock,
    ) {
    }

    /**
     * @param array<string, mixed> $body
     * @return array{shift: ShiftRecord, conflicts: list<Conflict>}
     */
    public function create(array $body, Principal $by): array
    {
        $in = new Input($body);
        $employeeRef = $in->string('employee_ref', 64);
        $this->validateEmployee($in, $employeeRef);
        $roleId = $in->has('role_id') ? $in->string('role_id', 36) : null;
        if (!$in->has('role_id') && $employeeRef !== null) {
            $roleId = $this->profiles->find($employeeRef)['default_role_id']; // FR-SHF-01 AC2
        }
        $this->validateRole($in, $roleId);
        $start = $in->instant('start_at', true);
        $end = $in->instant('end_at', true);
        $break = (int) $in->int('break_minutes', 0, 1440, 0);
        $percent = (int) $in->int('allocated_percent', 1, 100, 100);
        $note = $in->string('note', 2000);
        $acknowledged = $in->bool('acknowledge_conflicts');
        self::validateTimes($in, $start, $end, $break);
        $in->check();

        $now = $this->clock->now();
        $shift = new ShiftRecord(Uuid::v4(), $employeeRef, $roleId, $start, $end, $break, $percent, $note, 'draft', null, null, null, 1, $by->actorId());
        [$shift, $conflicts] = $this->guardConflicts($shift, $acknowledged, $by, $now);
        $this->shifts->insert($shift, $now);
        return ['shift' => $shift, 'conflicts' => $conflicts];
    }

    /**
     * @param array<string, mixed> $body
     * @return array{shift: ShiftRecord, conflicts: list<Conflict>}
     */
    public function update(string $id, array $body, Principal $by): array
    {
        $current = $this->shifts->find($id) ?? throw HttpError::notFound('No shift with that id.');
        $in = new Input($body);
        $version = $in->int('version', 1, PHP_INT_MAX);
        if ($version === null) {
            $in->error('version', 'Send the version you last loaded, so edits made by someone else are not overwritten.');
        }
        $changes = [];
        if ($in->has('employee_ref')) {
            $changes['employeeRef'] = $in->string('employee_ref', 64);
            if ($changes['employeeRef'] !== $current->employeeRef) {
                $this->validateEmployee($in, $changes['employeeRef']);
            }
        }
        if ($in->has('role_id')) {
            $changes['roleId'] = $in->string('role_id', 36);
            if ($changes['roleId'] !== $current->roleId) {
                $this->validateRole($in, $changes['roleId']);
            }
        }
        foreach (['start_at' => 'start', 'end_at' => 'end'] as $key => $field) {
            if ($in->has($key) && ($value = $in->instant($key, true)) !== null) {
                $changes[$field] = $value;
            }
        }
        if ($in->has('break_minutes')) {
            $changes['breakMinutes'] = $in->int('break_minutes', 0, 1440, $current->breakMinutes);
        }
        if ($in->has('allocated_percent')) {
            $changes['percent'] = $in->int('allocated_percent', 1, 100, $current->percent);
        }
        if ($in->has('note')) {
            $changes['note'] = $in->string('note', 2000);
        }
        $acknowledged = $in->bool('acknowledge_conflicts');
        $next = $current->with($changes);
        self::validateTimes($in, $next->start, $next->end, $next->breakMinutes);
        $in->check();

        if ($version !== $current->version) {
            throw HttpError::conflict('STALE_SHIFT', 'Someone else changed this shift since you loaded it. Reload and try again.');
        }
        $now = $this->clock->now();
        [$next, $conflicts] = $this->guardConflicts($next, $acknowledged, $by, $now);
        if (!$this->shifts->update($next, $current->version, $now)) {
            throw HttpError::conflict('STALE_SHIFT', 'Someone else changed this shift since you loaded it. Reload and try again.');
        }
        $saved = $this->shifts->find($id) ?? throw HttpError::notFound('No shift with that id.');
        if ($current->isPublished()) {
            $this->notifyChange($current, $saved, $now); // BR-11: stays published; employees are told
        }
        return ['shift' => $saved, 'conflicts' => $conflicts];
    }

    /** @return array{0: ShiftRecord, 1: list<Conflict>} */
    private function guardConflicts(ShiftRecord $shift, bool $acknowledged, Principal $by, \DateTimeImmutable $now): array
    {
        $conflicts = $this->context->conflictsFor($shift);
        if ($conflicts === []) {
            return [$shift->with(['ackBy' => null, 'ackAt' => null]), []];
        }
        if (!$acknowledged) {
            throw HttpError::conflict(
                'SHIFT_CONFLICT',
                'This shift breaks a planning rule. Send acknowledge_conflicts: true to save it anyway.',
                ['conflicts' => array_map(static fn (Conflict $c): array => $c->toArray(), $conflicts)],
            );
        }
        return [$shift->with(['ackBy' => $by->actorId(), 'ackAt' => $now]), $conflicts];
    }

    private function notifyChange(ShiftRecord $before, ShiftRecord $after, \DateTimeImmutable $now): void
    {
        $changed = [];
        foreach (self::NOTIFY_FIELDS as $property => $label) {
            if ($before->{$property} != $after->{$property}) {
                $changed[] = $label;
            }
        }
        if ($changed === []) {
            return;
        }
        if ($before->employeeRef !== $after->employeeRef) {
            if ($before->employeeRef !== null) {
                $this->outbox->add('shift_unassigned', $before->employeeRef, $after->id, ['shift_id' => $after->id], $now, $now);
            }
            if ($after->employeeRef !== null) {
                $this->outbox->add('shift_assigned', $after->employeeRef, $after->id, ['shift_id' => $after->id], $now, $now);
            }
            return;
        }
        if ($after->employeeRef !== null) {
            $this->outbox->add('shift_changed', $after->employeeRef, $after->id, ['shift_id' => $after->id, 'changed' => $changed], $now, $now);
        }
    }

    private function validateEmployee(Input $in, ?string $employeeRef): void
    {
        // An empty directory means the roster could not be loaded yet; never block planning on that (NFR-06).
        if ($employeeRef !== null && !$this->directory->isEmpty() && $this->directory->find($employeeRef) === null) {
            $in->error('employee_ref', 'Not on the employee roster.');
        }
    }

    private function validateRole(Input $in, ?string $roleId): void
    {
        if ($roleId === null) {
            return;
        }
        $role = $this->roles->find($roleId);
        if ($role === null) {
            $in->error('role_id', 'Unknown role.');
        } elseif ($role['archived']) {
            $in->error('role_id', 'This role is archived.');
        }
    }

    private static function validateTimes(Input $in, ?\DateTimeImmutable $start, ?\DateTimeImmutable $end, int $breakMinutes): void
    {
        if ($start === null || $end === null) {
            return;
        }
        if ($end <= $start) {
            $in->error('end_at', 'The shift must end after it starts.');
            return;
        }
        $seconds = $end->getTimestamp() - $start->getTimestamp();
        if ($seconds > self::MAX_DURATION_SECONDS) {
            $in->error('end_at', 'A shift can last at most 7 days.');
        }
        if ($breakMinutes * 60 >= $seconds) {
            $in->error('break_minutes', 'The break must be shorter than the shift.');
        }
    }
}
```

- [ ] **Step 4: Implement the controller and wire everything**

`backend/src/Http/Controllers/ShiftController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Auth\Principal;
use Planning\Http\HttpError;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\ShiftRepository;
use Planning\Scheduling\ConflictContext;
use Planning\Scheduling\ShiftService;

final class ShiftController
{
    public function __construct(
        private readonly ShiftService $service,
        private readonly ShiftRepository $shifts,
        private readonly ConflictContext $context,
    ) {
    }

    /** @param array<string,string> $params */
    public function store(Request $request, array $params, ?Principal $me): Response
    {
        $result = $this->service->create($request->json(), self::actor($me));
        return Response::json(201, ['shift' => $result['shift']->toApi($result['conflicts'])]);
    }

    /** @param array<string,string> $params */
    public function show(Request $request, array $params): Response
    {
        $shift = $this->shifts->find($params['id']) ?? throw HttpError::notFound('No shift with that id.');
        return Response::json(200, ['shift' => $shift->toApi($this->context->conflictsFor($shift))]);
    }

    /** @param array<string,string> $params */
    public function update(Request $request, array $params, ?Principal $me): Response
    {
        $result = $this->service->update($params['id'], $request->json(), self::actor($me));
        return Response::json(200, ['shift' => $result['shift']->toApi($result['conflicts'])]);
    }

    private static function actor(?Principal $me): Principal
    {
        return $me ?? throw HttpError::unauthorized('Sign in through the InterlinkERP gateway first.');
    }
}
```

`App` getters (with matching `use` lines for `Planning\Repo\{ShiftRepository, Outbox}`, `Planning\Scheduling\{ConflictContext, ShiftService}`, `Planning\Http\Controllers\ShiftController`):

```php
    public function shifts(): ShiftRepository
    {
        return $this->once('shifts', fn () => new ShiftRepository($this->pdo(), $this->organisationId()));
    }

    public function outbox(): Outbox
    {
        return $this->once('outbox', fn () => new Outbox($this->pdo(), $this->organisationId()));
    }

    public function conflictContext(): ConflictContext
    {
        return $this->once('conflictContext', fn () => new ConflictContext($this->shifts(), $this->profiles(), $this->unavailability(), $this->holidays(), $this->settings()));
    }

    public function shiftService(): ShiftService
    {
        return $this->once('shiftService', fn () => new ShiftService(
            $this->shifts(), $this->profiles(), $this->roles(), $this->directory(), $this->conflictContext(), $this->outbox(), $this->clock(),
        ));
    }

    public function shiftController(): ShiftController
    {
        return $this->once('shiftController', fn () => new ShiftController($this->shiftService(), $this->shifts(), $this->conflictContext()));
    }
```

Routes:

```php
    $router->add('POST', '/api/shifts', Route::MANAGER, 'Create a draft shift, or duplicate an existing one.', $to('shiftController', 'store'), Doc::op(
        'Create Shift', 'Plan a block of work for an employee or as an open shift', ['Adding a shift to the schedule', 'Copying a shift with duplicate_of'], ['Moving an existing shift'],
        ['employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts', 'duplicate_of'],
        ['shift', 'shift.conflicts'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'POST /api/publications'],
        ['shift', 'schedule', 'plan', 'roster', 'rota', 'create'],
    ));
    $router->add('GET', '/api/shifts/{id}', Route::MANAGER, 'Read one shift with its current conflicts.', $to('shiftController', 'show'), Doc::op(
        'Read Shift', 'See one shift in detail', ['Opening a shift to edit it'], ['Listing a week of shifts'],
        ['id'], ['shift'], ['Planning Manager'], ['PATCH /api/shifts/{id}', 'GET /api/schedule'],
        ['shift', 'details'],
    ));
    $router->add('PATCH', '/api/shifts/{id}', Route::MANAGER, 'Move, resize, reassign or edit a shift.', $to('shiftController', 'update'), Doc::op(
        'Update Shift', 'Change a shift\'s time, employee, role or details', ['Dragging a shift to another day or person', 'Changing the note'], ['Creating a shift'],
        ['version', 'employee_ref', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_percent', 'note', 'acknowledge_conflicts'],
        ['shift'], ['Planning Manager', 'Latest version of the shift'], ['GET /api/shifts/{id}'],
        ['move', 'reassign', 'edit shift', 'resize'],
    ));
```

Append to `capabilities`:

```php
        [
            'name' => 'Plan Shifts',
            'icon' => '🗓️',
            'description' => 'Create and change shifts, with warnings when a shift breaks a planning rule.',
            'does' => ['Create a shift', 'Move or reassign a shift', 'Duplicate or delete a shift', 'Undo a deletion'],
            'best_for' => 'Managers building and adjusting the team schedule.',
            'endpoints' => ['POST /api/shifts', 'GET /api/shifts/{id}', 'PATCH /api/shifts/{id}'],
        ],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "ShiftsApiTest|OpenApiDocumentTest"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: create and edit shifts with conflict warnings and change notifications"
```

---

### Task 16: Delete with undo, and duplicate

**Files:**
- Modify: `backend/src/Scheduling/ShiftService.php` (`delete`, `restore`, `duplicate`; `create` hands `duplicate_of` to `duplicate`)
- Modify: `backend/src/Http/Controllers/ShiftController.php` (`destroy`, `restore`), `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Integration/Api/ShiftDeletionApiTest.php`

**Interfaces:**
- Consumes: Task 15.
- Produces:
  - `ShiftService->delete(string $id, Principal): void`, `->restore(string $id, Principal): ShiftRecord`.
  - `POST /api/shifts {duplicate_of, start_at?, acknowledge_conflicts?}` makes a copy. Without `start_at`, the copy is one day later.
  - `DELETE /api/shifts/{id}` returns 204.
  - `POST /api/shift-restorations {shift_id}` returns 201 `{shift}`, 404, or 409 `UNDO_EXPIRED`.
  - Deleting a published, assigned shift queues a `shift_deleted` notice with `deliver_after = now + 30s`. Restoring cancels it (FR-SHF-07 AC1, FR-NTF-02).

- [ ] **Step 1: Write the failing test**

`backend/tests/Integration/Api/ShiftDeletionApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Repo\Outbox;
use Planning\Tests\Support\ApiTestCase;

final class ShiftDeletionApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->addEmployee('E1', 'Ana Lim');
    }

    /** @return array<string,mixed> */
    private function shift(bool $published = false): array
    {
        [, $body] = $this->call('POST', '/api/shifts', ['employee_ref' => 'E1', 'start_at' => '2026-10-14T09:00:00+08:00', 'end_at' => '2026-10-14T17:00:00+08:00']);
        if ($published) {
            $this->pdo()->prepare("UPDATE shifts SET state = 'published' WHERE id = ?")->execute([$body['shift']['id']]);
        }
        return $body['shift'];
    }

    public function test_deleting_a_draft_hides_it_and_notifies_nobody(): void
    {
        $shift = $this->shift();
        $this->assertSame(204, $this->call('DELETE', "/api/shifts/{$shift['id']}")[0]);
        $this->assertSame(404, $this->call('GET', "/api/shifts/{$shift['id']}")[0]);
        $this->assertSame([], (new Outbox($this->pdo(), self::ORG))->all());
        $this->assertSame(404, $this->call('DELETE', "/api/shifts/{$shift['id']}")[0]);
    }

    public function test_undo_within_the_window_restores_and_cancels_the_notice(): void
    {
        $shift = $this->shift(true);
        $this->call('DELETE', "/api/shifts/{$shift['id']}");

        $pending = (new Outbox($this->pdo(), self::ORG))->all();
        $this->assertSame('shift_deleted', $pending[0]['kind']);
        $this->assertSame('2026-10-13T02:00:30Z', $pending[0]['deliver_after']);

        $this->clock->advance(10);
        [$status, $body] = $this->call('POST', '/api/shift-restorations', ['shift_id' => $shift['id']]);

        $this->assertSame(201, $status);
        $this->assertSame($shift['id'], $body['shift']['id']);
        $this->assertSame(200, $this->call('GET', "/api/shifts/{$shift['id']}")[0]);
        $this->assertTrue((new Outbox($this->pdo(), self::ORG))->all()[0]['cancelled']);
    }

    public function test_undo_after_the_window_is_refused(): void
    {
        $shift = $this->shift();
        $this->call('DELETE', "/api/shifts/{$shift['id']}");
        $this->clock->advance(31);

        [$status, $body] = $this->call('POST', '/api/shift-restorations', ['shift_id' => $shift['id']]);
        $this->assertSame(409, $status);
        $this->assertSame('UNDO_EXPIRED', $body['error']['code']);
    }

    public function test_restoring_a_shift_that_was_not_deleted_is_404(): void
    {
        $shift = $this->shift();
        $this->assertSame(404, $this->call('POST', '/api/shift-restorations', ['shift_id' => $shift['id']])[0]);
    }

    public function test_duplicate_goes_to_the_next_day_as_a_draft(): void
    {
        $shift = $this->shift(true);

        [$status, $body] = $this->call('POST', '/api/shifts', ['duplicate_of' => $shift['id']]);

        $this->assertSame(201, $status);
        $copy = $body['shift'];
        $this->assertNotSame($shift['id'], $copy['id']);
        $this->assertSame('draft', $copy['state']);
        $this->assertSame('E1', $copy['employee_ref']);
        $this->assertSame('2026-10-15T01:00:00Z', $copy['start_at']);
        $this->assertSame('2026-10-15T09:00:00Z', $copy['end_at']);
    }

    public function test_duplicate_on_top_of_the_original_warns(): void
    {
        $shift = $this->shift();

        [$status, $body] = $this->call('POST', '/api/shifts', ['duplicate_of' => $shift['id'], 'start_at' => '2026-10-14T10:00:00+08:00']);
        $this->assertSame(409, $status);
        $this->assertSame('SHIFT_CONFLICT', $body['error']['code']);

        [$status, $body] = $this->call('POST', '/api/shifts', ['duplicate_of' => $shift['id'], 'start_at' => '2026-10-14T10:00:00+08:00', 'acknowledge_conflicts' => true]);
        $this->assertSame(201, $status);
        $this->assertSame('2026-10-14T02:00:00Z', $body['shift']['start_at']);
        $this->assertSame('2026-10-14T10:00:00Z', $body['shift']['end_at']);
    }

    public function test_duplicating_a_missing_shift_is_404(): void
    {
        $this->assertSame(404, $this->call('POST', '/api/shifts', ['duplicate_of' => 'nope'])[0]);
    }
}
```

Run: `php vendor/bin/phpunit --filter ShiftDeletionApiTest`
Expected: FAIL.

- [ ] **Step 2: Add delete, restore and duplicate to the service**

In `ShiftService::create()`, add this as the first two lines after `$in = new Input($body);`:

```php
        if ($in->has('duplicate_of')) {
            return $this->duplicate($in, $by);
        }
```

Add these methods to `ShiftService` (and `use Planning\Support\Time;`):

```php
    public function delete(string $id, Principal $by): void
    {
        $shift = $this->shifts->find($id) ?? throw HttpError::notFound('No shift with that id.');
        $now = $this->clock->now();
        $this->shifts->softDelete($id, $by->actorId(), $now);
        if ($shift->isPublished() && $shift->employeeRef !== null) {
            // Sent only after the undo window, so an undone deletion never reaches the employee (FR-NTF-02).
            $this->outbox->add('shift_deleted', $shift->employeeRef, $shift->id, [
                'shift_id' => $shift->id, 'start_at' => Time::iso($shift->start), 'end_at' => Time::iso($shift->end),
            ], $now->modify('+' . self::UNDO_SECONDS . ' seconds'), $now);
        }
    }

    public function restore(string $id, Principal $by): ShiftRecord
    {
        $shift = $this->shifts->find($id, withDeleted: true);
        if ($shift === null || $shift->deletedAt === null) {
            throw HttpError::notFound('No deleted shift with that id.');
        }
        $now = $this->clock->now();
        if ($now->getTimestamp() - $shift->deletedAt->getTimestamp() > self::UNDO_SECONDS) {
            throw HttpError::conflict('UNDO_EXPIRED', 'This deletion can no longer be undone.');
        }
        $this->shifts->restore($id, $now);
        $this->outbox->cancelPending('shift_deleted', $id, $now);
        return $this->shifts->find($id) ?? throw new \LogicException('Restored shift is missing.');
    }

    /** @return array{shift: ShiftRecord, conflicts: list<Conflict>} */
    private function duplicate(Input $in, Principal $by): array
    {
        $sourceId = $in->string('duplicate_of', 36, true);
        $start = $in->instant('start_at');
        $acknowledged = $in->bool('acknowledge_conflicts');
        $in->check();

        $source = $this->shifts->find((string) $sourceId) ?? throw HttpError::notFound('No shift with that id.');
        $offset = $start === null ? 86400 : $start->getTimestamp() - $source->start->getTimestamp();
        $move = sprintf('%+d seconds', $offset);
        $now = $this->clock->now();
        $copy = $source->with([
            'id' => Uuid::v4(), 'start' => $source->start->modify($move), 'end' => $source->end->modify($move),
            'state' => 'draft', 'publishedAt' => null, 'version' => 1, 'createdBy' => $by->actorId(), 'deletedAt' => null,
        ]);
        [$copy, $conflicts] = $this->guardConflicts($copy, $acknowledged, $by, $now);
        $this->shifts->insert($copy, $now);
        return ['shift' => $copy, 'conflicts' => $conflicts];
    }
```

- [ ] **Step 3: Add the controller actions and routes**

In `ShiftController` (add `use Planning\Http\Input;`):

```php
    /** @param array<string,string> $params */
    public function destroy(Request $request, array $params, ?Principal $me): Response
    {
        $this->service->delete($params['id'], self::actor($me));
        return Response::noContent();
    }

    /** @param array<string,string> $params */
    public function restore(Request $request, array $params, ?Principal $me): Response
    {
        $in = new Input($request->json());
        $id = $in->string('shift_id', 36, true);
        $in->check();
        $shift = $this->service->restore((string) $id, self::actor($me));
        return Response::json(201, ['shift' => $shift->toApi($this->context->conflictsFor($shift))]);
    }
```

Routes:

```php
    $router->add('DELETE', '/api/shifts/{id}', Route::MANAGER, 'Delete a shift (can be undone for 30 seconds).', $to('shiftController', 'destroy'), Doc::op(
        'Delete Shift', 'Remove a shift from the schedule', ['A shift is no longer needed'], ['Giving a shift to someone else (reassign it instead)'],
        ['id'], [], ['Planning Manager'], ['POST /api/shift-restorations'],
        ['delete', 'remove shift', 'cancel shift'],
    ));
    $router->add('POST', '/api/shift-restorations', Route::MANAGER, 'Undo a shift deletion made in the last 30 seconds.', $to('shiftController', 'restore'), Doc::op(
        'Undo Shift Deletion', 'Bring back a shift that was just deleted', ['A shift was deleted by mistake'], ['Restoring a shift deleted long ago'],
        ['shift_id'], ['shift'], ['Planning Manager', 'Deleted less than 30 seconds ago'], ['DELETE /api/shifts/{id}'],
        ['undo', 'restore', 'undelete'],
    ));
```

Add `'DELETE /api/shifts/{id}', 'POST /api/shift-restorations'` to the "Plan Shifts" capability's `endpoints`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "ShiftDeletionApiTest|ShiftsApiTest|OpenApiDocumentTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: delete shifts with undo and duplicate shifts"
```

---

### Task 17: The schedule read model

**Files:**
- Create: `backend/src/Scheduling/ScheduleService.php`, `backend/src/Http/Controllers/ScheduleController.php`
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Integration/Api/ScheduleApiTest.php`

**Interfaces:**
- Consumes: everything from Tasks 7–16.
- Produces:
  - `ScheduleService(ShiftRepository, ProfileRepository, RoleRepository, DirectoryRepository, DirectoryRefresher, UnavailabilityRepository, HolidayRepository, SettingsRepository, Clock)`, `MAX_DAYS = 62`, `->build(string $fromDate, string $toDate): array`.
  - `GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` (manager). Dates are inclusive and in the organisation's time zone. The response is:

```json
{
  "period": {"from": "2026-10-12", "to": "2026-10-18", "timezone": "Asia/Kuala_Lumpur", "from_at": "2026-10-11T16:00:00Z", "to_at": "2026-10-18T16:00:00Z"},
  "directory_stale": false,
  "roles": [{"id": "", "name": "", "color": "", "archived": false}],
  "employees": [{
    "employee_ref": "E1", "name": "Ana Lim", "photo_url": null, "department_id": null, "department_name": null,
    "status": "Active", "on_roster": true, "role_ids": [], "default_role_id": null, "timezone": "Asia/Kuala_Lumpur",
    "flexible": false, "allocated_hours": 8.0, "available_hours": 40.0, "over_allocated_days": [],
    "working_intervals": [{"start_at": "", "end_at": ""}],
    "unavailable": [{"start_at": "", "end_at": "", "kind": "time_off|holiday", "label": ""}]
  }],
  "shifts": ["<shift JSON from Task 15, including open shifts>"]
}
```

How the response is built:
- **Employee rows:** every directory employee, plus anyone who has a visible shift but is no longer in the directory. Those rows show as "Unknown employee" with `on_roster: false`.
- **Rows are sorted** by name.
- **Conflicts** for each shift use a window 7 days wider on each side, so overlaps with shifts just outside the period are still found.
- **`allocated_hours`, `available_hours` and `over_allocated_days`** cover only the period's local days, in the employee's time zone.

- [ ] **Step 1: Write the failing test**

`backend/tests/Integration/Api/ScheduleApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Tests\Support\ApiTestCase;

final class ScheduleApiTest extends ApiTestCase
{
    private const WEEK = ['from' => '2026-10-12', 'to' => '2026-10-18'];

    /** @return array<string,mixed> */
    private function week(): array
    {
        [$status, $body] = $this->call('GET', '/api/schedule', null, self::WEEK);
        $this->assertSame(200, $status, json_encode($body));
        return $body;
    }

    /** @return array<string,mixed> */
    private static function row(array $schedule, string $ref): array
    {
        foreach ($schedule['employees'] as $employee) {
            if ($employee['employee_ref'] === $ref) {
                return $employee;
            }
        }
        self::fail("No row for $ref");
    }

    private function shift(?string $ref, string $start, string $end, bool $ack = false): void
    {
        [$status, $body] = $this->call('POST', '/api/shifts', ['employee_ref' => $ref, 'start_at' => $start, 'end_at' => $end, 'acknowledge_conflicts' => $ack]);
        $this->assertSame(201, $status, json_encode($body));
    }

    public function test_every_employee_gets_a_row_and_open_shifts_are_included(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $this->addEmployee('E2', 'Bo Tan');
        $this->shift(null, '2026-10-14T09:00:00+08:00', '2026-10-14T13:00:00+08:00');

        $schedule = $this->week();

        $this->assertSame(['Ana Lim', 'Bo Tan'], array_column($schedule['employees'], 'name'));
        $this->assertSame([null], array_column($schedule['shifts'], 'employee_ref'));
        $this->assertSame(['from' => '2026-10-12', 'to' => '2026-10-18', 'timezone' => 'Asia/Kuala_Lumpur', 'from_at' => '2026-10-11T16:00:00Z', 'to_at' => '2026-10-18T16:00:00Z'], $schedule['period']);
    }

    public function test_hours_markers_and_conflicts(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $day = [['09:00', '13:00'], ['14:00', '18:00']];
        $this->call('PATCH', '/api/employees/E1', ['working_hours' => ['mon' => $day, 'tue' => $day, 'wed' => $day, 'thu' => $day, 'fri' => $day]]);
        $this->call('POST', '/api/unavailabilities', ['employee_ref' => 'E1', 'start_at' => '2026-10-16T00:00:00+08:00', 'end_at' => '2026-10-17T00:00:00+08:00', 'reason' => 'Annual leave']);
        $this->call('POST', '/api/holidays', ['date' => '2026-10-15', 'name' => 'Company Day']);
        $this->shift('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
        $this->shift('E1', '2026-10-17T09:00:00+08:00', '2026-10-17T13:00:00+08:00'); // Saturday: outside working hours, not a conflict (BR-03)
        $this->shift('E1', '2026-10-16T09:00:00+08:00', '2026-10-16T12:00:00+08:00', true);

        $schedule = $this->week();
        $row = self::row($schedule, 'E1');

        $this->assertFalse($row['flexible']);
        $this->assertSame(15.0, (float) $row['allocated_hours']);
        $this->assertSame(24.0, (float) $row['available_hours'], '40h minus Thursday holiday and Friday leave');
        $this->assertSame(['2026-10-16', '2026-10-17'], $row['over_allocated_days']);
        $this->assertCount(10, $row['working_intervals']);
        $this->assertEqualsCanonicalizing(['holiday', 'time_off'], array_column($row['unavailable'], 'kind'));

        $byStart = array_column($schedule['shifts'], null, 'start_at');
        $this->assertSame([], $byStart['2026-10-17T01:00:00Z']['conflicts']);
        $this->assertSame('unavailable', $byStart['2026-10-16T01:00:00Z']['conflicts'][0]['rule']);
        $this->assertTrue($byStart['2026-10-16T01:00:00Z']['conflict_acknowledged']);
    }

    public function test_flexible_employees_have_no_available_hours(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $row = self::row($this->week(), 'E1');
        $this->assertTrue($row['flexible']);
        $this->assertNull($row['available_hours']);
        $this->assertSame([], $row['over_allocated_days']);
    }

    public function test_someone_who_left_the_roster_keeps_their_shifts_visible(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $this->shift('E1', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');
        $this->pdo()->exec("DELETE FROM employee_directory WHERE employee_ref = 'E1'");
        $this->addEmployee('E2', 'Bo Tan');

        $row = self::row($this->week(), 'E1');

        $this->assertSame('Unknown employee', $row['name']);
        $this->assertFalse($row['on_roster']);
    }

    public function test_schedule_loads_while_the_roster_is_down(): void
    {
        $this->roster->down = true;
        $this->shift('E9', '2026-10-14T09:00:00+08:00', '2026-10-14T17:00:00+08:00');

        $schedule = $this->week();

        $this->assertTrue($schedule['directory_stale']);
        $this->assertSame(['E9'], array_column($schedule['employees'], 'employee_ref'));
    }

    public function test_conflict_with_a_shift_just_outside_the_period_is_found(): void
    {
        $this->addEmployee('E1', 'Ana Lim');
        $this->shift('E1', '2026-10-18T20:00:00+08:00', '2026-10-19T04:00:00+08:00');
        $this->shift('E1', '2026-10-19T00:00:00+08:00', '2026-10-19T08:00:00+08:00', true);

        $this->assertSame('overlap', $this->week()['shifts'][0]['conflicts'][0]['rule']);
    }

    public function test_range_validation_and_access(): void
    {
        $this->assertSame(422, $this->call('GET', '/api/schedule', null, ['from' => '2026-10-12'])[0]);
        $this->assertSame(422, $this->call('GET', '/api/schedule', null, ['from' => '2026-01-01', 'to' => '2026-12-31'])[0]);
        $this->asEmployee('E1');
        $this->assertSame(403, $this->call('GET', '/api/schedule', null, self::WEEK)[0]);
    }
}
```

Run: `php vendor/bin/phpunit --filter ScheduleApiTest`
Expected: FAIL (404s).

A note on `test_hours_markers_and_conflicts`:
- Allocated hours: Wednesday 8 + Friday 3 + Saturday 4 = 15.
- Available hours: 40 − 8 (Thursday holiday) − 8 (Friday leave) = 24.
- Over-allocated days: Friday (3 > 0) and Saturday (4 > 0).
- Wednesday's 8-hour shift with no break counts as 8 hours, which is exactly what is available, so Wednesday is not over-allocated.

- [ ] **Step 2: Implement the service and controller**

`backend/src/Scheduling/ScheduleService.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Scheduling;

use Planning\Domain\Allocation;
use Planning\Domain\ConflictDetector;
use Planning\Domain\Interval;
use Planning\Domain\UnavailableSpan;
use Planning\Domain\WorkingHours;
use Planning\Repo\DirectoryRepository;
use Planning\Repo\HolidayRepository;
use Planning\Repo\ProfileRepository;
use Planning\Repo\RoleRepository;
use Planning\Repo\SettingsRepository;
use Planning\Repo\ShiftRecord;
use Planning\Repo\ShiftRepository;
use Planning\Repo\UnavailabilityRepository;
use Planning\Roster\DirectoryRefresher;
use Planning\Support\Clock;
use Planning\Support\Time;

/**
 * Everything the schedule screen needs in one response (FR-SCH-01..09), using
 * a fixed number of queries however many employees there are (NFR-01).
 */
final class ScheduleService
{
    public const MAX_DAYS = 62;
    private const CONTEXT_MARGIN = 7 * 86400; // longest possible shift (ShiftService::MAX_DURATION_SECONDS)

    public function __construct(
        private readonly ShiftRepository $shifts,
        private readonly ProfileRepository $profiles,
        private readonly RoleRepository $roles,
        private readonly DirectoryRepository $directory,
        private readonly DirectoryRefresher $refresher,
        private readonly UnavailabilityRepository $unavailability,
        private readonly HolidayRepository $holidays,
        private readonly SettingsRepository $settings,
        private readonly Clock $clock,
    ) {
    }

    /** @return array<string, mixed> */
    public function build(string $fromDate, string $toDate): array
    {
        $orgTz = $this->settings->timezone();
        $from = Time::localMidnight($fromDate, $orgTz);
        $to = Time::localMidnight($toDate, $orgTz)->modify('+1 day');
        $period = new Interval($from, $to);
        $wideFrom = $from->modify('-' . self::CONTEXT_MARGIN . ' seconds');
        $wideTo = $to->modify('+' . self::CONTEXT_MARGIN . ' seconds');

        $this->refresher->refreshIfEmpty();
        $directory = [];
        foreach ($this->directory->all() as $row) {
            $directory[$row['employee_ref']] = $row;
        }
        $profiles = $this->profiles->all();
        $allShifts = $this->shifts->overlapping($wideFrom, $wideTo);
        $visible = array_values(array_filter($allShifts, static fn (ShiftRecord $s): bool => $s->start < $to && $s->end > $from));

        $byEmployee = [];
        foreach ($allShifts as $shift) {
            if ($shift->employeeRef !== null) {
                $byEmployee[$shift->employeeRef][] = $shift;
            }
        }
        $timeOff = [];
        foreach ($this->unavailability->between($wideFrom, $wideTo) as $record) {
            $timeOff[$record['employee_ref']][] = $record;
        }
        $holidays = $this->holidays->visibleBetween($wideFrom->setTimezone($orgTz)->format('Y-m-d'), $wideTo->setTimezone($orgTz)->format('Y-m-d'));

        $refs = array_keys($directory);
        foreach ($visible as $shift) {
            if ($shift->employeeRef !== null) {
                $refs[] = $shift->employeeRef;
            }
        }

        $conflicts = [];
        $employees = [];
        foreach (array_values(array_unique(array_map('strval', $refs))) as $ref) {
            $profile = $profiles[$ref] ?? ProfileRepository::blank($ref);
            $tz = new \DateTimeZone($profile['timezone'] ?? $orgTz->getName());
            $mine = $byEmployee[$ref] ?? [];
            $facts = array_map(static fn (ShiftRecord $s) => $s->facts(), $mine);
            $spans = ConflictContext::spans($timeOff[$ref] ?? [], $holidays, $tz);
            $conflicts += ConflictDetector::forEmployee($facts, $spans, $profile['role_ids']);

            $hours = $profile['working_hours'] === null ? null : WorkingHours::fromArray($profile['working_hours']);
            $working = $hours?->intervalsBetween($from, $to, $tz) ?? [];
            $periodSpans = array_values(array_filter($spans, static fn (UnavailableSpan $u): bool => $u->interval->overlaps($period)));
            $available = $hours === null ? null : Allocation::availableByDay($working, array_map(static fn (UnavailableSpan $u): Interval => $u->interval, $periodSpans), $tz);
            $allocated = self::daysWithin(Allocation::allocatedByDay($facts, $tz), $from, $to, $tz);
            $d = $directory[$ref] ?? null;

            $employees[] = [
                'employee_ref' => $ref,
                'name' => $d['display_name'] ?? 'Unknown employee',
                'photo_url' => $d['photo_url'] ?? null,
                'department_id' => $d['department_id'] ?? null,
                'department_name' => $d['department_name'] ?? null,
                'status' => $d['status'] ?? 'unknown',
                'on_roster' => $d !== null,
                'role_ids' => $profile['role_ids'],
                'default_role_id' => $profile['default_role_id'],
                'timezone' => $tz->getName(),
                'flexible' => $hours === null,
                'allocated_hours' => round(array_sum($allocated), 2),
                'available_hours' => $available === null ? null : round(array_sum($available), 2),
                'over_allocated_days' => Allocation::overAllocatedDays($allocated, $available),
                'working_intervals' => array_map(static fn (Interval $i): array => ['start_at' => Time::iso($i->start), 'end_at' => Time::iso($i->end)], $working),
                'unavailable' => array_map(static fn (UnavailableSpan $u): array => [
                    'start_at' => Time::iso($u->interval->start), 'end_at' => Time::iso($u->interval->end), 'kind' => $u->kind, 'label' => $u->label,
                ], $periodSpans),
            ];
        }
        usort($employees, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']) ?: strcmp($a['employee_ref'], $b['employee_ref']));

        $lastFetched = $this->directory->lastFetchedAt();
        return [
            'period' => ['from' => $fromDate, 'to' => $toDate, 'timezone' => $orgTz->getName(), 'from_at' => Time::iso($from), 'to_at' => Time::iso($to)],
            'directory_stale' => $lastFetched === null || $this->clock->now()->getTimestamp() - $lastFetched->getTimestamp() > DirectoryRefresher::MAX_AGE_SECONDS,
            'roles' => $this->roles->all(),
            'employees' => $employees,
            'shifts' => array_map(static fn (ShiftRecord $s): array => $s->toApi($conflicts[$s->id] ?? []), $visible),
        ];
    }

    /**
     * @param array<string, float> $byDay
     * @return array<string, float> only the local dates inside [from, to)
     */
    private static function daysWithin(array $byDay, \DateTimeImmutable $from, \DateTimeImmutable $to, \DateTimeZone $tz): array
    {
        $first = $from->setTimezone($tz)->format('Y-m-d');
        $end = $to->setTimezone($tz)->format('Y-m-d');
        return array_filter($byDay, static fn (string $date): bool => $date >= $first && $date < $end, ARRAY_FILTER_USE_KEY);
    }
}
```

`backend/src/Http/Controllers/ScheduleController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Scheduling\ScheduleService;

final class ScheduleController
{
    public function __construct(private readonly ScheduleService $schedule)
    {
    }

    public function show(Request $request): Response
    {
        $in = new Input($request->query);
        $range = $in->dateRange('from', 'to', ScheduleService::MAX_DAYS);
        $in->check();
        return Response::json(200, $this->schedule->build($range[0], $range[1]));
    }
}
```

- [ ] **Step 3: Wire it**

```php
    public function scheduleService(): ScheduleService
    {
        return $this->once('scheduleService', fn () => new ScheduleService(
            $this->shifts(), $this->profiles(), $this->roles(), $this->directory(), $this->directoryRefresher(),
            $this->unavailability(), $this->holidays(), $this->settings(), $this->clock(),
        ));
    }

    public function scheduleController(): ScheduleController
    {
        return $this->once('scheduleController', fn () => new ScheduleController($this->scheduleService()));
    }
```

Route:

```php
    $router->add('GET', '/api/schedule', Route::MANAGER, 'Read the schedule for a date range: employees, hours, time off and shifts with conflicts.', $to('scheduleController', 'show'), Doc::op(
        'Read Schedule', 'See who is planned when, and where the problems are', ['Showing the planning board', 'Checking a week before publishing'], ['Reading one employee\'s own published shifts'],
        ['from', 'to'], ['period', 'employees[]', 'shifts[]', 'roles[]'], ['Planning Manager'], ['POST /api/shifts', 'POST /api/publications'],
        ['schedule', 'roster', 'rota', 'planning board', 'gantt', 'calendar'],
    ));
```

Add `'GET /api/schedule'` to the "Plan Shifts" capability's endpoints, and `'See the schedule for a week or month'` to its `does` list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `php vendor/bin/phpunit --filter "ScheduleApiTest|OpenApiDocumentTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: serve the schedule with hours, time off and conflicts"
```

---

### Task 18: Publishing and My Planning data

**Files:**
- Create: `backend/src/Scheduling/PublishService.php`
- Create: `backend/src/Http/Controllers/PublicationController.php`, `backend/src/Http/Controllers/MyShiftController.php`
- Modify: `backend/src/App.php`, `backend/src/routes.php`, `backend/src/catalog.php`
- Test: `backend/tests/Integration/Api/PublishingApiTest.php`

**Interfaces:**
- Consumes: `ShiftRepository::publish`, `publishedForEmployee`, `Outbox`, `ProfileRepository`, `SettingsRepository`, `RoleRepository`.
- Produces:
  - `PublishService(ShiftRepository, Outbox, Clock)`, `->publish(array $body): array{published: int, employees_notified: int}`.
  - `POST /api/publications {shift_ids: [...]}` (manager) returns 201 `{published, employees_notified}`. It writes one `schedule_published` outbox row per employee, with `payload.shift_ids`.
  - `GET /api/my/shifts?from=&to=` (person) returns `{timezone, from, to, roles, shifts: [toMyApi]}`. It returns 403 `NOT_ON_ROSTER` when the signed-in person has no `employee_ref`.

- [ ] **Step 1: Write the failing test**

`backend/tests/Integration/Api/PublishingApiTest.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Tests\Integration\Api;

use Planning\Repo\Outbox;
use Planning\Tests\Support\ApiTestCase;

final class PublishingApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->addEmployee('E1', 'Ana Lim');
        $this->addEmployee('E2', 'Bo Tan');
    }

    private function shift(?string $ref, string $day, string $from = '09:00', string $to = '17:00'): string
    {
        [$status, $body] = $this->call('POST', '/api/shifts', ['employee_ref' => $ref, 'start_at' => "{$day}T{$from}:00+08:00", 'end_at' => "{$day}T{$to}:00+08:00"]);
        $this->assertSame(201, $status, json_encode($body));
        return $body['shift']['id'];
    }

    public function test_publishing_notifies_each_employee_once(): void
    {
        $ids = [
            $this->shift('E1', '2026-10-14'), $this->shift('E1', '2026-10-15'),
            $this->shift('E2', '2026-10-14'), $this->shift(null, '2026-10-16'),
        ];

        [$status, $body] = $this->call('POST', '/api/publications', ['shift_ids' => $ids]);

        $this->assertSame(201, $status);
        $this->assertSame(['published' => 4, 'employees_notified' => 2], $body);
        $rows = (new Outbox($this->pdo(), self::ORG))->all();
        $this->assertEqualsCanonicalizing(['E1', 'E2'], array_column($rows, 'employee_ref'));
        $e1 = array_values(array_filter($rows, static fn (array $r): bool => $r['employee_ref'] === 'E1'))[0];
        $this->assertSame([$ids[0], $ids[1]], $e1['payload']['shift_ids']);
        $this->assertSame('published', $this->call('GET', "/api/shifts/{$ids[0]}")[1]['shift']['state']);

        $this->assertSame(['published' => 0, 'employees_notified' => 0], $this->call('POST', '/api/publications', ['shift_ids' => $ids])[1], 'already published');
    }

    public function test_publish_needs_a_list(): void
    {
        $this->assertSame(422, $this->call('POST', '/api/publications', ['shift_ids' => []])[0]);
        $this->assertSame(422, $this->call('POST', '/api/publications', [])[0]);
    }

    public function test_my_shifts_shows_only_my_published_shifts(): void
    {
        $mine = $this->shift('E1', '2026-10-14');
        $draft = $this->shift('E1', '2026-10-15');
        $theirs = $this->shift('E2', '2026-10-14');
        $deleted = $this->shift('E1', '2026-10-16');
        $this->call('POST', '/api/publications', ['shift_ids' => [$mine, $theirs, $deleted]]);
        $this->call('DELETE', "/api/shifts/$deleted");

        $this->asEmployee('E1');
        [$status, $body] = $this->call('GET', '/api/my/shifts', null, ['from' => '2026-10-12', 'to' => '2026-10-18']);

        $this->assertSame(200, $status);
        $this->assertSame([$mine], array_column($body['shifts'], 'id'));
        $this->assertSame('Asia/Kuala_Lumpur', $body['timezone']);
        $this->assertSame(['id', 'role_id', 'start_at', 'end_at', 'break_minutes', 'allocated_hours', 'note'], array_keys($body['shifts'][0]));
        $this->assertNotContains($draft, array_column($body['shifts'], 'id'));
    }

    public function test_people_not_on_the_roster_have_no_planning(): void
    {
        $this->asEmployee(null, 'visitor@example.com');
        [$status, $body] = $this->call('GET', '/api/my/shifts', null, ['from' => '2026-10-12', 'to' => '2026-10-18']);
        $this->assertSame(403, $status);
        $this->assertSame('NOT_ON_ROSTER', $body['error']['code']);
    }

    public function test_employees_cannot_publish(): void
    {
        $this->asEmployee('E1');
        $this->assertSame(403, $this->call('POST', '/api/publications', ['shift_ids' => ['x']])[0]);
    }
}
```

Run: `php vendor/bin/phpunit --filter PublishingApiTest`
Expected: FAIL.

- [ ] **Step 2: Implement publishing and My Planning**

`backend/src/Scheduling/PublishService.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Scheduling;

use Planning\Http\Input;
use Planning\Repo\Outbox;
use Planning\Repo\ShiftRepository;
use Planning\Support\Clock;

/** FR-PUB-01, FR-NTF-01 (delivery in M2) */
final class PublishService
{
    public function __construct(private readonly ShiftRepository $shifts, private readonly Outbox $outbox, private readonly Clock $clock)
    {
    }

    /**
     * @param array<string, mixed> $body
     * @return array{published: int, employees_notified: int}
     */
    public function publish(array $body): array
    {
        $in = new Input($body);
        $ids = $in->stringList('shift_ids', 1000, true);
        if ($ids === []) {
            $in->error('shift_ids', 'List at least one shift.');
        }
        $in->check();

        $now = $this->clock->now();
        $published = $this->shifts->publish((array) $ids, $now);
        $byEmployee = [];
        foreach ($published as $shift) {
            if ($shift->employeeRef !== null) {
                $byEmployee[$shift->employeeRef][] = $shift->id;
            }
        }
        foreach ($byEmployee as $ref => $shiftIds) {
            $this->outbox->add('schedule_published', (string) $ref, null, ['shift_ids' => $shiftIds], $now, $now);
        }
        return ['published' => count($published), 'employees_notified' => count($byEmployee)];
    }
}
```

`backend/src/Http/Controllers/PublicationController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Scheduling\PublishService;

final class PublicationController
{
    public function __construct(private readonly PublishService $publisher)
    {
    }

    public function store(Request $request): Response
    {
        return Response::json(201, $this->publisher->publish($request->json()));
    }
}
```

`backend/src/Http/Controllers/MyShiftController.php`:

```php
<?php

declare(strict_types=1);

namespace Planning\Http\Controllers;

use Planning\Auth\Principal;
use Planning\Http\HttpError;
use Planning\Http\Input;
use Planning\Http\Request;
use Planning\Http\Response;
use Planning\Repo\ProfileRepository;
use Planning\Repo\RoleRepository;
use Planning\Repo\SettingsRepository;
use Planning\Repo\ShiftRecord;
use Planning\Repo\ShiftRepository;
use Planning\Scheduling\ScheduleService;
use Planning\Support\Time;

/** FR-MYP-01, FR-PUB-02: published shifts only, the signed-in employee's only. */
final class MyShiftController
{
    public function __construct(
        private readonly ShiftRepository $shifts,
        private readonly ProfileRepository $profiles,
        private readonly SettingsRepository $settings,
        private readonly RoleRepository $roles,
    ) {
    }

    /** @param array<string,string> $params */
    public function index(Request $request, array $params, ?Principal $me): Response
    {
        if ($me === null || $me->employeeRef === null) {
            throw HttpError::forbidden('You are not on the planning roster.', 'NOT_ON_ROSTER');
        }
        $in = new Input($request->query);
        $range = $in->dateRange('from', 'to', ScheduleService::MAX_DAYS);
        $in->check();

        $tz = new \DateTimeZone($this->profiles->find($me->employeeRef)['timezone'] ?? $this->settings->get()['timezone']);
        $shifts = $this->shifts->publishedForEmployee($me->employeeRef, Time::localMidnight($range[0], $tz), Time::localMidnight($range[1], $tz)->modify('+1 day'));
        return Response::json(200, [
            'timezone' => $tz->getName(),
            'from' => $range[0],
            'to' => $range[1],
            'roles' => $this->roles->all(),
            'shifts' => array_map(static fn (ShiftRecord $s): array => $s->toMyApi(), $shifts),
        ]);
    }
}
```

- [ ] **Step 3: Wire it**

```php
    public function publishService(): PublishService
    {
        return $this->once('publishService', fn () => new PublishService($this->shifts(), $this->outbox(), $this->clock()));
    }

    public function publicationController(): PublicationController
    {
        return $this->once('publicationController', fn () => new PublicationController($this->publishService()));
    }

    public function myShiftController(): MyShiftController
    {
        return $this->once('myShiftController', fn () => new MyShiftController($this->shifts(), $this->profiles(), $this->settings(), $this->roles()));
    }
```

Routes:

```php
    $router->add('POST', '/api/publications', Route::MANAGER, 'Publish draft shifts and notify the employees concerned.', $to('publicationController', 'store'), Doc::op(
        'Publish Shifts', 'Make draft shifts visible to employees and tell them', ['A week\'s plan is ready to share'], ['Changing a shift that is already published'],
        ['shift_ids'], ['published', 'employees_notified'], ['Planning Manager'], ['GET /api/schedule', 'GET /api/my/shifts'],
        ['publish', 'send schedule', 'release', 'notify'],
    ));
    $router->add('GET', '/api/my/shifts', Route::PERSON, 'List the signed-in employee\'s published shifts.', $to('myShiftController', 'index'), Doc::op(
        'My Shifts', 'See my own published schedule', ['An employee checks when they work'], ['A manager reviewing the whole team'],
        ['from', 'to'], ['timezone', 'shifts[]', 'roles[]'], ['Signed-in person on the roster'], ['GET /api/me'],
        ['my schedule', 'my shifts', 'when do I work', 'my roster'],
    ));
```

Append to `capabilities`:

```php
        [
            'name' => 'Share Schedules',
            'icon' => '📣',
            'description' => 'Publish planned shifts and let employees see their own.',
            'does' => ['Publish a week of shifts', 'See my own shifts'],
            'best_for' => 'Getting the plan from the manager to the team.',
            'endpoints' => ['POST /api/publications', 'GET /api/my/shifts'],
        ],
```

- [ ] **Step 4: Run the whole backend suite**

Run: `php vendor/bin/phpunit`
Expected: PASS, both suites, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat: publish shifts and serve employees their own published schedule"
```

---

### Task 19: Frontend scaffold, API client and screen routing

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `scripts/rename-shell.mjs`
- Create: `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/api.ts`, `frontend/src/types.ts`, `frontend/src/router.ts`, `frontend/src/dom.ts`, `frontend/src/toast.ts`, `frontend/src/styles.css`
- Create (stubs, replaced in Tasks 20, 22, 23): `frontend/src/schedule/scheduleView.ts`, `frontend/src/my/myPlanning.ts`, `frontend/src/settings/settingsView.ts`
- Test: `frontend/src/api.test.ts`, `frontend/src/router.test.ts`

**Interfaces:**
- Consumes: `GET /api/me` (Tasks 6, 12).
- Produces:
  - `api<T>(method: string, path: string, body?: unknown, fetchImpl?: typeof fetch): Promise<T>`. Non-2xx responses throw `ApiError {status, code, message, details, correlationId}`. A 401 calls the unauthorized handler, which by default reloads the page so the page gate sends the browser to sign-in (Review Focus 5).
  - `setUnauthorizedHandler(fn)`, `query(params: Record<string, string | undefined>): string`.
  - `esc(value): string`, `confirmDialog(title, lines, confirmLabel): Promise<boolean>`, `toast(message, action?, ms?)`.
  - `landingPath(me): string` and `resolve(path, me): Screen`, where `Screen` is one of `schedule`, `my`, `settings` (with a `tab`), `not-on-roster` or `forbidden`.
  - View entry points: `renderSchedule(root: HTMLElement, me: Me)`, `renderMyPlanning(root: HTMLElement, me: Me)`, `renderSettings(root: HTMLElement, tab: string, me: Me)`.
  - All shared TypeScript types live in `types.ts`.

FR-ACC-02: employees land on My Planning, and managers land on Schedule. The app has no sign-out button, because sign-out happens only at the gateway (auth guide §5).

- [ ] **Step 1: Add the toolchain**

`package.json`:

```json
{
  "name": "interlinkerp-planning",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build && node scripts/rename-shell.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "jsdom": "^25.0.1",
    "typescript": "^5.7.3",
    "vite": "^6.1.0",
    "vitest": "^3.0.5"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["frontend/src"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'frontend',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The PHP dev server (php -S 127.0.0.1:8000 router.php) answers /api with the local dev identity.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
```

`scripts/rename-shell.mjs`:

```js
// The page gate (api/app.php) serves the shell after sign-in. If Vercel could
// serve dist/index.html directly as a static file, it would skip the gate.
import { renameSync } from 'node:fs';

renameSync('dist/index.html', 'dist/app-shell.html');
```

Then run:

```bash
npm install
```

- [ ] **Step 2: Add the page, shared types and small DOM helpers**

`frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Planning · InterlinkERP</title>
  </head>
  <body>
    <div id="app"></div>
    <div id="toasts" class="toasts" aria-live="polite"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`frontend/src/types.ts`:

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

`frontend/src/dom.ts`:

```ts
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape any value for use in HTML text or a quoted attribute. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** A modal yes/no question. Resolves true only when the confirm button is used. */
export function confirmDialog(title: string, lines: string[], confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      <menu class="actions"><button value="cancel">Cancel</button><button value="ok" class="primary">${esc(confirmLabel)}</button></menu>
    </form>`;
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
```

`frontend/src/toast.ts`:

```ts
import { esc } from './dom';

export interface ToastAction { label: string; run: () => void | Promise<void> }

export function toast(message: string, action?: ToastAction, ms = 10_000): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.setAttribute('role', 'status');
  node.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      node.remove();
      void action.run();
    });
    node.append(button);
  }
  host.append(node);
  window.setTimeout(() => node.remove(), ms);
}
```

- [ ] **Step 3: Write the failing tests**

`frontend/src/api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, query, setUnauthorizedHandler } from './api';

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const envelope = (code: string) => ({ error: { code, message: 'Nope.', correlation_id: 'cid-1', details: { conflicts: [] } } });

describe('api', () => {
  it('returns parsed JSON', async () => {
    expect(await api('GET', '/api/me', undefined, respond(200, { a: 1 }))).toEqual({ a: 1 });
  });

  it('returns undefined for 204', async () => {
    expect(await api('DELETE', '/api/shifts/1', undefined, respond(204, null))).toBeUndefined();
  });

  it('sends JSON bodies', async () => {
    const fetchImpl = respond(201, {});
    await api('POST', '/api/roles', { name: 'Tech' }, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBe('{"name":"Tech"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('turns the error envelope into an ApiError', async () => {
    await expect(api('POST', '/api/shifts', {}, respond(409, envelope('SHIFT_CONFLICT')))).rejects.toMatchObject({
      status: 409, code: 'SHIFT_CONFLICT', correlationId: 'cid-1', details: { conflicts: [] },
    });
  });

  it('hands 401 to the unauthorized handler so the page can re-run sign-in', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api('GET', '/api/me', undefined, respond(401, envelope('UNAUTHORIZED')))).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('copes with a non-JSON error page', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(api('GET', '/api/x', undefined, fetchImpl)).rejects.toMatchObject({ status: 502, code: 'UNKNOWN' });
  });
});

describe('query', () => {
  it('skips empty values', () => {
    expect(query({ from: '2026-10-12', to: '2026-10-18', employee_ref: undefined, x: '' })).toBe('?from=2026-10-12&to=2026-10-18');
    expect(query({})).toBe('');
  });
});
```

`frontend/src/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { landingPath, resolve } from './router';
import type { Me } from './types';

const me = (over: Partial<Me>): Me => ({
  name: 'Ana', email: 'ana@example.com', gateway_role: 'user', employee_ref: null, is_manager: false,
  timezone: 'Asia/Kuala_Lumpur', organisation_timezone: 'Asia/Kuala_Lumpur', ...over,
});

describe('landing (FR-ACC-02)', () => {
  it('sends managers to the schedule, employees to My Planning, others to a message', () => {
    expect(landingPath(me({ is_manager: true, employee_ref: 'E1' }))).toBe('/schedule');
    expect(landingPath(me({ employee_ref: 'E1' }))).toBe('/my');
    expect(landingPath(me({}))).toBe('/not-on-roster');
  });
});

describe('resolve', () => {
  it('keeps employees out of manager screens', () => {
    expect(resolve('/schedule', me({ employee_ref: 'E1' }))).toEqual({ name: 'forbidden' });
    expect(resolve('/settings/roles', me({ employee_ref: 'E1' }))).toEqual({ name: 'forbidden' });
  });

  it('opens manager screens and settings tabs', () => {
    const manager = me({ is_manager: true });
    expect(resolve('/schedule', manager)).toEqual({ name: 'schedule' });
    expect(resolve('/settings', manager)).toEqual({ name: 'settings', tab: 'general' });
    expect(resolve('/settings/roles/', manager)).toEqual({ name: 'settings', tab: 'roles' });
  });

  it('sends / and unknown paths to the landing screen', () => {
    expect(resolve('/', me({ employee_ref: 'E1' }))).toEqual({ name: 'my' });
    expect(resolve('/whatever', me({ is_manager: true }))).toEqual({ name: 'schedule' });
  });

  it('My Planning needs a roster reference', () => {
    expect(resolve('/my', me({ is_manager: true }))).toEqual({ name: 'not-on-roster' });
  });
});
```

Run: `npx vitest run`
Expected: FAIL, because `./api` and `./router` don't exist yet.

- [ ] **Step 4: Implement the API client and router**

`frontend/src/api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown,
    public readonly correlationId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope = { error?: { code?: string; message?: string; details?: unknown; correlation_id?: string } } | null;

// A 401 means our session or the gateway session ended. Reloading lets the
// page gate run the sign-in flow again instead of leaving a broken screen.
let onUnauthorized: () => void = () => window.location.reload();

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Request failed (${response.status}).`,
      error?.details ?? null,
      error?.correlation_id ?? response.headers.get('X-Correlation-ID'),
    );
  }
  return data as T;
}

export function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) q.set(key, value);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
```

`frontend/src/router.ts`:

```ts
import type { Me } from './types';

export type Screen =
  | { name: 'schedule' }
  | { name: 'my' }
  | { name: 'settings'; tab: string }
  | { name: 'not-on-roster' }
  | { name: 'forbidden' };

export function landingPath(me: Me): string {
  if (me.is_manager) return '/schedule';
  if (me.employee_ref) return '/my';
  return '/not-on-roster';
}

export function resolve(path: string, me: Me): Screen {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/schedule') return me.is_manager ? { name: 'schedule' } : { name: 'forbidden' };
  if (clean === '/settings' || clean.startsWith('/settings/')) {
    return me.is_manager ? { name: 'settings', tab: clean.split('/')[2] || 'general' } : { name: 'forbidden' };
  }
  if (clean === '/my') return me.employee_ref ? { name: 'my' } : { name: 'not-on-roster' };
  if (clean === '/not-on-roster') return { name: 'not-on-roster' };
  const landing = landingPath(me);
  return landing === '/not-on-roster' ? { name: 'not-on-roster' } : resolve(landing, me);
}
```

Run: `npx vitest run`
Expected: PASS (7 + 5 tests).

- [ ] **Step 5: Add the app shell, styles and view stubs**

`frontend/src/main.ts`:

```ts
import './styles.css';
import { api, setUnauthorizedHandler } from './api';
import { esc } from './dom';
import { landingPath, resolve, type Screen } from './router';
import type { Me } from './types';
import { renderSchedule } from './schedule/scheduleView';
import { renderMyPlanning } from './my/myPlanning';
import { renderSettings } from './settings/settingsView';

let me: Me;

function navigate(path: string): void {
  history.pushState(null, '', path);
  void render();
}

function header(screen: Screen): string {
  const link = (href: string, label: string, active: boolean) =>
    `<a href="${href}" data-nav${active ? ' aria-current="page"' : ''}>${label}</a>`;
  const links = [
    me.is_manager ? link('/schedule', 'Schedule', screen.name === 'schedule') : '',
    me.employee_ref ? link('/my', 'My Planning', screen.name === 'my') : '',
    me.is_manager ? link('/settings', 'Settings', screen.name === 'settings') : '',
  ].join('');
  // No sign-out button: the InterlinkERP gateway is the only place to sign out.
  return `<header class="top"><strong>Planning</strong><nav>${links}</nav><span class="spacer"></span><span class="who">${esc(me.name ?? me.email)}</span></header>`;
}

async function render(): Promise<void> {
  const app = document.getElementById('app')!;
  if (location.pathname === '/') history.replaceState(null, '', landingPath(me));
  const screen = resolve(location.pathname, me);
  app.innerHTML = `${header(screen)}<main></main>`;
  const main = app.querySelector('main')!;
  try {
    if (screen.name === 'schedule') await renderSchedule(main, me);
    else if (screen.name === 'my') await renderMyPlanning(main, me);
    else if (screen.name === 'settings') await renderSettings(main, screen.tab, me);
    else if (screen.name === 'forbidden') main.innerHTML = '<p class="empty">Only Planning Managers can open this page.</p>';
    else main.innerHTML = `<p class="empty">You are signed in as ${esc(me.email)}, but you are not on the planning roster. Ask a Planning Manager if you expected to see shifts here.</p>`;
  } catch (error) {
    main.innerHTML = `<p class="empty">This page could not load: ${esc((error as Error).message)}</p>`;
  }
}

document.addEventListener('click', (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-nav]');
  if (link) {
    event.preventDefault();
    navigate(link.getAttribute('href')!);
  }
});
window.addEventListener('popstate', () => void render());

async function start(): Promise<void> {
  setUnauthorizedHandler(() => window.location.reload());
  me = await api<Me>('GET', '/api/me');
  await render();
}

start().catch((error: Error) => {
  document.getElementById('app')!.innerHTML = `<p class="empty">Planning could not start: ${esc(error.message)}</p>`;
});
```

`frontend/src/styles.css`:

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
.who { color: var(--muted); }
main { padding: 16px; }
button, select, input, textarea { font: inherit; color: inherit; }
button, select, input, textarea { border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius); padding: 6px 10px; }
button { cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--danger); }
button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.empty { color: var(--muted); padding: 24px 0; }
.toasts { position: fixed; right: 16px; bottom: 16px; display: grid; gap: 8px; z-index: 20; }
.toast { display: flex; gap: 12px; align-items: center; background: var(--text); color: var(--bg); padding: 10px 14px; border-radius: var(--radius); }
.toast button { background: transparent; color: inherit; border-color: currentColor; }
dialog { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); width: min(560px, calc(100vw - 32px)); }
dialog::backdrop { background: rgb(0 0 0 / 0.35); }
dialog h2 { font-size: 16px; margin: 0 0 12px; }
.actions { display: flex; gap: 8px; justify-content: flex-end; padding: 0; margin: 16px 0 0; }
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

Stubs, so the app type-checks before the real views exist. Tasks 20, 22 and 23 replace them.

`frontend/src/schedule/scheduleView.ts`:

```ts
import type { Me } from '../types';

export async function renderSchedule(root: HTMLElement, _me: Me): Promise<void> {
  root.innerHTML = '<p class="empty">The schedule arrives in Task 20.</p>';
}
```

`frontend/src/my/myPlanning.ts`:

```ts
import type { Me } from '../types';

export async function renderMyPlanning(root: HTMLElement, _me: Me): Promise<void> {
  root.innerHTML = '<p class="empty">My Planning arrives in Task 22.</p>';
}
```

`frontend/src/settings/settingsView.ts`:

```ts
import type { Me } from '../types';

export async function renderSettings(root: HTMLElement, _tab: string, _me: Me): Promise<void> {
  root.innerHTML = '<p class="empty">Settings arrive in Task 23.</p>';
}
```

- [ ] **Step 6: Build and check by hand**

```bash
npm run typecheck && npm test && npm run build
```

Expected: no type errors, tests pass, `dist/app-shell.html` and `dist/assets/*` exist, and `dist/index.html` does not.

Then run `php -S 127.0.0.1:8000 router.php` in one terminal and `npm run dev` in another, and open `http://127.0.0.1:5173/`:
- With `DEV_USER_ROLE=admin`, the header shows Schedule and Settings and the page lands on `/schedule`.
- With `DEV_USER_ROLE=user` and `DEV_EMPLOYEE_REF=` empty, the page shows the "not on the planning roster" message.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts scripts frontend
git commit -m "feat: add frontend shell with API client and role-based landing"
```

---

### Task 20: Schedule board (read-only)

**Files:**
- Create: `frontend/src/schedule/period.ts`, `tz.ts`, `layout.ts`, `rows.ts`, `schedule.css`, `testData.ts`
- Replace: `frontend/src/schedule/scheduleView.ts`
- Test: `frontend/src/schedule/period.test.ts`, `tz.test.ts`, `layout.test.ts`, `rows.test.ts`, `scheduleView.test.ts`

**Interfaces:**
- Consumes: `GET /api/schedule` (Task 17), `api`, `query`, `esc`, types.
- Produces:
  - `period.ts`:
    - `type Scale = 'day' | 'week' | 'month'`, `interface Period {scale, from, to, days}`
    - `periodFor(scale, anchor): Period`, `step(scale, anchor, dir): string`, `todayIn(tz, now?): string`
    - `parseDate(d): number`, `formatDate(ms): string`, `addDays(d, n): string`
    - `dayLabel(date, scale): string`, `periodLabel(p): string`
  - `tz.ts`: `offsetMinutes(ms, tz)`, `wallToIso(date, time, tz)`, `isoToWall(iso, tz): {date, time}`, `toIso(ms)`, `formatTime(iso, tz)`.
  - `layout.ts`: `geometry(startIso, endIso, fromIso, toIso): {left, width, clippedStart, clippedEnd} | null` (percentages), `assignLanes(items): {lanes: Map<string, number>, count}`.
  - `rows.ts`: `type GroupBy`, `interface Filters {roleId, departmentId, name, state}`, `NO_FILTERS`, `interface Row {key, label, kind: 'open' | 'employee' | 'header', employee, shifts}`, `filterShifts`, `filterEmployees`, `buildRows(payload, groupBy, filters): Row[]`.
  - `scheduleView.ts`:
    - `interface ScheduleContext {root, me, scale, anchor, groupBy, filters, data, period(), visibleShifts(), reload(), redraw()}`
    - `renderSchedule(root, me): Promise<ScheduleContext>`, `boardHtml(data, rows, period): string`
  - The board's DOM contract, which Task 21 relies on:
    - Each row has `[data-row-ref]`, where `open` means the open-shifts row.
    - Each track has `[data-track]`.
    - Each shift bar has `[data-shift-id]` with `tabindex="0"`.
    - Resize handles are `[data-grip="resize-start" | "resize-end"]`.
    - The toolbar has buttons `[data-action="add"]` and `[data-action="publish"]`.

Requirements covered:
- FR-SCH-01: group by employee or by role.
- FR-SCH-02: an open-shifts row.
- FR-SCH-03: day, week and month scales, with previous, today and next.
- FR-SCH-06: filters for role, department, name and state.
- FR-SCH-07: drafts are striped and published shifts are solid, as in Odoo. Time off and holidays are hatched bands, and time outside working hours is greyed.
- FR-SCH-08: allocated against available hours, with an over-allocation badge.
- FR-SCH-09: a red outline plus the reasons in the tooltip and accessible label.
- FR-SHF-04: shifts that cross midnight draw as one continuous bar.

Bars are placed by the fraction of the period's total time. On a daylight-saving day, a bar's position can drift from its column by up to an hour's width. That is acceptable for M1, since Malaysia has no daylight saving.

- [ ] **Step 1: Write the failing tests**

`frontend/src/schedule/testData.ts`:

```ts
import type { SchedulePayload, ScheduleEmployee, Shift } from '../types';

export function employee(over: Partial<ScheduleEmployee> = {}): ScheduleEmployee {
  return {
    employee_ref: 'E1', name: 'Ana Lim', photo_url: null, department_id: null, department_name: null, status: 'Active',
    on_roster: true, role_ids: [], default_role_id: null, timezone: 'Asia/Kuala_Lumpur', flexible: true,
    allocated_hours: 0, available_hours: null, over_allocated_days: [], working_intervals: [], unavailable: [], ...over,
  };
}

export function shift(over: Partial<Shift> = {}): Shift {
  return {
    id: 's1', employee_ref: 'E1', role_id: null, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z',
    break_minutes: 0, allocated_percent: 100, allocated_hours: 8, note: null, state: 'draft', published_at: null,
    version: 1, conflicts: [], conflict_acknowledged: false, ...over,
  };
}

export function payload(over: Partial<SchedulePayload> = {}): SchedulePayload {
  return {
    period: { from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Kuala_Lumpur', from_at: '2026-10-11T16:00:00Z', to_at: '2026-10-18T16:00:00Z' },
    directory_stale: false, roles: [], employees: [], shifts: [], ...over,
  };
}
```

`frontend/src/schedule/period.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayLabel, periodFor, periodLabel, step, todayIn } from './period';

describe('periodFor', () => {
  it('weeks start on Monday', () => {
    const week = periodFor('week', '2026-10-14');
    expect([week.from, week.to, week.days.length]).toEqual(['2026-10-12', '2026-10-18', 7]);
    expect(periodFor('week', '2026-10-18').from).toBe('2026-10-12');
  });

  it('months cover every day', () => {
    const feb = periodFor('month', '2026-02-10');
    expect([feb.from, feb.to, feb.days.length]).toEqual(['2026-02-01', '2026-02-28', 28]);
  });

  it('a day is one day', () => {
    expect(periodFor('day', '2026-10-14').days).toEqual(['2026-10-14']);
  });
});

describe('step', () => {
  it('moves by the scale', () => {
    expect(step('day', '2026-10-14', 1)).toBe('2026-10-15');
    expect(step('week', '2026-10-14', -1)).toBe('2026-10-07');
    expect(step('month', '2026-01-31', 1)).toBe('2026-02-01');
  });
});

describe('labels', () => {
  it('formats days and periods', () => {
    expect(dayLabel('2026-10-14', 'week')).toBe('Wed 14');
    expect(dayLabel('2026-10-14', 'month')).toBe('14');
    expect(periodLabel(periodFor('week', '2026-10-14'))).toBe('12 Oct 2026 – 18 Oct 2026');
    expect(periodLabel(periodFor('month', '2026-10-14'))).toBe('Oct 2026');
  });

  it('today is the date in the given zone', () => {
    expect(todayIn('Asia/Kuala_Lumpur', new Date('2026-10-13T17:00:00Z'))).toBe('2026-10-14');
  });
});
```

`frontend/src/schedule/tz.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatTime, isoToWall, wallToIso } from './tz';

describe('time zones', () => {
  it('converts wall time to UTC and back', () => {
    expect(wallToIso('2026-10-14', '09:00', 'Asia/Kuala_Lumpur')).toBe('2026-10-14T01:00:00Z');
    expect(isoToWall('2026-10-14T01:00:00Z', 'Asia/Kuala_Lumpur')).toEqual({ date: '2026-10-14', time: '09:00' });
    expect(formatTime('2026-10-14T16:30:00Z', 'Asia/Kuala_Lumpur')).toBe('00:30');
  });

  it('handles daylight saving on both sides of the change', () => {
    expect(wallToIso('2026-11-01', '12:00', 'America/New_York')).toBe('2026-11-01T17:00:00Z');
    expect(wallToIso('2026-10-31', '12:00', 'America/New_York')).toBe('2026-10-31T16:00:00Z');
  });
});
```

`frontend/src/schedule/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assignLanes, geometry } from './layout';

const FROM = '2026-10-12T00:00:00Z';
const TO = '2026-10-19T00:00:00Z';

describe('geometry', () => {
  it('places a bar by time', () => {
    const g = geometry('2026-10-13T00:00:00Z', '2026-10-13T12:00:00Z', FROM, TO)!;
    expect(g.left).toBeCloseTo(100 / 7);
    expect(g.width).toBeCloseTo(100 / 14);
    expect([g.clippedStart, g.clippedEnd]).toEqual([false, false]);
  });

  it('a shift over midnight is one continuous bar (FR-SHF-04)', () => {
    const g = geometry('2026-10-13T22:00:00Z', '2026-10-14T06:00:00Z', FROM, TO)!;
    expect(g.width).toBeCloseTo((8 / 168) * 100);
  });

  it('clips at the period edges and hides what is outside', () => {
    const g = geometry('2026-10-11T20:00:00Z', '2026-10-12T04:00:00Z', FROM, TO)!;
    expect(g.left).toBe(0);
    expect(g.clippedStart).toBe(true);
    expect(geometry('2026-10-20T00:00:00Z', '2026-10-20T04:00:00Z', FROM, TO)).toBeNull();
  });
});

describe('assignLanes', () => {
  it('stacks overlapping shifts and reuses free lanes', () => {
    const { lanes, count } = assignLanes([
      { id: 'a', start_at: '2026-10-13T01:00:00Z', end_at: '2026-10-13T05:00:00Z' },
      { id: 'b', start_at: '2026-10-13T03:00:00Z', end_at: '2026-10-13T07:00:00Z' },
      { id: 'c', start_at: '2026-10-13T05:00:00Z', end_at: '2026-10-13T08:00:00Z' },
    ]);
    expect([lanes.get('a'), lanes.get('b'), lanes.get('c'), count]).toEqual([0, 1, 0, 2]);
  });
});
```

`frontend/src/schedule/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildRows, NO_FILTERS } from './rows';
import { employee, payload, shift } from './testData';

const data = payload({
  roles: [{ id: 'tech', name: 'Technician', color: '#22C55E', archived: false }],
  employees: [employee(), employee({ employee_ref: 'E2', name: 'Bo Tan', department_id: 'D2' })],
  shifts: [
    shift({ id: 'open', employee_ref: null }),
    shift({ id: 'a', role_id: 'tech', state: 'published' }),
    shift({ id: 'b', employee_ref: 'E2' }),
  ],
});

describe('buildRows', () => {
  it('puts open shifts first and gives every employee a row', () => {
    const rows = buildRows(data, 'employee', NO_FILTERS);
    expect(rows.map((r) => r.key)).toEqual(['open', 'E1', 'E2']);
    expect(rows[0].shifts.map((s) => s.id)).toEqual(['open']);
  });

  it('a state filter hides shifts but keeps every employee row (FR-SCH-06 AC1)', () => {
    const rows = buildRows(data, 'employee', { ...NO_FILTERS, state: 'draft' });
    expect(rows.map((r) => r.key)).toEqual(['open', 'E1', 'E2']);
    expect(rows.flatMap((r) => r.shifts.map((s) => s.id))).toEqual(['open', 'b']);
  });

  it('name and department filters narrow the employee rows', () => {
    expect(buildRows(data, 'employee', { ...NO_FILTERS, name: 'bo' }).map((r) => r.key)).toEqual(['open', 'E2']);
    expect(buildRows(data, 'employee', { ...NO_FILTERS, departmentId: 'D2' }).map((r) => r.key)).toEqual(['open', 'E2']);
  });

  it('groups by role, with shifts that have no role last (FR-SCH-01 AC2)', () => {
    const rows = buildRows(data, 'role', NO_FILTERS);
    expect(rows.map((r) => [r.kind, r.label])).toEqual([
      ['open', 'Open shifts'], ['header', 'Technician'], ['employee', 'Ana Lim'], ['header', 'No role'], ['employee', 'Bo Tan'],
    ]);
  });
});
```

`frontend/src/schedule/scheduleView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { boardHtml } from './scheduleView';
import { periodFor } from './period';
import { buildRows, NO_FILTERS } from './rows';
import { employee, payload, shift } from './testData';

function board(data = payload()): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = boardHtml(data, buildRows(data, 'employee', NO_FILTERS), periodFor('week', '2026-10-14'));
  return host;
}

describe('boardHtml', () => {
  it('marks drafts, published shifts and conflicts (FR-SCH-07, FR-SCH-09)', () => {
    const host = board(payload({
      employees: [employee()],
      shifts: [
        shift({ id: 'd' }),
        shift({ id: 'p', state: 'published', start_at: '2026-10-15T01:00:00Z', end_at: '2026-10-15T09:00:00Z', conflicts: [{ rule: 'overlap', message: 'Overlaps other shifts; allocation reaches 200%.' }] }),
      ],
    }));
    const draft = host.querySelector('[data-shift-id="d"]')!;
    const published = host.querySelector('[data-shift-id="p"]')!;
    expect(draft.classList.contains('draft')).toBe(true);
    expect(published.classList.contains('published')).toBe(true);
    expect(published.classList.contains('conflict')).toBe(true);
    expect(published.getAttribute('title')).toContain('allocation reaches 200%');
    expect(draft.getAttribute('tabindex')).toBe('0');
  });

  it('shows working time, time off and hours against availability (FR-SCH-07, FR-SCH-08)', () => {
    const host = board(payload({
      employees: [employee({
        flexible: false, allocated_hours: 15, available_hours: 24, over_allocated_days: ['2026-10-16', '2026-10-17'],
        working_intervals: [{ start_at: '2026-10-12T01:00:00Z', end_at: '2026-10-12T05:00:00Z' }],
        unavailable: [{ start_at: '2026-10-15T16:00:00Z', end_at: '2026-10-16T16:00:00Z', kind: 'time_off', label: 'Annual leave' }],
      })],
    }));
    const row = host.querySelector('[data-row-ref="E1"]')!;
    expect(row.classList.contains('has-hours')).toBe(true);
    expect(row.querySelectorAll('.band.work')).toHaveLength(1);
    expect(row.querySelector('.band.away')!.getAttribute('title')).toBe('Annual leave');
    expect(row.querySelector('.hours')!.textContent).toContain('15.0 / 24.0 h');
    expect(row.querySelector('.over')!.getAttribute('title')).toContain('2026-10-16');
  });

  it('escapes names', () => {
    const host = board(payload({ employees: [employee({ name: '<img src=x onerror=alert(1)>' })] }));
    expect(host.querySelector('img')).toBeNull();
  });
});
```

Run: `npx vitest run src/schedule`
Expected: FAIL (missing modules).

- [ ] **Step 2: Implement the pure modules**

`frontend/src/schedule/period.ts`:

```ts
export type Scale = 'day' | 'week' | 'month';
export interface Period { scale: Scale; from: string; to: string; days: string[] }

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar dates are handled as UTC midnights so no local time zone can shift them. */
export function parseDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return formatDate(parseDate(date) + n * DAY_MS);
}

export function periodFor(scale: Scale, anchor: string): Period {
  let from = anchor;
  let to = anchor;
  if (scale === 'week') {
    const mondayOffset = (new Date(parseDate(anchor)).getUTCDay() + 6) % 7;
    from = addDays(anchor, -mondayOffset);
    to = addDays(from, 6);
  } else if (scale === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    from = formatDate(Date.UTC(y, m - 1, 1));
    to = formatDate(Date.UTC(y, m, 0));
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { scale, from, to, days };
}

export function step(scale: Scale, anchor: string, direction: -1 | 1): string {
  if (scale === 'day') return addDays(anchor, direction);
  if (scale === 'week') return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split('-').map(Number);
  return formatDate(Date.UTC(y, m - 1 + direction, 1));
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function dayLabel(date: string, scale: Scale): string {
  const d = new Date(parseDate(date));
  return scale === 'month' ? String(d.getUTCDate()) : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function long(date: string): string {
  const d = new Date(parseDate(date));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function periodLabel(p: Period): string {
  if (p.scale === 'day') return `${WEEKDAYS[new Date(parseDate(p.from)).getUTCDay()]} ${long(p.from)}`;
  if (p.scale === 'week') return `${long(p.from)} – ${long(p.to)}`;
  const d = new Date(parseDate(p.from));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
```

`frontend/src/schedule/tz.ts`:

```ts
const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(ms: number, tz: string): Record<string, string> {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}

/** Minutes the zone is ahead of UTC at that instant. */
export function offsetMinutes(ms: number, tz: string): number {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** "2026-10-14" + "09:00" in tz -> "2026-10-14T01:00:00Z". Two passes settle daylight-saving edges. */
export function wallToIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - offsetMinutes(guess, tz) * 60_000;
  ms = guess - offsetMinutes(ms, tz) * 60_000;
  return toIso(ms);
}

export function isoToWall(iso: string, tz: string): { date: string; time: string } {
  const p = parts(Date.parse(iso), tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function formatTime(iso: string, tz: string): string {
  return isoToWall(iso, tz).time;
}
```

`frontend/src/schedule/layout.ts`:

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
  const span = to - from;
  return { left: ((s - from) / span) * 100, width: ((e - s) / span) * 100, clippedStart: start < from, clippedEnd: end > to };
}

/** Greedy lane assignment so overlapping shifts in one row are all visible. */
export function assignLanes<T extends { id: string; start_at: string; end_at: string }>(items: T[]): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || Date.parse(a.end_at) - Date.parse(b.end_at));
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of sorted) {
    const start = Date.parse(item.start_at);
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = Date.parse(item.end_at);
    lanes.set(item.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}
```

`frontend/src/schedule/rows.ts`:

```ts
import type { ScheduleEmployee, SchedulePayload, Shift } from '../types';

export type GroupBy = 'employee' | 'role';
export interface Filters { roleId: string; departmentId: string; name: string; state: '' | 'draft' | 'published' | 'open' }
export const NO_FILTERS: Filters = { roleId: '', departmentId: '', name: '', state: '' };

export interface Row { key: string; label: string; kind: 'open' | 'employee' | 'header'; employee: ScheduleEmployee | null; shifts: Shift[] }

export function filterShifts(shifts: Shift[], f: Filters): Shift[] {
  return shifts.filter((s) => {
    if (f.roleId && s.role_id !== f.roleId) return false;
    if (f.state === 'draft' && s.state !== 'draft') return false;
    if (f.state === 'published' && s.state !== 'published') return false;
    if (f.state === 'open' && s.employee_ref !== null) return false;
    return true;
  });
}

export function filterEmployees(employees: ScheduleEmployee[], f: Filters): ScheduleEmployee[] {
  const q = f.name.trim().toLowerCase();
  return employees.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!f.departmentId || e.department_id === f.departmentId));
}

export function buildRows(data: SchedulePayload, groupBy: GroupBy, f: Filters): Row[] {
  const shifts = filterShifts(data.shifts, f);
  const employees = filterEmployees(data.employees, f);
  const rows: Row[] = [{ key: 'open', label: 'Open shifts', kind: 'open', employee: null, shifts: shifts.filter((s) => s.employee_ref === null) }];

  if (groupBy === 'employee') {
    for (const e of employees) {
      rows.push({ key: e.employee_ref, label: e.name, kind: 'employee', employee: e, shifts: shifts.filter((s) => s.employee_ref === e.employee_ref) });
    }
    return rows;
  }

  const groups: { id: string | null; name: string }[] = [...data.roles.map((r) => ({ id: r.id as string | null, name: r.name })), { id: null, name: 'No role' }];
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

- [ ] **Step 3: Implement the board view**

`frontend/src/schedule/schedule.css`:

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
.track { position: relative; height: calc(var(--lanes, 1) * 30px + 8px); background-image: repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px calc(100% / var(--cols))); }
.track.cols { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); height: auto; background: none; }
.track.cols > div { padding: 6px 4px; border-left: 1px solid var(--line); overflow: hidden; white-space: nowrap; }
.row.has-hours .track { background-color: var(--off); }
.band { position: absolute; top: 0; bottom: 0; pointer-events: none; }
.band.work { background: var(--surface); }
.band.away { background: var(--away); }
.shift { position: absolute; height: 26px; border-radius: 4px; padding: 3px 8px; font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: grab; touch-action: none; user-select: none;
  border: 1px solid var(--role-color, var(--accent)); background: var(--role-color, var(--accent)); color: #fff; }
.shift.draft { color: var(--text); background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--role-color, var(--accent)) 35%, transparent) 0 6px, color-mix(in srgb, var(--role-color, var(--accent)) 15%, transparent) 6px 12px); }
.shift.conflict { outline: 2px solid var(--danger); outline-offset: 1px; }
.shift.clipped-start { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.shift.clipped-end { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.shift .grip { position: absolute; top: 0; bottom: 0; width: 7px; cursor: ew-resize; }
.shift .grip.start { left: 0; }
.shift .grip.end { right: 0; }
.shift:focus-visible { outline: 2px solid var(--text); }
.hours { font-size: 12px; font-variant-numeric: tabular-nums; }
.over { display: block; color: var(--warn); font-weight: 600; }
.avatar { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 6px; }
```

`frontend/src/schedule/scheduleView.ts` (replaces the stub):

```ts
import './schedule.css';
import { api, query } from '../api';
import { esc } from '../dom';
import type { Me, Role, ScheduleEmployee, SchedulePayload, Shift, TimeSpan } from '../types';
import { assignLanes, geometry } from './layout';
import { dayLabel, periodFor, periodLabel, step, todayIn, type Period, type Scale } from './period';
import { buildRows, NO_FILTERS, type Filters, type GroupBy, type Row } from './rows';
import { formatTime } from './tz';

export interface ScheduleContext {
  root: HTMLElement;
  me: Me;
  scale: Scale;
  anchor: string;
  groupBy: GroupBy;
  filters: Filters;
  data: SchedulePayload | null;
  period(): Period;
  visibleShifts(): Shift[];
  reload(): Promise<void>;
  redraw(): void;
}

export async function renderSchedule(root: HTMLElement, me: Me): Promise<ScheduleContext> {
  root.innerHTML = `<section class="schedule">
    <div class="toolbar" data-toolbar></div>
    <p class="notice" data-notice hidden></p>
    <div class="board" data-board aria-busy="true"></div>
  </section>`;
  const ctx: ScheduleContext = {
    root,
    me,
    scale: 'week',
    anchor: todayIn(me.organisation_timezone),
    groupBy: 'employee',
    filters: { ...NO_FILTERS },
    data: null,
    period() {
      return periodFor(this.scale, this.anchor);
    },
    visibleShifts() {
      return this.data ? buildRows(this.data, this.groupBy, this.filters).flatMap((r) => r.shifts) : [];
    },
    async reload() {
      const p = this.period();
      this.data = await api<SchedulePayload>('GET', `/api/schedule${query({ from: p.from, to: p.to })}`);
      drawToolbar(this);
      this.redraw();
    },
    redraw() {
      const board = this.root.querySelector<HTMLElement>('[data-board]')!;
      board.innerHTML = this.data ? boardHtml(this.data, buildRows(this.data, this.groupBy, this.filters), this.period()) : '';
      board.setAttribute('aria-busy', 'false');
    },
  };
  bindToolbar(ctx);
  await ctx.reload();
  return ctx;
}

function bindToolbar(ctx: ScheduleContext): void {
  const toolbar = ctx.root.querySelector<HTMLElement>('[data-toolbar]')!;
  toolbar.addEventListener('click', async (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'prev' || action === 'next') {
      ctx.anchor = step(ctx.scale, ctx.anchor, action === 'prev' ? -1 : 1);
      await ctx.reload();
    } else if (action === 'today') {
      ctx.anchor = todayIn(ctx.me.organisation_timezone);
      await ctx.reload();
    }
  });
  toolbar.addEventListener('change', async (event) => {
    const input = event.target as HTMLSelectElement;
    if (input.name === 'scale') {
      ctx.scale = input.value as Scale;
      await ctx.reload();
    } else if (input.name === 'groupBy') {
      ctx.groupBy = input.value as GroupBy;
      ctx.redraw();
    } else if (input.name === 'roleId' || input.name === 'departmentId' || input.name === 'state') {
      ctx.filters = { ...ctx.filters, [input.name]: input.value };
      ctx.redraw();
    }
  });
  toolbar.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'name') {
      ctx.filters = { ...ctx.filters, name: input.value };
      ctx.redraw();
    }
  });
}

function option(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
}

function drawToolbar(ctx: ScheduleContext): void {
  const data = ctx.data!;
  const departments = new Map<string, string>();
  for (const e of data.employees) if (e.department_id) departments.set(e.department_id, e.department_name ?? e.department_id);
  ctx.root.querySelector<HTMLElement>('[data-toolbar]')!.innerHTML = `
    <button type="button" data-action="prev" aria-label="Previous period">‹</button>
    <button type="button" data-action="today">Today</button>
    <button type="button" data-action="next" aria-label="Next period">›</button>
    <span class="period">${esc(periodLabel(ctx.period()))}</span>
    <select name="scale" aria-label="Scale">${(['day', 'week', 'month'] as Scale[]).map((s) => option(s, s[0].toUpperCase() + s.slice(1), ctx.scale)).join('')}</select>
    <select name="groupBy" aria-label="Group by">${option('employee', 'By employee', ctx.groupBy)}${option('role', 'By role', ctx.groupBy)}</select>
    <select name="roleId" aria-label="Filter by role">${option('', 'All roles', ctx.filters.roleId)}${data.roles.filter((r) => !r.archived).map((r) => option(r.id, r.name, ctx.filters.roleId)).join('')}</select>
    <select name="departmentId" aria-label="Filter by department">${option('', 'All departments', ctx.filters.departmentId)}${[...departments].map(([id, name]) => option(id, name, ctx.filters.departmentId)).join('')}</select>
    <select name="state" aria-label="Filter by state">${option('', 'All shifts', ctx.filters.state)}${option('draft', 'Drafts', ctx.filters.state)}${option('published', 'Published', ctx.filters.state)}${option('open', 'Open shifts', ctx.filters.state)}</select>
    <input name="name" type="search" placeholder="Find employee" aria-label="Find employee" value="${esc(ctx.filters.name)}">
    <span class="spacer"></span>
    <button type="button" data-action="add">Add shift</button>
    <button type="button" class="primary" data-action="publish">Publish</button>`;
  const notice = ctx.root.querySelector<HTMLElement>('[data-notice]')!;
  notice.hidden = !data.directory_stale;
  notice.textContent = 'Employee names may be out of date because the roster could not be refreshed. Planning still works.';
}

export function boardHtml(data: SchedulePayload, rows: Row[], period: Period): string {
  const columns = period.scale === 'day'
    ? Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
    : period.days.map((d) => dayLabel(d, period.scale));
  const roles = new Map(data.roles.map((r) => [r.id, r]));
  const head = `<div class="row head" role="row"><div class="cell label">${rows.some((r) => r.kind === 'header') ? 'Role / employee' : 'Employee'}</div>
    <div class="track cols" style="--cols:${columns.length}">${columns.map((c) => `<div>${esc(c)}</div>`).join('')}</div>
    <div class="cell hours">Hours</div></div>`;
  return head + rows.map((row) => rowHtml(row, data, roles, columns.length)).join('');
}

function rowHtml(row: Row, data: SchedulePayload, roles: Map<string, Role>, columns: number): string {
  if (row.kind === 'header') return `<div class="row group"><div class="cell">${esc(row.label)}</div></div>`;
  const { from_at: from, to_at: to, timezone: tz } = data.period;
  const { lanes, count } = assignLanes(row.shifts);
  const e = row.employee;
  const bands = e
    ? [
        ...(e.flexible ? [] : e.working_intervals.map((i) => band(i, from, to, 'work', ''))),
        ...e.unavailable.map((u) => band(u, from, to, `away ${u.kind}`, u.label)),
      ].join('')
    : '';
  const bars = row.shifts.map((s) => shiftHtml(s, from, to, lanes.get(s.id) ?? 0, roles, tz)).join('');
  return `<div class="row${e && !e.flexible ? ' has-hours' : ''}" data-row-ref="${esc(e ? e.employee_ref : 'open')}">
    <div class="cell label">${labelHtml(row)}</div>
    <div class="track" data-track style="--cols:${columns};--lanes:${count}">${bands}${bars}</div>
    <div class="cell hours">${hoursHtml(row)}</div>
  </div>`;
}

function band(span: TimeSpan, from: string, to: string, kind: string, label: string): string {
  const g = geometry(span.start_at, span.end_at, from, to);
  if (!g) return '';
  return `<div class="band ${esc(kind)}" style="left:${g.left}%;width:${g.width}%"${label ? ` title="${esc(label)}"` : ''}></div>`;
}

function shiftHtml(s: Shift, from: string, to: string, lane: number, roles: Map<string, Role>, tz: string): string {
  const g = geometry(s.start_at, s.end_at, from, to);
  if (!g) return '';
  const role = s.role_id ? roles.get(s.role_id) : undefined;
  const label = `${formatTime(s.start_at, tz)}–${formatTime(s.end_at, tz)}${role ? ` ${role.name}` : ''}`;
  const problems = s.conflicts.map((c) => c.message);
  const title = [label, s.state === 'draft' ? 'Draft, not published' : 'Published', ...problems].join('\n');
  const classes = ['shift', s.state, problems.length ? 'conflict' : '', g.clippedStart ? 'clipped-start' : '', g.clippedEnd ? 'clipped-end' : ''].filter(Boolean).join(' ');
  const style = `left:${g.left}%;width:${g.width}%;top:${lane * 30 + 4}px${role ? `;--role-color:${esc(role.color)}` : ''}`;
  return `<div class="${classes}" data-shift-id="${esc(s.id)}" role="button" tabindex="0" title="${esc(title)}" aria-label="${esc(title.replace(/\n/g, '. '))}" style="${style}">`
    + `<span class="grip start" data-grip="resize-start"></span>${problems.length ? '⚠ ' : ''}${esc(label)}<span class="grip end" data-grip="resize-end"></span></div>`;
}

function labelHtml(row: Row): string {
  if (!row.employee) return `<div class="name">Open shifts</div><div class="meta">${row.shifts.length} in view</div>`;
  const e: ScheduleEmployee = row.employee;
  const meta = [e.department_name, e.flexible ? 'Flexible hours' : '', e.on_roster ? '' : 'Not on the roster'].filter(Boolean).join(' · ');
  const avatar = e.photo_url ? `<img class="avatar" src="${esc(e.photo_url)}" alt="">` : '';
  return `<div class="name">${avatar}${esc(e.name)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}`;
}

function hoursHtml(row: Row): string {
  const e = row.employee;
  if (!e) return '';
  const available = e.available_hours === null ? 'flexible' : `${e.available_hours.toFixed(1)}`;
  const over = e.over_allocated_days.length
    ? `<span class="over" title="Over-allocated on ${esc(e.over_allocated_days.join(', '))}">⚠ ${e.over_allocated_days.length} day${e.over_allocated_days.length > 1 ? 's' : ''} over</span>`
    : '';
  return `${e.allocated_hours.toFixed(1)} / ${available} h${over}`;
}
```

The `hours` test expects `15.0 / 24.0 h`. The `.hours` cell's `textContent` starts with exactly that text.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Check it in the browser**

Start both dev servers as in Task 19. Using a dev identity with `DEV_USER_ROLE=admin`, create two employees' worth of data:
- Set `INTERLINK_CLIENT_ID` so the real roster loads, or insert rows into `employee_directory` by hand.
- Create a few shifts with `curl -X POST http://127.0.0.1:8000/api/shifts -H 'content-type: application/json' -d '{...}'`.

Check that:
- Week, Day and Month scales work, and Previous, Today and Next move the period.
- Drafts are striped and published shifts are solid.
- The time-off band is hatched, and time outside working hours is grey.
- The hours column shows allocated against available hours.
- Group by role shows role headers.
- The "Drafts" filter keeps every employee row.
- The page has no horizontal scroll on the page itself at 1024px wide. Only the board scrolls.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat: add schedule board with scales, grouping, filters and markers"
```

---

### Task 21: Schedule interactions: shift form, drag, resize, delete with undo, duplicate, publish

**Files:**
- Create: `frontend/src/schedule/drag.ts`, `frontend/src/schedule/shiftDialog.ts`, `frontend/src/schedule/interactions.ts`
- Modify: `frontend/src/schedule/scheduleView.ts` (call `attachInteractions`), `frontend/src/schedule/schedule.css`
- Test: `frontend/src/schedule/drag.test.ts`, `frontend/src/schedule/shiftDialog.test.ts`

**Interfaces:**
- Consumes: Task 20's `ScheduleContext` and its DOM contract. Endpoints: `POST`/`PATCH`/`DELETE /api/shifts`, `POST /api/shift-restorations`, `POST /api/publications`.
- Produces:
  - `drag.ts`:
    - `snapMinutes(scale): number`, `deltaFromPixels(dxPx, widthPx, periodMs, snapMin): number`
    - `type DragMode = 'move' | 'resize-start' | 'resize-end'`, `applyDrag(shift, mode, deltaMs, minMs?): {start_at, end_at} | null`
    - `newShiftTimes(scale, clickedIso | null, tz, fallbackDate): {start_at, end_at}`
    - `publishSummary(shifts): {ids, employees, open}`
  - `shiftDialog.ts`:
    - `interface ShiftForm`, `formToBody(form, tz)`, `shiftToForm(shift, tz)`, `FIELD_FOR` (API field to form field)
    - `saveShift(method, path, body): Promise<Shift | null>`. On `SHIFT_CONFLICT` it asks for confirmation and resends with `acknowledge_conflicts`.
    - `openShiftDialog(ctx, shift | null, initial)`
  - `interactions.ts`: `attachInteractions(ctx)`.

Requirements covered:
- FR-SHF-01, 02: create from the button or by clicking an empty cell.
- FR-SHF-03: drag to move, including onto another row; resize from either edge.
- FR-SHF-05: duplicate.
- FR-SHF-07: delete with a 10-second undo.
- FR-SHF-08: allocated percentage.
- FR-SHF-09: conflict warning with "Save anyway".
- FR-SHF-10: note.
- FR-PUB-01: publish the drafts in the current view and filter.
- NFR-07: every drag action can also be done in the form. Enter or Space on a focused shift opens it.

- [ ] **Step 1: Write the failing tests**

`frontend/src/schedule/drag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyDrag, deltaFromPixels, newShiftTimes, publishSummary, snapMinutes } from './drag';
import { shift } from './testData';

const HOUR = 3_600_000;

describe('drag maths', () => {
  it('snaps by scale', () => {
    expect([snapMinutes('day'), snapMinutes('week'), snapMinutes('month')]).toEqual([15, 30, 1440]);
    const weekMs = 7 * 24 * HOUR;
    expect(deltaFromPixels(100, 700, weekMs, 30)).toBe(24 * HOUR);
    expect(deltaFromPixels(3, 700, weekMs, 30)).toBe(30 * 60_000);
  });

  it('moves and resizes, never below the minimum length', () => {
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
      shift({ id: 'a' }), shift({ id: 'b' }), shift({ id: 'c', employee_ref: 'E2' }),
      shift({ id: 'd', employee_ref: null }), shift({ id: 'e', state: 'published' }),
    ]);
    expect(summary).toEqual({ ids: ['a', 'b', 'c', 'd'], employees: 2, open: 1 });
  });
});
```

`frontend/src/schedule/shiftDialog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FIELD_FOR, formToBody, shiftToForm } from './shiftDialog';
import { shift } from './testData';

const tz = 'Asia/Kuala_Lumpur';

describe('shift form', () => {
  it('round-trips a shift through the form in the organisation time zone', () => {
    const form = shiftToForm(shift({ note: 'Bring keys', break_minutes: 30, allocated_percent: 50 }), tz);
    expect(form).toMatchObject({ employee_ref: 'E1', start_date: '2026-10-14', start_time: '09:00', end_date: '2026-10-14', end_time: '17:00', break_minutes: '30', allocated_percent: '50', note: 'Bring keys' });
    expect(formToBody(form, tz)).toEqual({
      employee_ref: 'E1', role_id: null, start_at: '2026-10-14T01:00:00Z', end_at: '2026-10-14T09:00:00Z',
      break_minutes: 30, allocated_percent: 50, note: 'Bring keys',
    });
  });

  it('an empty employee is an open shift and an empty note is null', () => {
    const form = { ...shiftToForm(shift(), tz), employee_ref: '', note: '  ' };
    const body = formToBody(form, tz);
    expect(body.employee_ref).toBeNull();
    expect(body.note).toBeNull();
  });

  it('maps API field errors onto form fields', () => {
    expect(FIELD_FOR.start_at).toBe('start_time');
    expect(FIELD_FOR.end_at).toBe('end_time');
    expect(FIELD_FOR.break_minutes).toBe('break_minutes');
  });
});
```

Run: `npx vitest run src/schedule`
Expected: FAIL (missing modules).

- [ ] **Step 2: Implement the pure helpers**

`frontend/src/schedule/drag.ts`:

```ts
import type { Shift } from '../types';
import type { Scale } from './period';
import { isoToWall, toIso, wallToIso } from './tz';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export function snapMinutes(scale: Scale): number {
  return scale === 'day' ? 15 : scale === 'week' ? 30 : 24 * 60;
}

/** Pixels dragged -> milliseconds, rounded to the snap step. */
export function deltaFromPixels(dxPx: number, widthPx: number, periodMs: number, snapMin: number): number {
  const snap = snapMin * 60_000;
  const raw = Math.round(((dxPx / widthPx) * periodMs) / snap) * snap;
  if (raw === 0 && Math.abs(dxPx) >= 3) return Math.sign(dxPx) * snap; // a deliberate small drag still moves one step
  return raw;
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
  if (start === origStart && end === origEnd) return null;
  return { start_at: toIso(start), end_at: toIso(end) };
}

/** Day view: the clicked hour, one hour long. Week/month: 09:00–17:00 on the clicked day. */
export function newShiftTimes(scale: Scale, clickedIso: string | null, tz: string, fallbackDate: string): { start_at: string; end_at: string } {
  const wall = clickedIso ? isoToWall(clickedIso, tz) : { date: fallbackDate, time: '09:00' };
  if (scale === 'day' && clickedIso) {
    const start = wallToIso(wall.date, `${wall.time.slice(0, 2)}:00`, tz);
    return { start_at: start, end_at: toIso(Date.parse(start) + 3_600_000) };
  }
  return { start_at: wallToIso(wall.date, '09:00', tz), end_at: wallToIso(wall.date, '17:00', tz) };
}

export function publishSummary(shifts: Shift[]): { ids: string[]; employees: number; open: number } {
  const drafts = shifts.filter((s) => s.state === 'draft');
  return {
    ids: drafts.map((s) => s.id),
    employees: new Set(drafts.filter((s) => s.employee_ref !== null).map((s) => s.employee_ref)).size,
    open: drafts.filter((s) => s.employee_ref === null).length,
  };
}
```

Check the test values: on a 700px week track, 3px is about 43 minutes, which rounds to one 30-minute step. 100px is exactly 24 hours. A drag of 3px or more that rounds to zero steps (for example on a wide day view) still moves one step, so a deliberate nudge is never lost.

- [ ] **Step 3: Implement the shift dialog**

`frontend/src/schedule/shiftDialog.ts`:

```ts
import { api, ApiError } from '../api';
import { confirmDialog, esc } from '../dom';
import { toast } from '../toast';
import type { Conflict, Shift } from '../types';
import type { ScheduleContext } from './scheduleView';
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

/** API error field -> form input name. */
export const FIELD_FOR: Record<string, keyof ShiftForm> = {
  employee_ref: 'employee_ref', role_id: 'role_id', start_at: 'start_time', end_at: 'end_time',
  break_minutes: 'break_minutes', allocated_percent: 'allocated_percent', note: 'note',
};

export function shiftToForm(s: Pick<Shift, 'employee_ref' | 'role_id' | 'start_at' | 'end_at' | 'break_minutes' | 'allocated_percent' | 'note'>, tz: string): ShiftForm {
  const start = isoToWall(s.start_at, tz);
  const end = isoToWall(s.end_at, tz);
  return {
    employee_ref: s.employee_ref ?? '', role_id: s.role_id ?? '',
    start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time,
    break_minutes: String(s.break_minutes), allocated_percent: String(s.allocated_percent), note: s.note ?? '',
  };
}

export function formToBody(f: ShiftForm, tz: string): Record<string, unknown> {
  return {
    employee_ref: f.employee_ref || null,
    role_id: f.role_id || null,
    start_at: wallToIso(f.start_date, f.start_time, tz),
    end_at: wallToIso(f.end_date, f.end_time, tz),
    break_minutes: Number(f.break_minutes || 0),
    allocated_percent: Number(f.allocated_percent || 100),
    note: f.note.trim() || null,
  };
}

/** Saves; on SHIFT_CONFLICT asks the manager and resends with acknowledge_conflicts (FR-SHF-09). Null = manager cancelled. */
export async function saveShift(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): Promise<Shift | null> {
  try {
    return (await api<{ shift: Shift }>(method, path, body)).shift;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'SHIFT_CONFLICT') throw error;
    const conflicts = ((error.details as { conflicts?: Conflict[] } | null)?.conflicts ?? []).map((c) => c.message);
    if (!(await confirmDialog('This shift breaks a planning rule', conflicts, 'Save anyway'))) return null;
    return (await api<{ shift: Shift }>(method, path, { ...body, acknowledge_conflicts: true })).shift;
  }
}

export function openShiftDialog(ctx: ScheduleContext, shift: Shift | null, initial: ShiftForm): void {
  const data = ctx.data!;
  const tz = data.period.timezone;
  const opt = (value: string, label: string, current: string) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
  const roles = data.roles.filter((r) => !r.archived || r.id === initial.role_id);
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<form novalidate>
    <h2>${shift ? 'Edit shift' : 'New shift'}</h2>
    ${shift?.conflicts.length ? `<ul class="form-error">${shift.conflicts.map((c) => `<li>${esc(c.message)}</li>`).join('')}</ul>` : ''}
    <div class="form-grid">
      <label class="wide">Employee<select name="employee_ref">${opt('', 'Open shift (nobody yet)', initial.employee_ref)}${data.employees.filter((e) => e.on_roster || e.employee_ref === initial.employee_ref).map((e) => opt(e.employee_ref, e.name, initial.employee_ref)).join('')}</select></label>
      <label class="wide">Role<select name="role_id">${opt('', 'No role', initial.role_id)}${roles.map((r) => opt(r.id, r.name, initial.role_id)).join('')}</select></label>
      <label>Start date<input type="date" name="start_date" required value="${esc(initial.start_date)}"></label>
      <label>Start time<input type="time" name="start_time" required value="${esc(initial.start_time)}"></label>
      <label>End date<input type="date" name="end_date" required value="${esc(initial.end_date)}"></label>
      <label>End time<input type="time" name="end_time" required value="${esc(initial.end_time)}"></label>
      <label>Break (minutes)<input type="number" name="break_minutes" min="0" max="1440" step="5" value="${esc(initial.break_minutes)}"></label>
      <label>Allocated %<input type="number" name="allocated_percent" min="1" max="100" value="${esc(initial.allocated_percent)}"></label>
      <label class="wide">Note for the employee<textarea name="note" rows="2" maxlength="2000">${esc(initial.note)}</textarea></label>
    </div>
    <p class="form-error" data-message hidden></p>
    <menu class="actions">
      ${shift ? '<button type="button" class="danger" data-act="delete">Delete</button><button type="button" data-act="duplicate">Duplicate</button><span class="spacer"></span>' : ''}
      <button type="button" data-act="cancel">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </menu>
  </form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();

  const form = dialog.querySelector('form')!;
  const message = form.querySelector<HTMLElement>('[data-message]')!;
  const showMessage = (text: string) => {
    message.textContent = text;
    message.hidden = false;
  };
  const done = async (text?: string) => {
    dialog.close();
    await ctx.reload();
    if (text) toast(text, undefined, 4000);
  };

  // FR-SHF-01 AC2: picking an employee for a new shift presets their default role.
  (form.elements.namedItem('employee_ref') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
    if (shift) return;
    const ref = (event.target as HTMLSelectElement).value;
    const roleSelect = form.elements.namedItem('role_id') as HTMLSelectElement;
    roleSelect.value = data.employees.find((e) => e.employee_ref === ref)?.default_role_id ?? '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
    message.hidden = true;
    const values = Object.fromEntries(new FormData(form)) as unknown as ShiftForm;
    const body = formToBody(values, tz);
    if (shift) body.version = shift.version;
    try {
      const saved = await saveShift(shift ? 'PATCH' : 'POST', shift ? `/api/shifts/${shift.id}` : '/api/shifts', body);
      if (saved) await done(shift ? 'Shift saved.' : 'Shift created as a draft.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR' && error.details && typeof error.details === 'object') {
        for (const [field, text] of Object.entries(error.details as Record<string, string>)) {
          const input = form.elements.namedItem(FIELD_FOR[field] ?? '') as HTMLElement | null;
          if (input) input.insertAdjacentHTML('afterend', `<span class="field-error">${esc(text)}</span>`);
          else showMessage(text);
        }
      } else {
        showMessage((error as Error).message);
      }
    }
  });

  form.addEventListener('click', async (event) => {
    const act = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'cancel') dialog.close();
    if (!shift || (act !== 'delete' && act !== 'duplicate')) return;
    try {
      if (act === 'delete') {
        if (!(await confirmDialog('Delete this shift?', shift.state === 'published' ? ['The employee will be told unless you undo within 10 seconds.'] : [], 'Delete'))) return;
        await api('DELETE', `/api/shifts/${shift.id}`);
        await done();
        toast('Shift deleted.', {
          label: 'Undo',
          run: async () => {
            try {
              await api('POST', '/api/shift-restorations', { shift_id: shift.id });
              await ctx.reload();
            } catch (error) {
              toast((error as Error).message, undefined, 5000);
            }
          },
        });
      } else {
        const copy = await saveShift('POST', '/api/shifts', { duplicate_of: shift.id });
        if (copy) await done('Shift duplicated to the next day as a draft.');
      }
    } catch (error) {
      showMessage((error as Error).message);
    }
  });
}
```

- [ ] **Step 4: Implement the board interactions**

`frontend/src/schedule/interactions.ts`:

```ts
import { api, ApiError } from '../api';
import { confirmDialog } from '../dom';
import { toast } from '../toast';
import { applyDrag, deltaFromPixels, newShiftTimes, publishSummary, snapMinutes, type DragMode } from './drag';
import type { ScheduleContext } from './scheduleView';
import { openShiftDialog, saveShift, shiftToForm } from './shiftDialog';
import { toIso } from './tz';

export function attachInteractions(ctx: ScheduleContext): void {
  const toolbar = ctx.root.querySelector<HTMLElement>('[data-toolbar]')!;
  const board = ctx.root.querySelector<HTMLElement>('[data-board]')!;

  toolbar.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'add') openNew(ctx, null, null);
    if (action === 'publish') void publish(ctx);
  });

  board.addEventListener('pointerdown', (event) => onPointerDown(ctx, event));

  // Clicking empty space in a row starts a new shift there (FR-SHF-02).
  board.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-shift-id]')) return;
    const track = target.closest<HTMLElement>('[data-track]');
    const row = track?.closest<HTMLElement>('[data-row-ref]');
    if (!track || !row || !ctx.data) return;
    const rect = track.getBoundingClientRect();
    const from = Date.parse(ctx.data.period.from_at);
    const to = Date.parse(ctx.data.period.to_at);
    const clicked = toIso(from + ((event.clientX - rect.left) / rect.width) * (to - from));
    const ref = row.dataset.rowRef!;
    openNew(ctx, ref === 'open' ? null : ref, clicked);
  });

  // Keyboard alternative to dragging (NFR-07): open the shift and edit it in the form.
  board.addEventListener('keydown', (event) => {
    const bar = (event.target as HTMLElement).closest<HTMLElement>('[data-shift-id]');
    if (bar && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openExisting(ctx, bar.dataset.shiftId!);
    }
  });
}

function openNew(ctx: ScheduleContext, employeeRef: string | null, clickedIso: string | null): void {
  const data = ctx.data!;
  const times = newShiftTimes(ctx.scale, clickedIso, data.period.timezone, ctx.period().from);
  const employee = data.employees.find((e) => e.employee_ref === employeeRef);
  openShiftDialog(ctx, null, shiftToForm({
    employee_ref: employeeRef, role_id: employee?.default_role_id ?? null, ...times, break_minutes: 0, allocated_percent: 100, note: null,
  }, data.period.timezone));
}

function openExisting(ctx: ScheduleContext, id: string): void {
  const shift = ctx.data?.shifts.find((s) => s.id === id);
  if (shift) openShiftDialog(ctx, shift, shiftToForm(shift, ctx.data!.period.timezone));
}

function rowRefAt(bar: HTMLElement, x: number, y: number): string | null | undefined {
  bar.style.visibility = 'hidden';
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row-ref]');
  bar.style.visibility = '';
  if (!row) return undefined;
  return row.dataset.rowRef === 'open' ? null : row.dataset.rowRef;
}

function onPointerDown(ctx: ScheduleContext, down: PointerEvent): void {
  const target = down.target as HTMLElement;
  const bar = target.closest<HTMLElement>('[data-shift-id]');
  const shift = ctx.data?.shifts.find((s) => s.id === bar?.dataset.shiftId);
  if (!bar || !shift || down.button !== 0) return;
  down.preventDefault();

  const mode = (target.dataset.grip as DragMode | undefined) ?? 'move';
  const track = bar.closest<HTMLElement>('[data-track]')!;
  const width = track.getBoundingClientRect().width;
  const periodMs = Date.parse(ctx.data!.period.to_at) - Date.parse(ctx.data!.period.from_at);
  const left = bar.offsetLeft;
  const barWidth = bar.offsetWidth;
  let moved = false;
  bar.setPointerCapture(down.pointerId);

  const move = (event: PointerEvent) => {
    const dx = event.clientX - down.clientX;
    const dy = event.clientY - down.clientY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    if (mode === 'move') bar.style.transform = `translate(${dx}px, ${dy}px)`;
    else if (mode === 'resize-end') bar.style.width = `${Math.max(8, barWidth + dx)}px`;
    else {
      bar.style.left = `${left + dx}px`;
      bar.style.width = `${Math.max(8, barWidth - dx)}px`;
    }
  };

  const up = async (event: PointerEvent) => {
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', up);
    bar.releasePointerCapture(event.pointerId);
    if (!moved) {
      openExisting(ctx, shift.id);
      return;
    }
    const body: Record<string, unknown> = { version: shift.version };
    const times = applyDrag(shift, mode, deltaFromPixels(event.clientX - down.clientX, width, periodMs, snapMinutes(ctx.scale)));
    if (times) Object.assign(body, times);
    if (mode === 'move') {
      const ref = rowRefAt(bar, event.clientX, event.clientY);
      if (ref !== undefined && ref !== shift.employee_ref) body.employee_ref = ref;
    }
    if (Object.keys(body).length === 1) {
      ctx.redraw();
      return;
    }
    try {
      const saved = await saveShift('PATCH', `/api/shifts/${shift.id}`, body);
      if (saved) toast(shift.state === 'published' ? 'Shift moved. The employee will be told.' : 'Shift moved.', undefined, 4000);
    } catch (error) {
      report(error);
    }
    await ctx.reload();
  };

  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', up);
}

async function publish(ctx: ScheduleContext): Promise<void> {
  const summary = publishSummary(ctx.visibleShifts());
  if (summary.ids.length === 0) {
    toast('There are no draft shifts in this view.', undefined, 4000);
    return;
  }
  const lines = [
    `${summary.ids.length} draft shift${summary.ids.length === 1 ? '' : 's'} in this view will be published.`,
    `${summary.employees} employee${summary.employees === 1 ? '' : 's'} will be told about their shifts.`,
  ];
  if (summary.open) lines.push(`${summary.open} open shift${summary.open === 1 ? '' : 's'} will be published too.`);
  if (!(await confirmDialog('Publish shifts?', lines, 'Publish'))) return;
  try {
    const result = await api<{ published: number; employees_notified: number }>('POST', '/api/publications', { shift_ids: summary.ids });
    toast(`Published ${result.published} shift${result.published === 1 ? '' : 's'}.`, undefined, 5000);
  } catch (error) {
    report(error);
  }
  await ctx.reload();
}

function report(error: unknown): void {
  const text = error instanceof ApiError && error.code === 'STALE_SHIFT'
    ? 'Someone else changed that shift. The schedule has been reloaded.'
    : (error as Error).message;
  toast(text, undefined, 6000);
}
```

In `scheduleView.ts`, add `import { attachInteractions } from './interactions';` and, in `renderSchedule`, call `attachInteractions(ctx);` on the line after `bindToolbar(ctx);`.

Append to `schedule.css`:

```css
.shift-dialog .actions .spacer, dialog .actions .spacer { flex: 1; }
.shift[style*="translate"] { opacity: 0.85; cursor: grabbing; z-index: 3; box-shadow: 0 4px 12px rgb(0 0 0 / 0.2); }
.track { cursor: copy; }
```


- [ ] **Step 5: Run the tests and type check**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Check in the browser**

With both dev servers running as an admin dev identity, check each of these:

1. Click "Add shift". Pick an employee who has a default role. The role preselects (FR-SHF-01 AC2). Save, and a striped draft appears.
2. Click an empty spot in another employee's row. The form opens preset to that employee and day.
3. Drag a shift to the next day, then onto another employee's row. Resize it from both ends. Each change saves after you drop it.
4. Create a shift that overlaps another one. "This shift breaks a planning rule" appears. Choose "Save anyway". The bar gets a red outline, and hovering shows the reason.
5. Open the same shift in two tabs, save it in one, then save it in the other. The second save reports the stale-edit message (Review Focus 1).
6. Delete a shift, then click "Undo" within 10 seconds. It comes back.
7. Use "Duplicate". The copy appears the next day as a draft.
8. Set the "Drafts" filter and click "Publish". The confirmation shows the right counts. Afterwards the bars turn solid.
9. Use only the keyboard: Tab to a shift, press Enter, change the times, and save (NFR-07).

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat: add shift form, drag and resize, undoable delete, duplicate and publish"
```

---

### Task 22: My Planning (employee view)

**Files:**
- Replace: `frontend/src/my/myPlanning.ts`
- Create: `frontend/src/my/myPlanning.css`, `frontend/src/my/days.ts`
- Test: `frontend/src/my/days.test.ts`

**Interfaces:**
- Consumes: `GET /api/my/shifts` (Task 18), `periodFor`, `step`, `todayIn`, `dayLabel`, `periodLabel`, `formatTime`, `isoToWall`.
- Produces: `groupByDay(shifts: MyShift[], days: string[], tz: string): {date: string, shifts: MyShift[]}[]`, and `renderMyPlanning(root, me)`.

Requirements covered:
- FR-MYP-01: the employee's published shifts as a list and as a week calendar, in their time zone.
- FR-MYP-02: usable from 360px wide.

A shift is listed under the local day it starts, so an overnight shift appears once, on its start day.

- [ ] **Step 1: Write the failing test**

`frontend/src/my/days.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupByDay } from './days';
import type { MyShift } from '../types';

const shift = (id: string, start: string, end: string): MyShift => ({ id, role_id: null, start_at: start, end_at: end, break_minutes: 0, allocated_hours: 8, note: null });
const days = ['2026-10-12', '2026-10-13', '2026-10-14'];

describe('groupByDay', () => {
  it('lists each shift once, under the local day it starts', () => {
    const groups = groupByDay([
      shift('overnight', '2026-10-12T14:00:00Z', '2026-10-12T22:00:00Z'), // 22:00–06:00 in Kuala Lumpur
      shift('late', '2026-10-13T16:30:00Z', '2026-10-13T20:00:00Z'), // 00:30 on the 14th locally
      shift('early', '2026-10-13T01:00:00Z', '2026-10-13T09:00:00Z'),
    ], days, 'Asia/Kuala_Lumpur');

    expect(groups.map((g) => [g.date, g.shifts.map((s) => s.id)])).toEqual([
      ['2026-10-12', ['overnight']], ['2026-10-13', ['early']], ['2026-10-14', ['late']],
    ]);
  });

  it('keeps empty days so the week calendar has every column', () => {
    expect(groupByDay([], days, 'Asia/Kuala_Lumpur').map((g) => g.shifts.length)).toEqual([0, 0, 0]);
  });
});
```

Run: `npx vitest run src/my`
Expected: FAIL (missing module).

- [ ] **Step 2: Implement it**

`frontend/src/my/days.ts`:

```ts
import type { MyShift } from '../types';
import { isoToWall } from '../schedule/tz';

export function groupByDay(shifts: MyShift[], days: string[], tz: string): { date: string; shifts: MyShift[] }[] {
  const sorted = [...shifts].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return days.map((date) => ({ date, shifts: sorted.filter((s) => isoToWall(s.start_at, tz).date === date) }));
}
```

`frontend/src/my/myPlanning.css`:

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
  .day:not(:has(.card)) { display: none; }
}
```

`frontend/src/my/myPlanning.ts` (replaces the stub):

```ts
import './myPlanning.css';
import { api, query } from '../api';
import { esc } from '../dom';
import type { Me, MyShiftsPayload } from '../types';
import { dayLabel, periodFor, periodLabel, step, todayIn } from '../schedule/period';
import { formatTime } from '../schedule/tz';
import { groupByDay } from './days';

export async function renderMyPlanning(root: HTMLElement, me: Me): Promise<void> {
  let anchor = todayIn(me.timezone);
  root.innerHTML = `<section class="my">
    <div class="toolbar">
      <button type="button" data-step="-1" aria-label="Previous week">‹</button>
      <button type="button" data-today>This week</button>
      <button type="button" data-step="1" aria-label="Next week">›</button>
      <span class="period" data-period></span>
    </div>
    <div data-body aria-live="polite"></div>
  </section>`;

  const load = async () => {
    const week = periodFor('week', anchor);
    const data = await api<MyShiftsPayload>('GET', `/api/my/shifts${query({ from: week.from, to: week.to })}`);
    const roles = new Map(data.roles.map((r) => [r.id, r]));
    const today = todayIn(data.timezone);
    root.querySelector<HTMLElement>('[data-period]')!.textContent = periodLabel(week);
    const groups = groupByDay(data.shifts, week.days, data.timezone);
    const body = root.querySelector<HTMLElement>('[data-body]')!;
    if (data.shifts.length === 0) {
      body.innerHTML = '<p class="empty">No published shifts this week.</p>';
      return;
    }
    body.innerHTML = `<div class="week">${groups.map((g) => `
      <div class="day${g.date === today ? ' today' : ''}">
        <h3>${esc(dayLabel(g.date, 'week'))}</h3>
        ${g.shifts.map((s) => {
          const role = s.role_id ? roles.get(s.role_id) : undefined;
          return `<div class="card"${role ? ` style="--role-color:${esc(role.color)}"` : ''}>
            <div class="time">${esc(formatTime(s.start_at, data.timezone))}–${esc(formatTime(s.end_at, data.timezone))}</div>
            <div class="meta">${esc([role?.name, `${s.allocated_hours.toFixed(1)} h`, s.break_minutes ? `${s.break_minutes} min break` : ''].filter(Boolean).join(' · '))}</div>
            ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`).join('')}</div>
      <p class="empty">Times are shown in ${esc(data.timezone)}.</p>`;
  };

  root.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    if (button.dataset.step) anchor = step('week', anchor, Number(button.dataset.step) as -1 | 1);
    else if ('today' in button.dataset) anchor = todayIn(me.timezone);
    else return;
    await load();
  });
  await load();
}
```

- [ ] **Step 3: Run tests, then check on a phone-sized screen**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

In the browser, set `DEV_EMPLOYEE_REF` in `.env` to an employee who has published shifts, set `DEV_USER_ROLE=user`, restart PHP, and open `/my`. Check:
- Only published shifts are listed, and drafts never appear (FR-PUB-02).
- With the devtools device toolbar at 360px, the days stack into one column, there's no horizontal scroll, and empty days are hidden.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/my
git commit -m "feat: add My Planning week view for employees"
```

---

### Task 23: Settings screens

**Files:**
- Replace: `frontend/src/settings/settingsView.ts`
- Create: `frontend/src/settings/settings.css`, `common.ts`, `workingHoursInput.ts`, `generalTab.ts`, `rolesTab.ts`, `employeesTab.ts`, `timeOffTab.ts`, `holidaysTab.ts`, `managersTab.ts`
- Test: `frontend/src/settings/workingHoursInput.test.ts`

**Interfaces:**
- Consumes: the Task 11–14 endpoints, `api`, `query`, `confirmDialog`, `toast`, `wallToIso`, `isoToWall`.
- Produces: `renderSettings(root, tab, me)`. The tabs are `general`, `roles`, `employees`, `time-off`, `holidays` and `managers`. Also `parseRanges(text): [string, string][]`, `formatRanges(ranges): string`, `readWorkingHours(values): WorkingHoursMap`, `weeklyHours(hours): number | null`.

Requirements covered:
- FR-CFG-01: roles.
- FR-CFG-02: employee profiles, including working hours and flexible hours.
- FR-CFG-03: time off.
- FR-CFG-04: holidays (add, rename, hide, delete manual ones, sync).
- FR-ACC-03: the manager list, including the last-manager warning.
- Organisation settings: country, region and time zone.

The server does all real validation. These screens show its 422 messages next to the form.

- [ ] **Step 1: Write the failing test**

`frontend/src/settings/workingHoursInput.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatRanges, parseRanges, readWorkingHours, weeklyHours } from './workingHoursInput';

describe('working hours input', () => {
  it('parses comma-separated ranges and pads hours', () => {
    expect(parseRanges('09:00-13:00, 14:00 - 18:00')).toEqual([['09:00', '13:00'], ['14:00', '18:00']]);
    expect(parseRanges('9:00-17:30')).toEqual([['09:00', '17:30']]);
    expect(parseRanges('  ')).toEqual([]);
  });

  it('explains bad input', () => {
    expect(() => parseRanges('nine to five')).toThrow('"nine to five" is not a range like 09:00-13:00.');
  });

  it('formats back to text', () => {
    expect(formatRanges([['09:00', '13:00'], ['14:00', '18:00']])).toBe('09:00-13:00, 14:00-18:00');
  });

  it('reads all seven days and names the bad day', () => {
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

Run: `npx vitest run src/settings`
Expected: FAIL (missing module).

- [ ] **Step 2: Implement the shared helpers**

`frontend/src/settings/workingHoursInput.ts`:

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

export function formatRanges(ranges: [string, string][]): string {
  return ranges.map(([a, b]) => `${a}-${b}`).join(', ');
}

export function readWorkingHours(values: Record<Weekday, string>): WorkingHoursMap {
  const out = {} as WorkingHoursMap;
  for (const [day, label] of WEEKDAYS) {
    try {
      out[day] = parseRanges(values[day] ?? '');
    } catch (error) {
      throw new Error(`${label}: ${(error as Error).message}`);
    }
  }
  return out;
}

export function weeklyHours(hours: WorkingHoursMap | null): number | null {
  if (!hours) return null;
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let total = 0;
  for (const [day] of WEEKDAYS) for (const [a, b] of hours[day] ?? []) total += minutes(b) - minutes(a);
  return total / 60;
}
```

`frontend/src/settings/common.ts`:

```ts
import { ApiError } from '../api';
import { esc } from '../dom';

export function option(value: string, label: string, current: string | null): string {
  return `<option value="${esc(value)}"${value === (current ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
}

/** Shows an API error, including every field message from a 422. */
export function showError(target: HTMLElement, error: unknown): void {
  const details = error instanceof ApiError && error.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? Object.entries(error.details as Record<string, string>).map(([field, text]) => `${field}: ${text}`)
    : [];
  target.innerHTML = `<p class="form-error">${esc((error as Error).message)}${details.map((d) => `<br>${esc(d)}`).join('')}</p>`;
}

export function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));
}
```

`frontend/src/settings/settings.css`:

```css
.settings .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--line); }
.settings .tabs a { padding: 8px 12px; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; }
.settings .tabs a[aria-current="page"] { color: var(--text); border-bottom-color: var(--accent); }
.panel-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 12px; }
.panel-head form { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: middle; }
.muted { color: var(--muted); }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.table-wrap { overflow-x: auto; }
fieldset { border: 1px solid var(--line); border-radius: var(--radius); }
```

- [ ] **Step 3: Implement the tabs**

`frontend/src/settings/settingsView.ts` (replaces the stub):

```ts
import './settings.css';
import type { Me } from '../types';
import { renderEmployees } from './employeesTab';
import { renderGeneral } from './generalTab';
import { renderHolidays } from './holidaysTab';
import { renderManagers } from './managersTab';
import { renderRoles } from './rolesTab';
import { renderTimeOff } from './timeOffTab';

const TABS: [string, string, (panel: HTMLElement, me: Me) => Promise<void>][] = [
  ['general', 'General', renderGeneral],
  ['roles', 'Roles', renderRoles],
  ['employees', 'Employees', renderEmployees],
  ['time-off', 'Time off', renderTimeOff],
  ['holidays', 'Holidays', renderHolidays],
  ['managers', 'Managers', renderManagers],
];

export async function renderSettings(root: HTMLElement, tab: string, me: Me): Promise<void> {
  const active = TABS.find(([id]) => id === tab) ?? TABS[0];
  root.innerHTML = `<section class="settings">
    <nav class="tabs" aria-label="Settings">${TABS.map(([id, label]) => `<a href="/settings/${id}" data-nav${id === active[0] ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div data-panel></div>
  </section>`;
  await active[2](root.querySelector<HTMLElement>('[data-panel]')!, me);
}
```

`frontend/src/settings/generalTab.ts`:

```ts
import { api } from '../api';
import { esc } from '../dom';
import { toast } from '../toast';
import type { Settings } from '../types';
import { formValues, showError } from './common';

export async function renderGeneral(panel: HTMLElement): Promise<void> {
  const { settings } = await api<{ settings: Settings }>('GET', '/api/settings');
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  panel.innerHTML = `<form class="form-grid" style="max-width:560px">
    <label>Country (ISO code)<input name="country_code" maxlength="2" placeholder="MY" value="${esc(settings.country_code)}"></label>
    <label>State / region code<input name="region_code" maxlength="10" placeholder="MY-10" value="${esc(settings.region_code)}"></label>
    <label class="wide">Organisation time zone<input name="timezone" list="zones" required value="${esc(settings.timezone)}"></label>
    <datalist id="zones">${zones.map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
    <p class="wide muted">The country and region decide which public holidays are loaded. Employees without their own time zone use this one.</p>
    <div class="wide" data-error></div>
    <div class="wide actions"><button class="primary">Save</button></div>
  </form>`;
  const form = panel.querySelector('form')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const v = formValues(form);
    try {
      await api('PATCH', '/api/settings', { country_code: v.country_code.trim().toUpperCase() || null, region_code: v.region_code.trim().toUpperCase() || null, timezone: v.timezone.trim() });
      panel.querySelector<HTMLElement>('[data-error]')!.innerHTML = '';
      toast('Settings saved.', undefined, 3000);
    } catch (error) {
      showError(panel.querySelector<HTMLElement>('[data-error]')!, error);
    }
  });
}
```

`frontend/src/settings/rolesTab.ts`:

```ts
import { api } from '../api';
import { esc } from '../dom';
import type { Role } from '../types';
import { formValues, showError } from './common';

export async function renderRoles(panel: HTMLElement): Promise<void> {
  const { roles } = await api<{ roles: Role[] }>('GET', '/api/roles?include_archived=true');
  panel.innerHTML = `<div class="panel-head"><form data-add>
      <label>New role<input name="name" required maxlength="80" placeholder="Technician"></label>
      <label>Colour<input name="color" type="color" value="#3b82f6"></label>
      <button class="primary">Add role</button>
    </form></div>
    <div data-error></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Colour</th><th>Status</th><th></th></tr></thead><tbody>
    ${roles.map((r) => `<tr data-id="${esc(r.id)}">
      <td><input name="name" aria-label="Role name" maxlength="80" value="${esc(r.name)}"></td>
      <td><input name="color" type="color" aria-label="Role colour" value="${esc(r.color.toLowerCase())}"></td>
      <td>${r.archived ? '<span class="muted">Archived</span>' : 'Active'}</td>
      <td class="row-actions"><button type="button" data-act="save">Save</button><button type="button" data-act="${r.archived ? 'restore' : 'archive'}">${r.archived ? 'Restore' : 'Archive'}</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">No roles yet.</td></tr>'}
    </tbody></table></div>`;
  const error = panel.querySelector<HTMLElement>('[data-error]')!;
  const reload = () => renderRoles(panel);

  panel.querySelector<HTMLFormElement>('[data-add]')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('POST', '/api/roles', formValues(event.target as HTMLFormElement));
      await reload();
    } catch (e) {
      showError(error, e);
    }
  });
  panel.querySelector('tbody')!.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    const row = button?.closest<HTMLTableRowElement>('tr[data-id]');
    if (!button || !row) return;
    const name = row.querySelector<HTMLInputElement>('input[name="name"]')!.value;
    const color = row.querySelector<HTMLInputElement>('input[name="color"]')!.value;
    const body = button.dataset.act === 'save' ? { name, color } : { archived: button.dataset.act === 'archive' };
    try {
      await api('PATCH', `/api/roles/${row.dataset.id}`, body);
      await reload();
    } catch (e) {
      showError(error, e);
    }
  });
}
```

`frontend/src/settings/employeesTab.ts`:

```ts
import { api } from '../api';
import { esc } from '../dom';
import { toast } from '../toast';
import type { EmployeeProfile, Role, Weekday } from '../types';
import { option, showError } from './common';
import { formatRanges, readWorkingHours, WEEKDAYS, weeklyHours } from './workingHoursInput';

export async function renderEmployees(panel: HTMLElement): Promise<void> {
  const [{ employees }, { roles }] = await Promise.all([
    api<{ employees: EmployeeProfile[] }>('GET', '/api/employees'),
    api<{ roles: Role[] }>('GET', '/api/roles'),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  panel.innerHTML = `<p class="muted">Employees come from the InterlinkERP roster. Here you set how each one can be planned.</p>
    <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Roles</th><th>Working hours</th><th>Time zone</th><th></th></tr></thead><tbody>
    ${employees.map((e) => {
      const hours = weeklyHours(e.working_hours);
      return `<tr>
        <td>${esc(e.name)}<div class="muted">${esc(e.department_name ?? '')}</div></td>
        <td>${esc(e.role_ids.map((id) => (id === e.default_role_id ? `${roleName.get(id) ?? id} (default)` : roleName.get(id) ?? id)).join(', ') || '—')}</td>
        <td>${hours === null ? 'Flexible' : `${hours.toFixed(1)} h / week`}</td>
        <td>${esc(e.effective_timezone)}${e.timezone ? '' : ' <span class="muted">(organisation)</span>'}</td>
        <td><button type="button" data-ref="${esc(e.employee_ref)}">Edit</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">No employees yet. The roster may still be loading.</td></tr>'}
    </tbody></table></div>`;

  panel.querySelector('tbody')!.addEventListener('click', (event) => {
    const ref = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-ref]')?.dataset.ref;
    const employee = employees.find((e) => e.employee_ref === ref);
    if (employee) openEditor(employee, roles, () => renderEmployees(panel));
  });
}

function openEditor(e: EmployeeProfile, roles: Role[], done: () => Promise<void>): void {
  const flexible = e.working_hours === null;
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<form>
    <h2>${esc(e.name)}</h2>
    <fieldset><legend>Roles</legend>${roles.map((r) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="role_ids" value="${esc(r.id)}"${e.role_ids.includes(r.id) ? ' checked' : ''}>${esc(r.name)}</label>`).join('') || '<p class="muted">Create roles first.</p>'}</fieldset>
    <div class="form-grid">
      <label>Default role<select name="default_role_id">${option('', 'None', e.default_role_id)}${roles.map((r) => option(r.id, r.name, e.default_role_id)).join('')}</select></label>
      <label>Time zone (blank = organisation)<input name="timezone" value="${esc(e.timezone ?? '')}" placeholder="${esc(e.effective_timezone)}"></label>
      <label class="wide" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="flexible"${flexible ? ' checked' : ''}> Flexible hours (no fixed working hours)</label>
      ${WEEKDAYS.map(([day, label]) => `<label>${label}<input name="hours_${day}" placeholder="09:00-13:00, 14:00-18:00" value="${esc(formatRanges(e.working_hours?.[day] ?? []))}"></label>`).join('')}
    </div>
    <div data-error></div>
    <menu class="actions"><button type="button" data-cancel>Cancel</button><button class="primary">Save</button></menu>
  </form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  const form = dialog.querySelector('form')!;
  form.querySelector('[data-cancel]')!.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const error = form.querySelector<HTMLElement>('[data-error]')!;
    try {
      const hoursText = Object.fromEntries(WEEKDAYS.map(([day]) => [day, String(data.get(`hours_${day}`) ?? '')])) as Record<Weekday, string>;
      await api('PATCH', `/api/employees/${encodeURIComponent(e.employee_ref)}`, {
        role_ids: data.getAll('role_ids').map(String),
        default_role_id: String(data.get('default_role_id') ?? '') || null,
        timezone: String(data.get('timezone') ?? '').trim() || null,
        working_hours: data.get('flexible') ? null : readWorkingHours(hoursText),
      });
      dialog.close();
      toast('Planning profile saved.', undefined, 3000);
      await done();
    } catch (e2) {
      showError(error, e2);
    }
  });
}
```

`frontend/src/settings/timeOffTab.ts`:

```ts
import { api, query } from '../api';
import { confirmDialog, esc } from '../dom';
import type { EmployeeProfile, Me, TimeOff } from '../types';
import { addDays, periodFor, todayIn } from '../schedule/period';
import { isoToWall, wallToIso } from '../schedule/tz';
import { option, showError } from './common';

export async function renderTimeOff(panel: HTMLElement, me: Me): Promise<void> {
  const tz = me.organisation_timezone;
  const month = periodFor('month', todayIn(tz));
  let from = month.from;
  let to = addDays(month.to, 31);
  const { employees } = await api<{ employees: EmployeeProfile[] }>('GET', '/api/employees');
  const nameOf = new Map(employees.map((e) => [e.employee_ref, e.name]));

  const draw = async () => {
    const { unavailabilities } = await api<{ unavailabilities: TimeOff[] }>('GET', `/api/unavailabilities${query({ from, to })}`);
    const when = (iso: string) => { const w = isoToWall(iso, tz); return `${w.date} ${w.time}`; };
    panel.innerHTML = `<div class="panel-head">
        <label>From<input type="date" name="from" value="${from}"></label>
        <label>To<input type="date" name="to" value="${to}"></label>
        <span class="spacer"></span><button type="button" class="primary" data-add>Record time off</button>
      </div>
      <div data-error></div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>From</th><th>To</th><th>Reason</th><th></th></tr></thead><tbody>
      ${unavailabilities.map((u) => `<tr data-id="${esc(u.id)}"><td>${esc(nameOf.get(u.employee_ref) ?? u.employee_ref)}</td><td>${esc(when(u.start_at))}</td><td>${esc(when(u.end_at))}</td><td>${esc(u.reason)}</td>
        <td class="row-actions"><button type="button" data-edit>Edit</button><button type="button" class="danger" data-delete>Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No time off in this range.</td></tr>'}
      </tbody></table></div>
      <p class="muted">Times are in ${esc(tz)}.</p>`;
    const error = panel.querySelector<HTMLElement>('[data-error]')!;
    panel.querySelectorAll<HTMLInputElement>('.panel-head input[type="date"]').forEach((input) => input.addEventListener('change', async () => {
      if (input.name === 'from') from = input.value;
      else to = input.value;
      try { await draw(); } catch (e) { showError(error, e); }
    }));
    panel.querySelector('[data-add]')!.addEventListener('click', () => openForm(null));
    panel.querySelector('tbody')!.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement;
      const id = target.closest<HTMLTableRowElement>('tr[data-id]')?.dataset.id;
      const record = unavailabilities.find((u) => u.id === id);
      if (!record) return;
      if (target.closest('[data-edit]')) openForm(record);
      if (target.closest('[data-delete]') && (await confirmDialog('Delete this time off?', [], 'Delete'))) {
        try { await api('DELETE', `/api/unavailabilities/${record.id}`); await draw(); } catch (e) { showError(error, e); }
      }
    });
  };

  const openForm = (record: TimeOff | null) => {
    const start = record ? isoToWall(record.start_at, tz) : { date: todayIn(tz), time: '00:00' };
    const end = record ? isoToWall(record.end_at, tz) : { date: addDays(todayIn(tz), 1), time: '00:00' };
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `<form class="form-grid">
      <h2 class="wide">${record ? 'Edit time off' : 'Record time off'}</h2>
      <label class="wide">Employee<select name="employee_ref" ${record ? 'disabled' : 'required'}>${option('', 'Choose…', record?.employee_ref ?? '')}${employees.map((e) => option(e.employee_ref, e.name, record?.employee_ref ?? '')).join('')}</select></label>
      <label>From date<input type="date" name="start_date" required value="${start.date}"></label>
      <label>From time<input type="time" name="start_time" required value="${start.time}"></label>
      <label>To date<input type="date" name="end_date" required value="${end.date}"></label>
      <label>To time<input type="time" name="end_time" required value="${end.time}"></label>
      <label class="wide">Reason<input name="reason" maxlength="200" value="${esc(record?.reason ?? '')}" placeholder="Annual leave"></label>
      <div class="wide" data-error></div>
      <menu class="wide actions"><button type="button" data-cancel>Cancel</button><button class="primary">Save</button></menu>
    </form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    const form = dialog.querySelector('form')!;
    form.querySelector('[data-cancel]')!.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const v = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const body = { start_at: wallToIso(v.start_date, v.start_time, tz), end_at: wallToIso(v.end_date, v.end_time, tz), reason: v.reason };
      try {
        if (record) await api('PATCH', `/api/unavailabilities/${record.id}`, body);
        else await api('POST', '/api/unavailabilities', { ...body, employee_ref: v.employee_ref });
        dialog.close();
        await draw();
      } catch (e) {
        showError(form.querySelector<HTMLElement>('[data-error]')!, e);
      }
    });
  };

  await draw();
}
```

`frontend/src/settings/holidaysTab.ts`:

```ts
import { api, ApiError } from '../api';
import { confirmDialog, esc } from '../dom';
import { toast } from '../toast';
import type { Holiday, Me } from '../types';
import { todayIn } from '../schedule/period';
import { formValues, showError } from './common';

export async function renderHolidays(panel: HTMLElement, me: Me): Promise<void> {
  let year = Number(todayIn(me.organisation_timezone).slice(0, 4));

  const draw = async () => {
    const { holidays } = await api<{ holidays: Holiday[] }>('GET', `/api/holidays?year=${year}`);
    panel.innerHTML = `<div class="panel-head">
        <label>Year<input type="number" name="year" min="2000" max="2100" value="${year}" style="width:100px"></label>
        <button type="button" data-sync>Load public holidays</button>
        <span class="spacer"></span>
        <form data-add><label>Date<input type="date" name="date" required></label><label>Name<input name="name" required maxlength="160"></label><button class="primary">Add holiday</button></form>
      </div>
      <div data-error></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Source</th><th></th></tr></thead><tbody>
      ${holidays.map((h) => `<tr data-id="${esc(h.id)}"${h.hidden ? ' class="muted"' : ''}>
        <td>${esc(h.date)}</td>
        <td><input name="name" aria-label="Holiday name" value="${esc(h.name)}"></td>
        <td>${h.source === 'manual' ? 'Added by hand' : 'Provider'}${h.hidden ? ' · hidden' : ''}</td>
        <td class="row-actions"><button type="button" data-act="rename">Save name</button>
          <button type="button" data-act="${h.hidden ? 'show' : 'hide'}">${h.hidden ? 'Show' : 'Hide'}</button>
          ${h.source === 'manual' ? '<button type="button" class="danger" data-act="delete">Delete</button>' : ''}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">No holidays for this year.</td></tr>'}
      </tbody></table></div>
      <p class="muted">Hidden holidays are ignored by planning and stay hidden after a reload from the provider.</p>`;
    const error = panel.querySelector<HTMLElement>('[data-error]')!;

    panel.querySelector<HTMLInputElement>('input[name="year"]')!.addEventListener('change', async (event) => {
      year = Number((event.target as HTMLInputElement).value);
      await draw();
    });
    panel.querySelector('[data-sync]')!.addEventListener('click', async () => {
      try {
        const result = await api<{ added: number; updated: number }>('POST', '/api/holiday-syncs', { year });
        toast(`Loaded holidays: ${result.added} added, ${result.updated} updated.`, undefined, 4000);
        await draw();
      } catch (e) {
        showError(error, e instanceof ApiError && e.code === 'HOLIDAY_PROVIDER_NOT_CONFIGURED'
          ? new Error('No public holiday provider is connected yet. Add holidays by hand for now.')
          : e);
      }
    });
    panel.querySelector<HTMLFormElement>('[data-add]')!.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('POST', '/api/holidays', formValues(event.target as HTMLFormElement));
        await draw();
      } catch (e) {
        showError(error, e);
      }
    });
    panel.querySelector('tbody')!.addEventListener('click', async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
      const row = button?.closest<HTMLTableRowElement>('tr[data-id]');
      if (!button || !row) return;
      const id = row.dataset.id!;
      try {
        if (button.dataset.act === 'rename') await api('PATCH', `/api/holidays/${id}`, { name: row.querySelector<HTMLInputElement>('input[name="name"]')!.value });
        if (button.dataset.act === 'hide' || button.dataset.act === 'show') await api('PATCH', `/api/holidays/${id}`, { hidden: button.dataset.act === 'hide' });
        if (button.dataset.act === 'delete') {
          if (!(await confirmDialog('Delete this holiday?', [], 'Delete'))) return;
          await api('DELETE', `/api/holidays/${id}`);
        }
        await draw();
      } catch (e) {
        showError(error, e);
      }
    });
  };

  await draw();
}
```

`frontend/src/settings/managersTab.ts`:

```ts
import { api, ApiError } from '../api';
import { confirmDialog, esc } from '../dom';
import type { ManagerGrant } from '../types';
import { formValues, showError } from './common';

export async function renderManagers(panel: HTMLElement): Promise<void> {
  const { managers, note } = await api<{ managers: ManagerGrant[]; note: string }>('GET', '/api/managers');
  panel.innerHTML = `<p class="muted">${esc(note)}</p>
    <div class="panel-head"><form data-add><label>Email of someone on the roster<input type="email" name="email" required></label><button class="primary">Grant manager access</button></form></div>
    <div data-error></div>
    <div class="table-wrap"><table><thead><tr><th>Email</th><th>Granted by</th><th>Since</th><th></th></tr></thead><tbody>
    ${managers.map((m) => `<tr><td>${esc(m.email)}</td><td>${esc(m.granted_by)}</td><td>${esc(m.granted_at.slice(0, 10))}</td>
      <td><button type="button" class="danger" data-email="${esc(m.email)}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nobody is listed yet.</td></tr>'}
    </tbody></table></div>`;
  const error = panel.querySelector<HTMLElement>('[data-error]')!;

  panel.querySelector<HTMLFormElement>('[data-add]')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('POST', '/api/managers', formValues(event.target as HTMLFormElement));
      await renderManagers(panel);
    } catch (e) {
      showError(error, e);
    }
  });
  panel.querySelector('tbody')!.addEventListener('click', async (event) => {
    const email = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-email]')?.dataset.email;
    if (!email || !(await confirmDialog(`Revoke manager access for ${email}?`, [], 'Revoke'))) return;
    const path = `/api/managers/${encodeURIComponent(email)}`;
    try {
      await api('DELETE', path);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'LAST_MANAGER')) {
        showError(error, e);
        return;
      }
      // FR-ACC-03 AC3: warn the last listed manager before they remove themselves.
      if (!(await confirmDialog('You are the last listed Planning Manager', [e.message], 'Remove me anyway'))) return;
      await api('DELETE', `${path}?confirm=true`);
    }
    await renderManagers(panel);
  });
}
```

`encodeURIComponent` turns `@` into `%40`. `Request::fromGlobals()` runs `rawurldecode()` on the path, so `ManagerController` receives the plain email.

- [ ] **Step 4: Run tests and type check**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Check every tab by hand**

As an admin dev identity, check each tab:
- **General:** set the country to `MY`, the region to `MY-10` and the time zone to `Asia/Kuala_Lumpur`.
- **Roles:** add, rename, recolour, archive, then restore a role.
- **Employees:** give someone two roles and a default role, then set Mon–Fri `09:00-13:00, 14:00-18:00`. Type `9-5` and check that the error names the day. Then switch to flexible hours.
- **Time off:** record, edit and delete leave. Check that the leave shows as a hatched band on the schedule.
- **Holidays:** add one by hand, rename it, hide it and delete it. Check that "Load public holidays" explains that no provider is connected yet (OI-02).
- **Managers:** grant access to a roster email. Revoke your own grant while you're the only listed manager and your dev role is `user`, and check that the warning appears.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/settings
git commit -m "feat: add settings screens for roles, employees, time off, holidays and managers"
```

---

### Task 24: Deployment, demo data, performance check and acceptance run

**Files:**
- Create: `bin/seed-demo.php`, `bin/time-schedule.sh`, `README.md`
- Modify: `vercel.json` (final check), `.env.example` (final check)

**Interfaces:**
- Consumes: the whole app.
- Produces:
  - A deployed service on Vercel in region `sin1`.
  - The measurements for NFR-01 and NFR-02.
  - A completed acceptance checklist.

- [ ] **Step 1: Add the demo seed (NFR-01 data set)**

`bin/seed-demo.php`:

```php
<?php

declare(strict_types=1);

// Loads 50 employees, 3 roles and 300 shifts into the current week, for
// performance checks and demos. Refuses to run without the explicit flag so it
// can never be pointed at real data by accident.
//
// Usage: php bin/seed-demo.php --yes-this-is-a-demo-database
require __DIR__ . '/../backend/bootstrap.php';

use Planning\App;
use Planning\Support\Time;
use Planning\Support\Uuid;

if (!in_array('--yes-this-is-a-demo-database', $argv, true)) {
    fwrite(STDERR, "Refusing to run. This inserts demo employees and shifts. Re-run with --yes-this-is-a-demo-database\n");
    exit(1);
}

$app = App::boot();
$pdo = $app->pdo();
$org = $app->organisationId();
$tz = new DateTimeZone($app->settings()->get()['timezone']);
$now = $app->clock()->now();
$monday = (new DateTimeImmutable('monday this week', $tz))->setTime(0, 0);

$roles = [];
foreach (['Technician' => '#16A34A', 'Dispatcher' => '#2563EB', 'Supervisor' => '#9333EA'] as $name => $color) {
    $existing = $pdo->prepare('SELECT id FROM roles WHERE organisation_id = ? AND name = ?');
    $existing->execute([$org, $name]);
    $roles[] = $existing->fetchColumn() ?: $app->roles()->create($name, $color, $now)['id'];
}

$hours = json_encode(array_merge(
    array_fill_keys(['mon', 'tue', 'wed', 'thu', 'fri'], [['09:00', '13:00'], ['14:00', '18:00']]),
    ['sat' => [], 'sun' => []],
));
$directory = $pdo->prepare('INSERT INTO employee_directory (organisation_id, employee_ref, display_name, photo_url, department_id, department_name, status, fetched_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?) AS new ON DUPLICATE KEY UPDATE fetched_at = new.fetched_at');
$shift = $pdo->prepare("INSERT INTO shifts (id, organisation_id, employee_ref, role_id, start_at, end_at, break_minutes, allocated_percent, note, state, published_at, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 60, 100, NULL, ?, ?, 1, 'seed', ?, ?)");

for ($i = 1; $i <= 50; $i++) {
    $ref = sprintf('DEMO-%02d', $i);
    $role = $roles[$i % 3];
    $directory->execute([$org, $ref, "Demo Employee $i", 'DEP-' . ($i % 4), 'Team ' . ($i % 4), 'Active', Time::db($now)]);
    $app->profiles()->save($ref, [$role], $role, null, json_decode($hours, true), $now);
    for ($d = 0; $d < 6; $d++) {
        $day = $monday->modify("+$d days");
        $start = $day->setTime($d === 5 ? 10 : 9, 0);
        $end = $start->modify('+8 hours');
        $published = $d < 3;
        $shift->execute([Uuid::v4(), $org, $i % 10 === 0 && $d === 5 ? null : $ref, $role, Time::db($start), Time::db($end),
            $published ? 'published' : 'draft', $published ? Time::db($now) : null, Time::db($now), Time::db($now)]);
    }
}
echo "Seeded 50 employees and 300 shifts for the week of {$monday->format('Y-m-d')}.\n";
```

`bin/time-schedule.sh`:

```bash
#!/usr/bin/env bash
# Times /health and a week of /api/schedule (NFR-01, NFR-02).
# Usage: BASE_URL=https://planning.example.vercel.app COOKIE='planning_session=...' bin/time-schedule.sh
# Get COOKIE from the browser's devtools after signing in. Locally, omit COOKIE to use the dev identity.
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
FROM="$(date -d 'monday this week' +%F)"
TO="$(date -d 'sunday this week' +%F)"
curl -sI "$BASE_URL/health" | grep -i x-vercel-id || true
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "health   %{http_code} %{time_total}s\n" "$BASE_URL/health"
done
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "schedule %{http_code} %{time_total}s\n" ${COOKIE:+-H "Cookie: $COOKIE"} "$BASE_URL/api/schedule?from=$FROM&to=$TO"
done
```

```bash
chmod +x bin/time-schedule.sh
```

- [ ] **Step 2: Measure locally**

```bash
php bin/seed-demo.php --yes-this-is-a-demo-database
php -S 127.0.0.1:8000 router.php &
bin/time-schedule.sh
```

Expected: `/api/schedule` returns 200 with 50 employees and 300 shifts, and warm runs take well under 500 ms. If a run is slower:
- Check that `idx_shifts_org_time` is used, with `EXPLAIN SELECT ... FROM shifts WHERE organisation_id = ? AND deleted_at IS NULL AND start_at < ? AND end_at > ?`.
- Check that `ScheduleService` runs a fixed number of queries. The count must not grow with the number of employees.

For browser rendering, open `/schedule` with devtools Performance recording. The board must render in 1.5 s or less after the response arrives (NFR-01).

- [ ] **Step 3: Write the README**

`README.md`:

````markdown
# InterlinkERP Planning

Shift planning for the Services department: managers build and publish schedules, employees see their own shifts. Requirements: [ListOfRequirements.md](ListOfRequirements.md). Roadmap: [docs/superpowers/plans/2026-10-13-planning-roadmap.md](docs/superpowers/plans/2026-10-13-planning-roadmap.md).

## Stack
PHP 8.3+ JSON API (no framework), MySQL 8.0.19+, Vite + TypeScript SPA, hosted on Vercel (`vercel-php`, region `sin1`). Sign-in is only through the InterlinkERP gateway.

## Local development
1. `cp .env.example .env`, then set `SESSION_SECRET` (`php -r "echo bin2hex(random_bytes(32));"`) and `OPENAPI_EXTENSION_KEY` (ask the gateway admins; any `x-...` value works locally).
2. `docker compose up -d mysql` (MySQL on port 3307)
3. `composer install && npm install`
4. `php bin/migrate.php`
5. `php -S 127.0.0.1:8000 router.php` and, in another terminal, `npm run dev`
6. Open http://127.0.0.1:5173. Locally you are the `DEV_USER_*` identity from `.env`; it only works from 127.0.0.1 with `APP_ENV=development`.

Optional demo data: `php bin/seed-demo.php --yes-this-is-a-demo-database`.

## Tests
- Backend: `php vendor/bin/phpunit` (needs the docker MySQL).
- Frontend: `npm test` and `npm run typecheck`.

## Deploying
1. Create the production MySQL database (same region as `sin1` if possible) and run `php bin/migrate.php` against it with production `DB_*` variables in your shell.
2. In Vercel, set every variable from `.env.example` except the `DEV_*` ones. Leave `APP_ENV` unset. Set `PUBLIC_URL` to the exact production URL. Set `CRON_SECRET` to a long random value.
3. In the gateway console, issue an API client for Planning with `intern:read` and `department:read`, and put its id and secret in `INTERLINK_CLIENT_ID` / `INTERLINK_CLIENT_SECRET`.
4. Turn off Vercel Deployment Protection for Production (or exempt `/health` and `/openapi.json`); the gateway must reach both.
5. `vercel deploy --prod`, then register the base URL with the gateway and run its `/conformance` check.

## Version
`/health` and `/openapi.json` report `ServiceInfo::VERSION` (`backend/src/Config/ServiceInfo.php`). Change it in the same commit as any API change.
````

- [ ] **Step 4: Deploy and run the acceptance checklist**

Follow the README's deploy steps. Then check every item below on the deployed app and record the results in the PR description:

**Service contract and auth (contract §6, auth guide §9)**
- [ ] `/health` returns 200 with `service: planning-api`. Five runs give p95 ≤ 300 ms warm and every run < 1 s (NFR-02). `x-vercel-id` shows `sin1` as the function region.
- [ ] `/openapi.json` returns 200, and the gateway catalogue shows the "Check Access", "Configure Planning", "Manage Team Profiles", "Track Time Off", "Plan Shifts" and "Share Schedules" capabilities.
- [ ] The gateway's `/conformance` run shows **0 failures**.
- [ ] `curl https://…/api/schedule?from=…&to=…` with no cookie returns 401 with the error envelope. Adding the header `x-authenticated-user: admin@…` still returns 401.
- [ ] `curl https://…/nope` returns 404 with the error envelope.
- [ ] Sign in through the gateway, then open `/schedule` in one tab. Sign out at the gateway in a second tab. Refresh the first tab, and it goes straight to the gateway sign-in (auth guide §5). Press Back, and the planning page does not reappear from cache (§7).
- [ ] The app has no sign-out button anywhere.

**Performance (NFR-01)**
- [ ] With the seed loaded on a demo database, `bin/time-schedule.sh` against production gives `/api/schedule` p95 ≤ 500 ms warm, and the board renders in ≤ 1.5 s.

**Functional spot checks against the spec's acceptance criteria**
- [ ] FR-ACC-02 AC1: a non-manager on the roster lands on My Planning and sees no Schedule or Settings links.
- [ ] FR-ACC-03 AC1–AC3: a gateway admin can grant access; a revoked person becomes an employee on their next request; the last listed manager is warned.
- [ ] FR-SCH-01 AC1–AC2, FR-SCH-06 AC1: rows for everyone, role grouping, and the draft filter keeps every row.
- [ ] FR-SHF-01 AC1–AC2, FR-SHF-03 AC1, FR-SHF-04 AC1, FR-SHF-07 AC1, FR-SHF-09 AC1: as exercised in Task 21 Step 6.
- [ ] FR-PUB-01 AC1: publishing writes one `schedule_published` outbox row per employee. Delivery comes in M2 (see the roadmap).
- [ ] FR-CFG-02 AC1: a never-configured employee shows "Flexible" and no roles.
- [ ] FR-CFG-04 AC2: proven by `HolidaysApiTest`. AC1 waits for OI-02.
- [ ] FR-MYP-02 / NFR-08: My Planning works at 360px; the schedule works at 1024px.

- [ ] **Step 5: Final full run and commit**

```bash
php vendor/bin/phpunit && npm run typecheck && npm test && npm run build
git add bin README.md vercel.json .env.example
git commit -m "docs: add README, demo seed and performance timing script"
```

Expected: everything passes and builds. Then use superpowers:finishing-a-development-branch to open the PR for `feature/m1-foundation`, with the checklist results in its description and no Claude attribution lines.
