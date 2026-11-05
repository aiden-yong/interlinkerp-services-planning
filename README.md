# InterlinkERP Planning

Shift planning for the Services department: managers build and publish schedules, employees see their own shifts. Requirements: [ListOfRequirements.md](ListOfRequirements.md). Roadmap: [docs/superpowers/plans/2026-10-13-planning-roadmap.md](docs/superpowers/plans/2026-10-13-planning-roadmap.md).

## Stack
Next.js 16 (App Router) + React 19 + TypeScript, Drizzle ORM, PostgreSQL (local 18, Neon in production), Vercel region `sin1`. Sign-in is only through the InterlinkERP gateway (the [hosted demo](#hosted-demo) has its own landing page instead).

## Local development
1. PostgreSQL 18 runs locally. Create the role and databases once:
   `psql -U postgres -h localhost -c "CREATE ROLE planning LOGIN PASSWORD 'planning-dev-only';" -c "CREATE DATABASE planning OWNER planning;" -c "CREATE DATABASE planning_test OWNER planning;"`
2. `cp .env.example .env.local`, then set `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. `npm install`
4. `npm run db:migrate`
5. `npm run dev`, then open http://127.0.0.1:3000. Locally you are the `DEV_USER_*` identity from `.env.local`. To see Planning as someone else, use the "Dev:" picker in the top bar. It switches between that identity, a Planning Manager and any employee in the directory, without editing `.env.local` or restarting. It exists only under `npm run dev` on 127.0.0.1.

Optional demo data: `npm run db:seed-demo -- --yes-this-is-a-demo-database`. Browse the data with pgAdmin 4. To time the schedule endpoint, run `scripts/time-schedule.sh` while the dev server is up.

## Database changes
Edit `src/server/db/schema.ts`, run `npm run db:generate`, read the new SQL in `drizzle/`, then `npm run db:migrate`. Commit the generated files. Never edit a migration that has been applied anywhere.

## Tests
`npm test` runs everything. `npm run test:unit` needs nothing; `npm run test:integration` needs the local `planning_test` database. `npm run typecheck` for types.

My Planning is a calendar with Day, Week, Month and Year views. Clicking a shift opens its details and actions, and the keys D, W, M, Y, T and the arrow keys work as in Google Calendar.

Browser tests (Playwright) cover ten flows: publish a week, claim an open shift, ask for cover and take it over, read notices, repeat a shift weekly, copy the previous week, run Auto Plan, download a planned-hours CSV, open a month from the Year scale, and fetch an employee's calendar file. Run `npx playwright install chromium` once, then `npm run test:e2e`. They start their own `next dev` on port 3200 (building into `.next-e2e`, so your dev server on 3000 is untouched), use `TEST_DATABASE_URL`, and fail if the browser logs a Content-Security-Policy violation.

## Deploying
1. Neon project in `aws-ap-southeast-1`; apply migrations with its pooled URL (`DATABASE_URL=... npm run db:migrate`).
2. In Vercel, import the repo and set every variable from `.env.example` except `DEV_*`, `TEST_DATABASE_URL` and `APP_ENV`. `DATABASE_URL` is Neon's pooled URL; `PUBLIC_URL` is the exact production URL; `CRON_SECRET` is a long random value. Sign-in requires the gateway to return `state` unchanged; only if it does not, set `SIGNIN_STATE_OPTIONAL=1` (weaker login-CSRF protection). `OPENAPI_EXTENSION_KEY` is the extension key the gateway reads catalogue metadata from; get the exact value from the gateway admins.
3. In the gateway console, issue an API client for Planning with `intern:read` and `department:read`, and set `INTERLINK_CLIENT_ID` / `INTERLINK_CLIENT_SECRET`.
4. Turn off Vercel Deployment Protection for Production (or exempt `/health` and `/openapi.json`; the gateway must reach both). Also exempt `/feeds/*` (calendar apps subscribe there without a session) and `/internal/cron/sweep` (the external scheduler calls it), otherwise calendar subscriptions and shift reminders silently fail.
5. Deploy, then register the base URL with the gateway and run its `/conformance` check.

## Style guide

[Styles.md](Styles.md) is the guide every InterlinkERP app shares. `src/styleGuide.test.ts` fails when this app's tokens drift from it. Change it together with the copy in the HR recruitment repo.

## Hosted demo

A public copy of the app that anyone can explore without a gateway account, for example from a portfolio. It's a separate Vercel project from the same repo, with its own database.

With `DEMO_MODE=true` ([src/server/demo/demo.ts](src/server/demo/demo.ts)):

- **Look:** it opens in light mode unless the visitor has chosen otherwise.
- **Sign-in:** a landing page that introduces the project replaces the gateway sign-in, and **Explore the demo** goes straight in. The gateway is never contacted, for pages, sessions, tokens or badges, so the demo works while the gateway is down. Visitors choose a view on the landing page and can switch in the profile menu: "Demo Manager" is both a Planning Manager and on the roster, so reaches every screen, and "Nadia Rahman" is a sample employee with My Planning only.
- **Email:** nothing is sent, whatever the mail settings say.
- **Sample data:** the first visit loads 12 fictional people, 5 roles and ten weeks of shifts around today, with open shifts for Auto Plan and claiming, a switch request, flagged conflicts, a repeating series, time off, holidays, templates and notices ([src/server/demo/sampleData.ts](src/server/demo/sampleData.ts)). Shift dates are relative to the week they're loaded, so the first sign-in of each new week replaces the sample data and the board always opens on a full week. Visitors' changes last until then.
- **Profile menu:** switch between the manager and employee views, **Reset demo data** to restore the sample data for everyone, and **Sign out**.
- **Safety:** there's no password, so demo mode only switches on when the database name in `DATABASE_URL` contains `demo`. Otherwise every page and API call answers with a configuration error instead of the app, and a `DEMO_MODE` copied into production can't open real data.

### Set it up

1. **Create a free PostgreSQL database.** For example, a new [Neon](https://neon.tech) project in `aws-ap-southeast-1`, next to Vercel's `sin1`, with a database named `planning_demo`. Keep it separate from production.
2. **Create a second Vercel project** from the same GitHub repo, for example `interlinkerp-planning-demo`. Don't use the production project or its previews: the demo needs its own environment variables. Turn off Deployment Protection, so visitors don't meet a Vercel login.
3. **Set its Build Command to `npm run build:demo`.** It applies the migrations to the demo database, then builds. It refuses any database whose name doesn't contain `demo`.
4. **Set its environment variables:**

   | Variable | Value |
   | :--- | :--- |
   | `DEMO_MODE` | `true` |
   | `DEMO_CREDIT_NAME` / `DEMO_CREDIT_URL` | optional "Built by" line on the landing page, such as your name and an `https://` portfolio or GitHub link |
   | `DATABASE_URL` | Neon's pooled URL for the demo database (the name must contain `demo`) |
   | `SESSION_SECRET` | a new random value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `PUBLIC_URL` | the demo's address, such as `https://interlinkerp-planning-demo.vercel.app` |
   | `SERVICE_ID` | `planning-api` |
   | `OPENAPI_EXTENSION_KEY` | any `x-` value, such as `x-demo` |
   | `DEFAULT_TIMEZONE` | `Asia/Kuala_Lumpur` |

5. **Deploy and open the demo.** The first **Explore the demo** takes a few seconds while it loads the sample data.

Leave `GATEWAY_URL`, `INTERLINK_CLIENT_*`, `INTERN_DATABASE_URL`, `DEPARTMENT_API_URL`, `SMTP_URL` and `MAIL_FROM` unset. The daily crons in `vercel.json` also answer 401 and do nothing without `CRON_SECRET`, so leave that unset too.

To change the demo's link preview, edit `PAGE_TITLE` and `PAGE_DESCRIPTION` at the top of [src/server/demo/landing.ts](src/server/demo/landing.ts), or replace `public/og-image.png` (1200×630). `PUBLIC_URL` must be set, because the preview image needs an absolute address.

To reload the sample data from your own machine, point `DATABASE_URL` at the demo database and run `npm run demo:reset`. To run the demo locally, set `DEMO_MODE=true` and a local database with `demo` in its name, then `npm run dev`.

## Changes after 0.2.0 (not yet released)
Apply the new migrations to the production database BEFORE deploying: `DATABASE_URL='<pooled url>' npm run db:migrate`. Locally, run `npm run db:migrate`.
- `0002` adds `rate_limits` (each person or program may make 60 changes in a burst, then one a second; over that they get `429` with `Retry-After`) and `job_runs` (one delivery sweep per 30 seconds across all instances). If the code is deployed first, both features fail open and log a line until the migration runs.
- `0003` adds `email_opt_outs`: people can turn email off per notice type from "Email settings" in the bell. In-app notices always arrive.
- The daily notifications cron also deletes read notices older than 90 days, finished outbox rows older than 30 days and idle rate-limit buckets. Its response now includes `pruned` counts and `alerts`. Each alert is also logged as a line starting with `[alert]` (failed emails, undeliverable notices, a directory older than 48 hours), so log alerts can match it.
- `0004` adds `recurrences` and `shift_templates`, four new columns on `shifts` (`recurrence_id`, `recurrence_index`, `recurrence_detached`, `copied_from`), and `organisation_settings.recurrence_horizon_months` (1–24, default 6).
- Shifts can now repeat daily, weekly or monthly, and an edit or delete on a repeated shift can apply to "this", "this and following" or "all" occurrences. Shift templates (Settings → Templates) fill in a shift's role, time and break in one click. "Copy previous week" on the schedule toolbar duplicates last week's one-off shifts into this week as drafts. A shift can also be split into two from its edit dialog.

## Changes after 0.3.0 (M4, service version 0.4.0; 0.4.1 adds the `TRY_AGAIN` error code, migration `0006` and `SIGNIN_STATE_OPTIONAL`)
Apply the new migration to the production database BEFORE deploying: `DATABASE_URL='<pooled url>' npm run db:migrate`. Locally, run `npm run db:migrate`.
- `0005_reporting_audit_feeds` adds the audit trail for shifts, the private calendar feed tokens and `organisation_settings.reminder_lead_minutes` (0, 30, 60, 120, 240, 720 or 1440 minutes; default 60; 0 turns reminders off). Change it in Settings → General, "Remind employees before their shifts". It also adds `shifts.reminded_at` (set once a reminder is queued) and back-fills audit history for existing shifts, one INSERT per shift, so the migration takes longer on a large database.
- `0006_series_predecessor` adds the nullable `recurrences.predecessor_id` (the series a repeating shift was split from by a pattern change) and an index on it. Existing series get null. Apply it to production before deploying; until then, every read and write of repeating shifts fails on the missing column.
- M4 adds: a Reports page (planned hours, utilisation and open shifts, each with CSV download); Auto Plan on the schedule, which fills draft open shifts and spreads load evenly; a Year scale and grouping by department on the schedule; a change history per shift; a private iCalendar link for each employee ("Get calendar link" on My Planning); and shift reminders.
- Auto Plan leaves every result as a draft. Published open shifts are left for employees to claim.

## External scheduler for reminders
Reminders and due notices are sent by `GET /internal/cron/sweep`. Vercel Hobby crons run only once a day, so a free external scheduler calls the route every 5 minutes. With cron-job.org:
1. Create a cron job with the URL `https://<host>/internal/cron/sweep` and a schedule of every 5 minutes.
2. Under the advanced settings add the header `Authorization: Bearer <CRON_SECRET>` (the same value as in Vercel).
3. Save, then run it once and check that the response is `200`.

The route is plain HTTP, so any scheduler can call it, for example one on Hostinger if hosting moves. The daily check raises an alert when the sweep has not run for 30 minutes.

## Upgrading to 0.2.0 (M2)
Do these in order:
1. Apply the new migration to the production database BEFORE deploying the new code: `DATABASE_URL='<pooled url>' npm run db:migrate`. After merging, also run `npm run db:migrate` on your local dev database.
2. In Vercel set `SMTP_URL` and `MAIL_FROM` (leave them unset to only log mail). Keep `GATEWAY_BADGES=off` until the gateway exposes `/api/badges` (OI-07).
3. Deploy.
4. Immediately call `GET /internal/cron/directory` with `Authorization: Bearer $CRON_SECRET`, so the directory gets employee emails. Until then queued emails wait one hour at a time instead of being lost.
5. Notices queued before the upgrade whose shifts are already over are dropped automatically (marked `expired`); later ones are delivered.
6. A second cron, `/internal/cron/notifications` (daily at 18:30 UTC), now exists. Notices are mainly delivered shortly after each request.
7. Shift reminders need an external scheduler; see "External scheduler for reminders" above.

## Version
`/health` and `/openapi.json` report `SERVICE_VERSION` (`src/server/config/serviceInfo.ts`). Change it in the same commit as any API change.
