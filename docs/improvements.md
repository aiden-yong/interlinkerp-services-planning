# Planning: improvement backlog

Status as of 2026-10-21 (service version 0.4.0, M4 built). Items are ordered from most to least urgent. Effort: **S** is under half a day, **M** is one to three days, **L** is more than three days.

Sources: the M1 and M2 code reviews, the gateway contract (SS-*), `ListOfRequirements.md` v0.5, and a check of the current code.

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

### 9. Monitoring and alerts (check done 2026-10-20; alert service still to choose)
- **Area:** Operations
- **Done:** The daily notifications cron runs `OpsCheck` and logs one `[alert] ...` line for each problem. It checks for emails that failed for good, notices that could not be delivered (both in the last day; skipped emails do not count), and a directory not refreshed for 48 hours. The cron response lists the same alerts.
- **Still to do (yours):** choose where alerts go. For example, a Vercel log drain or an error tracker, with a rule that matches `[alert]` and also flags a failed cron run. No code change is needed.
- **Effort:** M

---

## P1: Soon after go-live

### 10. Rate-limit write endpoints (done 2026-10-20)
- **Area:** Security
- **Done:** Every `POST`, `PUT`, `PATCH` and `DELETE` from a signed-in person or program takes a token from a Postgres bucket (`rate_limits`, migration `0002`). The limit is a burst of 60, then one a second. Over it, the caller gets `429 RATE_LIMITED` with `Retry-After`. Crons and public routes are not limited. If the limiter fails, it lets the request through and logs a line.
- **Effort:** M

### 11. Remove email addresses from framework error logs (done 2026-10-20)
- **Area:** Security (DR-02)
- **Done:** `src/instrumentation.ts` routes `console.error` and `console.warn` through `redactAddresses` on the Node.js runtime, so errors that Next.js logs itself are scrubbed too. The fix covers the logging call itself, not only one hook.
- **Effort:** S

### 12. Fix cookie and cache headers on error responses (done 2026-10-20)
- **Area:** Security
- **Done:** The kernel adds a refreshed session cookie to error responses as well, unless the error clears the session. Every API answer is `Cache-Control: no-store` unless a successful route sets its own caching. If the page gate fails in `src/proxy.ts`, the 500 page is no-store and its log line has email addresses removed.
- **Effort:** S

### 13. Former managers can no longer read manager notices (done 2026-10-20)
- **Area:** Security
- **Done:** Manager notices, which are addressed by email, are listed, counted and marked read only while the reader is a Planning Manager. Badge counts use the current manager list. The README limitation is removed.
- **Effort:** S

### 14. Stop emailing people who have left (done 2026-10-20)
- **Area:** Correctness
- **Done:** The directory refresh already drops anyone who is not Onboarding, Active or Offboarding. When a notice is due for someone no longer on the roster, the email is now marked `Skipped: no longer on the roster.` and not retried. The in-app notice stays.
- **Effort:** S

### 15. Measure performance in production
- **Area:** Performance (NFR-01/02)
- **Why:** The schedule loaded in 88–173 ms with a 165 KB payload, but that was measured locally. Real figures on Vercel and Neon, including Neon's cold start, are unknown.
- **Fix:** Run `scripts/time-schedule.sh` against production with 50 employees for a week and for a month. Record p50 and p95, both with Neon warm and after Neon has scaled to zero.
- **Effort:** S

### 16. Reduce gateway introspection calls (won't do)
- **Area:** Performance
- **Decision:** The auth guide (§5, "check the gateway on every request, no cache") forbids both options. A cache, or skipping prefetches, opens a window in which Planning and the gateway disagree about whether someone is signed out. Revisit only if the gateway owners change that rule.
- **Effort:** M

### 17. Stop running background work for health probes (done 2026-10-20)
- **Area:** Performance
- **Done:** `handleApi` starts the delivery sweep only after `/api/` requests. `/health`, `/openapi.json` and the crons never start it.
- **Effort:** S

### 18. Bring list endpoints in line with the gateway's paging rule (done 2026-10-20)
- **Area:** Conformance (SS-12)
- **Done:** `/api/employees`, `/api/managers` and `/api/roles` accept `limit` and `offset`, defaulting to and clamped at 1,000. They return `pagination: { limit, offset, total }`. `/api/notifications` accepts them too: the default is 50, clamped at 100, and `before` still works. `limit=0` or `offset=-1` returns `422`. Still open: ask the gateway owners whether the date-range lists (`/api/schedule`, `/api/unavailabilities`, `/api/holidays`) are exempt.
- **Effort:** M

### 19. Fix small OpenAPI and HTTP differences (done 2026-10-20)
- **Area:** Conformance
- **Done:** OpenAPI declares `cookieAuth` (the `planning_session` cookie). Manager routes list `bearerAuth` with their scope or the cookie. Person-only routes list only the cookie. `HEAD` answers like `GET` without a body, `OPTIONS` returns `204` with `Allow`, and a 405 `Allow` lists both. Every error code is listed in `components.schemas.ErrorEnvelope`, and `errors.test.ts` keeps that list complete. Check the security change when the gateway conformance run (item 7) happens.
- **Effort:** S

### 20. Narrow the proxy matcher (done 2026-10-20)
- **Area:** Correctness
- **Done:** The matcher also skips common static file types (images, fonts, `txt`, `xml`, `css`, `js`, `map`, `webmanifest`). `src/proxy.test.ts` checks which paths it covers.
- **Effort:** S

---

## P2: Next milestone

### 21. End-to-end browser tests (done 2026-10-20)
- **Area:** Testing
- **Done:** `e2e/flows.spec.ts` runs the four flows in Chromium against `next dev` on port 3200, using the development sign-in and the identity picker's cookie to switch people. The flows are: publish a week, claim an open shift, ask for cover and take it over, and read and mark notices. Every test also fails on a Content-Security-Policy violation in the browser console. CI runs them in a separate "Browser tests" job.
- **Effort:** M–L

### 22. Stronger isolation and race tests (done 2026-10-20)
- **Area:** Testing
- **Done:** `isolation.int.test.ts` fills one organisation through the API and checks that a second organisation, on the same database, sees nothing through any read endpoint. It also checks that it cannot edit, delete, publish or claim the first organisation's shifts. `src/server/test/races.ts` holds a row lock until every racer is blocked on it, so `races.int.test.ts` forces the worst interleaving every time. `entry.test.ts` covers the misconfiguration answer and the once-per-error logging.
- **Effort:** M

### 23. Notification retention (done 2026-10-20)
- **Area:** Performance and data minimisation
- **Done:** After delivering, the daily notifications cron deletes read notices older than 90 days, delivered or cancelled outbox rows older than 30 days, and rate-limit buckets idle for a day (`src/server/notifications/retention.ts`). Unread notices are kept. Still to do: confirm the periods with the data owner. They are one constant.
- **Effort:** S

### 24. Reduce repeated queries (done 2026-10-20)
- **Area:** Performance
- **Done:** `pushBadges` reads every unread count in two grouped queries (`unreadCounts`). The directory refresh updates rows in place and deletes only people who left. `available()` already used the bulk `eligibleShifts()`.
- **Effort:** M

### 25. Smaller schedule payload (checked, no change)
- **Area:** Performance (NFR-02)
- **Finding:** Role names are already sent once (shifts carry only `role_id`), and the shifts themselves are most of the payload. `working_intervals` is about a tenth of it, and working them out in the browser would mean shipping Luxon and duplicating server rules. Vercel compresses JSON responses automatically. When measuring production (item 15), confirm `content-encoding: br` or `gzip` on `/api/schedule`.
- **Effort:** S–M

### 26. More dependable email (done 2026-10-20)
- **Area:** Reliability
- **Done:** Each email carries a stable `Message-ID` (`<notice-{id}@{public host}>`), so a resend after a crash shows up as the same message. Moving to a transactional provider (SES, Postmark, Resend) is your decision; it needs only a new `SMTP_URL`.
- **Effort:** S

### 27. Accessibility (done 2026-10-20)
- **Area:** UX (WCAG 2.2 AA)
- **Done:** Every form field with an error gets `aria-invalid` and `aria-describedby`, pointing at its message. Field and form errors use `role="alert"`, so they are announced when they appear (`src/client/fields.tsx`). The bell already moved focus into the panel, returned it on Esc and closed on Esc; it now also has a "Load older" button that pages with `before`.
- **Effort:** M

### 28. Development tooling advisories (mostly done 2026-10-20)
- **Area:** Security (development only)
- **Done:** Vitest is upgraded to 5, which removes both critical `tinypool` advisories and the `@vitest/mocker` one. Integration files now run one at a time through `fileParallelism: false`, because Vitest 4 dropped `poolOptions`. `next` (16.4.2), `nodemailer` (10.1.7) and `jsdom` have patch updates. `npm audit --omit=dev` reports 0. `pg` stays on `^8`.
- **Still open:** 4 moderate advisories in the esbuild copy that `drizzle-kit` 0.31.11 (its latest release) bundles through `@esbuild-kit`. They are development-only. Upgrade `drizzle-kit` once a release drops `@esbuild-kit`.
- **Effort:** S–M

---

## P3: Later or nice to have

### 29. Notification preferences (done 2026-10-20)
- **Area:** UX
- **Done:** "Email settings" in the bell panel lists the notice types the person receives, employee and manager types separately. Each can be in-app plus email (the default) or in-app only. They are stored in `email_opt_outs` (migration `0003`) and served by `GET` and `PATCH /api/my/notification-preferences`. The email step marks a muted notice `Skipped: email turned off for this notice type.` and keeps the in-app notice.
- **Effort:** M

### 30. Shared delivery throttle (done 2026-10-20)
- **Area:** Performance
- **Done:** `DeliveryTrigger` claims the `delivery` row in `job_runs` with one conditional upsert, so all instances together sweep at most once per 30 seconds. If the table cannot be read, the instance sweeps anyway, as before.
- **Effort:** S

### 31. Re-check the narrow races the reviews noted (done 2026-10-20)
- **Area:** Correctness
- **Done:** The forced tests found one real problem. If the delivery sweep sent the "shift deleted" notice at the same moment a manager pressed Undo, the undo still succeeded, and the employee was told about a deletion that had been undone. The undo now returns `409 UNDO_EXPIRED` in that case and the shift stays deleted. A manager edit racing an employee claim was already safe: one wins and the other gets a clear `409`.
- **Effort:** S

### 32. Identity switcher for local development (done 2026-10-20)
- **Area:** Developer experience
- **Done:** A "Dev:" picker in the top bar sets a `planning_dev_as` cookie and reloads. Choices: the `.env.local` identity, a Planning Manager, or any employee in the directory. The server honours the cookie only through `DevIdentity`, so only under `next dev` with `APP_ENV=development`, never on Vercel, and only from loopback. `/internal/dev/identities` answers 404 everywhere else.
- **Effort:** S

### 33. Workspace clean-up (done 2026-10-20)
- **Area:** Housekeeping
- **Done:** The leftover `.worktrees` folder is deleted. Its two links pointed into the removed worktree.
- **Effort:** S

### 34. "Add shift" silently does nothing right after changing the schedule's period (done 2026-10-23)
- **Area:** UX
- **Why:** `SchedulePage.tsx`'s `openNew()` guards with `if (!data) return;`, but the toolbar's "Add shift", "Publish" and "Copy previous week" buttons are never disabled while a period change's `GET /api/schedule` is still in flight. A manager who clicks fast enough after "Next period" gets no dialog, no toast, nothing — a silent dead click. Found while writing M3's browser tests (the repeat-setup test needed to wait for the board to render before clicking "Add shift").
- **Done:** Add shift, Publish, Copy previous week and Auto Plan are now disabled until the schedule for the shown period has loaded (including while a period change is loading), so there is no silent dead click.
- **Effort:** S

### 35. A repeating shift's pattern change can resurrect an old date if the recurrence horizon was shrunk first (done 2026-10-23)
- **Area:** Correctness, narrow edge case
- **Why:** `splitSeries` skips calendar dates already occupied by a surviving (published/detached) or soft-deleted old-series shift, by checking the old series' own current rows (D4's "a deleted occurrence must not come back" promise). But if the horizon was shrunk *after* the old series was generated and *before* the pattern change, the old series' surviving rows only reach as far as whatever horizon was in force when they were made. A later extension of the *new* series has no knowledge of those old dates and can generate onto one of them. Requires: generate a series under a larger horizon, shrink the horizon, split the series with a pattern change, then let the new series extend past the old one's last generated date.
- **Done:** A series now remembers the series it was split from (`recurrences.predecessor_id`, migration 0006). `extendOne` skips any date on which a series in that chain holds a shift row (live, published/detached or deleted), so a later extension can no longer land on an old date.
- **Effort:** M

### 36. A repeat-N-times pattern change can under-count when dates collide with old shifts (done 2026-10-23)
- **Area:** Correctness, narrow edge case
- **Why:** When `splitSeries` skips a calendar date already occupied by a surviving old-series shift (item 35's mechanism, working as intended), that skipped step still counts against an `ends: 'after'` count budget, because the generator counts every non-month-skipped step regardless of whether `splitSeries` later discards it. A manager asking for "10 more shifts" can get fewer than 10 new drafts when some of those dates were already taken. Never duplicates or resurrects a shift — only under-generates.
- **Done:** Dates skipped because an old-series shift holds them no longer use up an `ends: 'after'` count: the generator is asked for more steps until N new shifts exist (bounded by the per-run cap), at the split and on later extensions.
- **Effort:** S

### 37. Two managers editing the same repeating series within milliseconds can deadlock (done 2026-10-23)
- **Area:** Reliability, narrow edge case
- **Why:** `update()`'s transaction locks the edited shift's own row, then (for `following`/`all`) waits on the series' advisory lock inside `applyToSeries`/`splitSeries`. `deleteFrom` takes the series lock first, then needs the edited shift's row lock. Two requests on the same series, one PATCHing and one DELETEing (or two PATCHes) within the same window, can each hold what the other needs. Postgres detects this and aborts one with a deadlock error; there is no handling for that error code, so the aborted request gets a 500 instead of a clean, retryable error. No data is corrupted — the losing transaction never commits.
- **Done:** `ShiftService.update()` takes the series lock before touching any row of a series shift, and a series delete takes it before reading the shifts, so every series path locks series first, then rows. As a safety net the kernel maps Postgres deadlock (`40P01`) and serialization failure (`40001`) to `503 TRY_AGAIN` with `Retry-After: 1`.
- **Effort:** S

### 38. Resuming (re-patterning) a series whose tail was deleted leaves a calendar gap (done 2026-10-23)
- **Area:** UX, narrow edge case
- **Why:** If a manager does "Delete this and following" from a later point in a series, then later changes the pattern starting from an earlier, still-live point, item 3's fix (skip dates an old-series shift already occupies, soft-deleted ones included) correctly refuses to resurrect the deleted dates — but it keeps refusing them all the way out to the old horizon, so the new series generates nothing for however many months that spans, then resumes abruptly. No data is lost or duplicated; it is a defensible reading of "a deleted occurrence must not come back," but a manager who intentionally ended a series and later wants to restart its pattern from an earlier point would see a confusing silent gap with no explanation in the UI.
- **Done:** Only dates on which a series in the predecessor chain actually holds a shift row count as occupied (all of its rows, deleted ones included, so D4 still holds); dates beyond what the old series generated are free, so a restarted pattern resumes without a gap there. Existing series have no predecessor (no back-fill).
- **Effort:** M

### 39. A pattern change with scope "all" has a narrow window where an undone deletion could still land on the wrong shift (done 2026-10-23)
- **Area:** Correctness, narrow edge case
- **Why:** The "all" + pattern-change guard (item 2's fix) checks that the edited shift is the series' first not-started occurrence once, outside the transaction. If an earlier occurrence is restored via `POST /api/shift-restorations` (available for 30 seconds after a delete) in the narrow window between that check and the transaction committing, the original item-2 bug (deleting drafts before the edited shift without regenerating them) could still occur. Needs a concurrent restore landing in that exact window.
- **Done:** `update()` recomputes `firstNotStartedIndex` inside the transaction, after `lockSeries` and before any row is written, and refuses with the same `RECURRENCE_PATTERN_SCOPE` error when the edited shift is no longer the earliest open one.
- **Effort:** S

---

## P4: Skipped on purpose (deferred features and open decisions)

Things a milestone design left out or a decision put off. None is a defect. Pick them up when a customer asks or a later milestone needs them.

### 40. External scheduler for the notification sweep (M4 D26)
- **Area:** Operations
- **Why:** Vercel Hobby crons run once a day, but shift reminders (FR-NTF-05) need a sweep every few minutes. Decided 2026-10-21: a free external scheduler (for example cron-job.org) calls `/internal/cron/sweep` with `CRON_SECRET` every 5 minutes.
- **Fix:** Set it up once M4 is deployed. If hosting moves (Hostinger is being considered; see item 8), point that host's scheduler at the same route instead.
- **Effort:** S

### 41. Undo an Auto Plan run (M4 D15)
- **Area:** Feature
- **Why:** Every result is a draft the manager can change before publishing, so undo was left out of the first version.
- **Effort:** M

### 42. Auto Plan options (M4)
- **Area:** Feature
- **Why:** Auto Plan runs on the period on screen only and always spreads load evenly (OI-04). Not offered: several periods at once, or "fill one person first".
- **Effort:** M

### 43. Reporting extras (M4)
- **Area:** Feature
- **Why:** Reports group by one level only and show tables only. Not offered: nested grouping (for example department, then role) and charts.
- **Effort:** M

### 44. Organisation-wide audit log screen (M4 D17)
- **Area:** Feature
- **Why:** The audit trail shows per shift in the shift dialog. There is no screen to search all changes.
- **Effort:** M

### 45. Per-employee reminder lead times (M4 D24)
- **Area:** Feature
- **Why:** There is one organisation-wide lead time. Employees can only turn reminder emails off, not choose their own lead time.
- **Effort:** S

### 46. Repeat on chosen weekdays (M3)
- **Area:** Feature
- **Why:** A repeat follows one interval (every N days, weeks or months). "Monday, Wednesday and Friday" needs three weekly series today. A weekday list can be added without changing how deleted occurrences are kept from coming back (M3 D4).
- **Effort:** M

### 47. Undo for series deletes (M3 D7)
- **Area:** Feature
- **Why:** Deleting "this and following" or "all" is confirmed but has no undo, unlike a single shift's 30-second undo.
- **Effort:** M

### 48. Templates that span several shifts (M3)
- **Area:** Feature
- **Why:** A template makes one shift. A whole day's pattern (for example opening, middle and closing shifts) is not supported.
- **Effort:** M

### 49. Push notifications and a gateway "nudge" (M2)
- **Area:** Feature
- **Why:** Notices arrive in the app inbox, as gateway badges and by email. Browser push and a gateway pop-up wait on the gateway's notification protocol (OI-07).
- **Effort:** M

### 50. Automatic public holidays (OI-02)
- **Area:** Integration
- **Why:** Only manual holidays work until a provider is chosen. Nager.Date has no Malaysia data; Calendarific and others need checking for state-level coverage and cost. Choosing one completes FR-CFG-04 AC1 (one adapter class plus its environment variables).
- **Effort:** S once a provider is chosen

### 51. HR leave service (OI-01)
- **Area:** Integration
- **Why:** Planning stores time off itself until an HR leave service exists. Then the time-off reads are replaced with an adapter for that service (DR-03 keeps this contained).
- **Effort:** M

### 52. Auto Plan is not locked against a manager's concurrent edits
- **Area:** Correctness (narrow edge case)
- **Why:** Auto Plan holds its own lock and the candidates' employee locks, so claims and take-overs are serialised. A manager edit or a time-off change made between Auto Plan's data load and its write is not. The schedule still flags any resulting conflict before publishing.
- **Fix:** Take the employee lock in manager shift writes too, or re-read time off inside the transaction.
- **Effort:** S–M

### 53. Audit conflict acknowledgements
- **Area:** Feature
- **Why:** A PATCH that only acknowledges a conflict records no history entry, though overriding a planning rule is what a manager may look for in history.
- **Fix:** Record `conflict_acknowledged` as an audited field.
- **Effort:** S
