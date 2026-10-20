# Planning: improvement backlog

Status as of 2026-10-19 (main at `5790207`, service version 0.2.0). Items are ordered from most to least urgent. Effort: **S** is under half a day, **M** is one to three days, **L** is more than three days.

Sources: the M1 and M2 code reviews, the gateway contract (SS-*), `ListOfRequirements.md` v0.4, and a check of the current code.

---

## P0: Do before production go-live

### 1. Push `main` and back it up (done 2026-10-20)
- **Area:** Operations
- **Done:** `main` is pushed, the `README.md` and `.env.example` edits are committed, and `refactor/planning-ui` is deleted locally and on GitHub.
- **Effort:** S

### 2. Protect `main` and add CI
- **Area:** Operations
- **Why:** Nothing runs automatically. A broken typecheck or a failing test can reach production unnoticed.
- **Fix:**
  - Add a GitHub Actions workflow that runs `npm run typecheck`, `npm test` and `npm run build` on every PR. Give it a Postgres service container for the integration tests.
  - Protect `main`: require PRs and passing CI, and block force-pushes.
  - Turn on "Automatically delete head branches".
- **Effort:** S–M

### 3. Check the M2 screens in a browser
- **Area:** Testing
- **Why:** The bell, open shifts, give-up, the switch marker, the General tab and the publish checkbox have only been unit-tested. None of them has been clicked through in a browser.
- **Fix:** Work through the five-round walkthrough in the README section "Trying the screens as different people", in both light and dark themes.
- **Effort:** S

### 4. Add security headers (done 2026-10-20)
- **Area:** Security
- **Done:** Every response sends HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` (`src/server/web/securityHeaders.ts`). JSON responses send `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. Pages get a per-request nonce policy from `src/proxy.ts`: only nonce-tagged scripts run, and framing is blocked. Inline styles stay allowed because the schedule board positions shifts with them, and employee photos may load from any HTTPS host.
- **Effort:** S

### 5. Cap request body size (done 2026-10-20)
- **Area:** Security
- **Done:** `src/server/http/kernel.ts` rejects a body over 64 KB with `413 PAYLOAD_TOO_LARGE`, whether its size is declared in `Content-Length` or only becomes clear as the chunks arrive. It stops reading at the limit.
- **Effort:** S

### 6. Tie the sign-in `state` to the browser
- **Area:** Security
- **Why:** The OAuth `state` value is not linked to the browser that started sign-in. This allows login CSRF: an attacker could sign a victim in as the attacker.
- **Fix:**
  - Set a short-lived HttpOnly cookie that holds the `state` (or a hash of it) when sign-in starts.
  - Compare it in the callback.
  - First confirm with the gateway owners how they expect `state` to be handled.
- **Effort:** S–M

### 7. Pass the gateway conformance check
- **Area:** Conformance
- **Why:** The gateway's `/conformance` check has never been run against Planning, and the real `OPENAPI_EXTENSION_KEY` is still unknown.
- **Fix:** After the gateway update:
  - Get the extension key from the gateway admins.
  - Register the base URL with the gateway.
  - Run `/conformance` and fix whatever it reports.
- **Effort:** S plus whatever the check finds. **Blocked on:** the gateway update.

### 8. Backups and hosting plan
- **Area:** Operations
- **Why:** No database restore has ever been tested. Vercel Hobby is licensed for non-commercial use only and has tighter cron and function limits.
- **Fix:**
  - Confirm Neon's point-in-time-restore window on your plan.
  - Do one restore into a branch database.
  - Decide between Vercel Pro and Hobby for a company ERP.
- **Effort:** S

### 9. Monitoring and alerts
- **Area:** Operations
- **Why:** Failures are currently invisible:
  - Failed emails only record `last_error` on the outbox row.
  - Cron failures are visible only in Vercel's logs.
- **Fix:** Add both of these:
  - An error tracker, or Vercel log drains with alerts.
  - A daily check that raises an alert when either of these is true:
    - Outbox rows are stuck at `email_attempts >= 5`.
    - `directory.lastFetchedAt` is more than 48 hours old.
- **Effort:** M

---

## P1: Soon after go-live

### 10. Rate-limit write endpoints
- **Area:** Security
- **Why:** Claims, give-ups, notification reads and publications have no rate limit. A single script can flood the outbox and the mail quota.
- **Fix:** Add a per-user token bucket, for example in Postgres or Upstash, that returns `429` with `Retry-After`. Apply it to `POST`, `PATCH` and `DELETE` requests.
- **Effort:** M

### 11. Remove email addresses from framework error logs
- **Area:** Security (DR-02)
- **Why:** Errors thrown while Next.js renders server components go to the log unscrubbed, so they can contain directory email addresses. The API path is already scrubbed.
- **Fix:** Add an `instrumentation.ts` `onRequestError` hook that runs `redactAddresses` before logging.
- **Effort:** S

### 12. Fix cookie and cache headers on error responses
- **Area:** Security
- **Why:**
  - When a session was refreshed during a request that then fails, the new cookie is not sent, so the user is signed out early.
  - When `proxy()` fails while building the app, the response is sent without `no-store`.
- **Fix:** Set these headers in one shared place that every response passes through, error responses included.
- **Effort:** S

### 13. Former managers can still read manager notices
- **Area:** Security
- **Why:** Manager notices are addressed by email. Someone removed from the manager list can still read the past notices sent to them. This is a known limitation in the README.
- **Fix:** When listing notices with `audience = managers`, check that the reader is currently a manager.
- **Effort:** S

### 14. Stop emailing people who have left
- **Area:** Correctness
- **Why:** The directory keeps a `status` for each employee, but `sendEmails` does not check it.
- **Fix:**
  - Skip rows whose directory status is not active and mark them `skipped`.
  - Keep their in-app notices.
- **Effort:** S

### 15. Measure performance in production
- **Area:** Performance (NFR-01/02)
- **Why:** The schedule loaded in 88–173 ms with a 165 KB payload, but that was measured locally. Real figures on Vercel and Neon, including Neon's cold start, are unknown.
- **Fix:** Run `scripts/time-schedule.sh` against production with 50 employees for a week and for a month. Record p50 and p95, both with Neon warm and after Neon has scaled to zero.
- **Effort:** S

### 16. Reduce gateway introspection calls
- **Area:** Performance
- **Why:** Every request introspects the token with the gateway, including each React Server Component prefetch. One page navigation can therefore cost several gateway round-trips.
- **Fix:**
  - Read SS-25 first, to see whether the gateway allows a short cache.
  - If it does, cache successful introspection results for 30–60 seconds, keyed by a hash of the token, in memory per instance.
  - Otherwise, skip introspection for prefetch requests that only reuse an already-verified session.
- **Effort:** M

### 17. Stop running background work for health probes
- **Area:** Performance
- **Why:** The gateway polls `/health`, and every poll schedules the delivery sweep in `after()`.
- **Fix:** Trigger the sweep only for authenticated `/api` requests and for cron.
- **Effort:** S

### 18. Bring list endpoints in line with the gateway's paging rule
- **Area:** Conformance (SS-12)
- **Why:** SS-12 says lists accept `?limit=` and `?offset=`, clamp oversized limits, and return `422` for `limit=0`. No list endpoint in Planning supports these. `/api/notifications` pages with `before` instead.
- **Fix:**
  - Add `limit` and `offset` to the unbounded lists: `/api/employees`, `/api/managers`, `/api/roles` and `/api/notifications`. Keep `before` as an extra option.
  - Ask the gateway owners whether lists bounded by a date range (`/api/schedule`, `/api/unavailabilities`, `/api/holidays`) are exempt.
- **Effort:** M

### 19. Fix small OpenAPI and HTTP differences
- **Area:** Conformance
- **Why:**
  - Person-only routes list `bearerAuth` in the OpenAPI document, but people sign in with the cookie.
  - `HEAD` and `OPTIONS` requests return `405`.
  - Error codes that the contract does not reserve are not documented.
- **Fix:**
  - Correct the security schemes for each access level.
  - Answer `HEAD` the same as `GET`, without a body.
  - Answer `OPTIONS` with an `Allow` header.
  - List the error codes in the OpenAPI document.
- **Effort:** S

### 20. Narrow the proxy matcher
- **Area:** Correctness
- **Why:** The matcher in `src/proxy.ts` covers everything except `_next/static`, `_next/image` and `favicon.ico`. Any future file in `public/` (`robots.txt`, icons, fonts) will get a JSON 404.
- **Fix:** Also exclude common static file extensions in the matcher, or exclude paths that contain a dot.
- **Effort:** S

---

## P2: Next milestone

### 21. End-to-end browser tests
- **Area:** Testing
- **Why:** None exist. UI regressions are caught only by hand.
- **Fix:** Use Playwright against `npm run dev`, with the DEV identity and a seeded test database. Cover four flows: publish a week, employee claims an open shift, give up then take over, and read and mark notices. Run the tests in CI.
- **Effort:** M–L

### 22. Stronger isolation and race tests
- **Area:** Testing
- **Why:**
  - No test proves that one organisation can never see another's data.
  - The concurrency tests depend on timing, so they can pass by luck.
  - The logging in `entry.ts` is untested.
- **Fix:**
  - Add a two-organisation fixture and assert that every repository filters by organisation.
  - Make the race tests deterministic by holding a lock in one connection while the second request runs.
  - Add tests for the `entry.ts` logging.
- **Effort:** M

### 23. Notification retention
- **Area:** Performance and data minimisation
- **Why:** The `notifications` and `outbox` tables grow forever.
- **Fix:** Add a step to the daily cron that deletes read notifications older than 90 days, and delivered or expired outbox rows older than 30 days. Agree on the periods with the data owner.
- **Effort:** S

### 24. Reduce repeated queries
- **Area:** Performance
- **Why:**
  - `pushBadges` reads unread counts one recipient at a time.
  - `available()` re-runs eligibility for each shift.
  - The directory refresh deletes and re-inserts every row, even when only a few changed.
- **Fix:**
  - Read the unread counts in a single grouped query.
  - Use the bulk `eligibleShifts()` in `available()`.
  - Change the directory refresh to an upsert plus a delete of the missing rows.
- **Effort:** M

### 25. Smaller schedule payload
- **Area:** Performance (NFR-02)
- **Why:** One week for 50 people is 165 KB, and a month is about 4× that.
- **Fix:**
  - Drop `working_intervals` when the client can work them out from the profile.
  - Send role names once rather than with every shift.
  - Confirm that Vercel compresses the response.
- **Effort:** S–M

### 26. More dependable email
- **Area:** Reliability
- **Why:**
  - Delivery is at least once, so a crash between sending and recording can send an email twice.
  - Gmail SMTP is capped at about 500 messages a day (about 2,000 on Workspace).
- **Fix:**
  - Set a stable `Message-ID` for each outbox row, so mail clients merge duplicates.
  - Before volume grows, move to a transactional provider such as SES, Postmark or Resend. `SMTP_URL` already allows this without code changes.
- **Effort:** S

### 27. Accessibility
- **Area:** UX (WCAG 2.2 AA)
- **Why:**
  - Field error messages are not linked to their inputs: there is no `aria-invalid` or `aria-describedby`.
  - The bell panel has no focus management and no "load more".
  - `GeneralTab` uses `noValidate` but does not announce its own errors.
- **Fix:**
  - Link each error to its input.
  - Move focus into the bell panel when it opens and back to the bell when it closes, and close it on Esc.
  - Add a "load more" button that uses `before`.
  - Announce form errors in a live region.
- **Effort:** M

### 28. Development tooling advisories
- **Area:** Security (development only)
- **Why:** `npm audit --omit=dev` reports nothing. The full audit reports 7 advisories (2 critical), all in test or build tools that never ship: `tinypool` and `@vitest/mocker` (from Vitest 3), and `esbuild` (from `drizzle-kit`).
- **Fix:**
  - Upgrade to Vitest 4 when convenient.
  - Upgrade `drizzle-kit` when a release bundles a patched esbuild.
  - Keep `pg` on `^8`, because pg 9 rejects parallel queries on one connection.
- **Effort:** S–M

---

## P3: Later or nice to have

### 29. Notification preferences
- **Area:** UX
- **Why:** Employees can't turn off email for a notice type.
- **Fix:** Add a per-person setting for each notice type: in-app plus email, or in-app only.
- **Effort:** M

### 30. Shared delivery throttle
- **Area:** Performance
- **Why:** The 30-second throttle in `DeliveryTrigger` is per server instance. With several instances running, sweeps happen more often than intended. They are safe because of `SKIP LOCKED`, but wasteful.
- **Fix:** Keep a "last swept" timestamp in Postgres and claim it with a conditional `UPDATE`.
- **Effort:** S

### 31. Re-check the narrow races the reviews noted
- **Area:** Correctness
- **Why:** Two narrow timing windows were noted and accepted:
  - Restoring a notice can interleave with a delivery sweep in the same millisecond.
  - A manager editing a shift can interleave with an employee claiming it.
  The version guards prevent corrupt data, so the worst outcome is an unclear error or a notice delivered late.
- **Fix:** Add deterministic tests (see item 22). Make the code change only if a test shows a real problem.
- **Effort:** S

### 32. Identity switcher for local development
- **Area:** Developer experience
- **Why:** Switching between manager and employee views means editing `.env.local` and restarting.
- **Fix:** Add a picker that appears only in development, guarded by the same checks as the DEV identity: `NODE_ENV`, `APP_ENV` and loopback.
- **Effort:** S

### 33. Workspace clean-up
- **Area:** Housekeeping
- **Why:** An empty `.worktrees/m2/.next/dev/node_modules` folder was left behind after the worktree was removed.
- **Fix:** Delete it in File Explorer. Check first that it is not a link to a folder that is still in use.
- **Effort:** S
