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
5. `npm run dev`, then open http://127.0.0.1:3000. Locally you are the `DEV_USER_*` identity from `.env.local`. To see Planning as someone else, use the "Dev:" picker in the top bar. It switches between that identity, a Planning Manager and any employee in the directory, without editing `.env.local` or restarting. It exists only under `npm run dev` on 127.0.0.1.

Optional demo data: `npm run db:seed-demo -- --yes-this-is-a-demo-database`. Browse the data with pgAdmin 4. To time the schedule endpoint, run `scripts/time-schedule.sh` while the dev server is up.

## Database changes
Edit `src/server/db/schema.ts`, run `npm run db:generate`, read the new SQL in `drizzle/`, then `npm run db:migrate`. Commit the generated files. Never edit a migration that has been applied anywhere.

## Tests
`npm test` runs everything. `npm run test:unit` needs nothing; `npm run test:integration` needs the local `planning_test` database. `npm run typecheck` for types.

Browser tests (Playwright) cover six flows: publish a week, claim an open shift, ask for cover and take it over, read notices, repeat a shift weekly, and copy the previous week. Run `npx playwright install chromium` once, then `npm run test:e2e`. They start their own `next dev` on port 3200 (building into `.next-e2e`, so your dev server on 3000 is untouched), use `TEST_DATABASE_URL`, and fail if the browser logs a Content-Security-Policy violation.

## Deploying
1. Neon project in `aws-ap-southeast-1`; apply migrations with its pooled URL (`DATABASE_URL=... npm run db:migrate`).
2. In Vercel, import the repo and set every variable from `.env.example` except `DEV_*`, `TEST_DATABASE_URL` and `APP_ENV`. `DATABASE_URL` is Neon's pooled URL; `PUBLIC_URL` is the exact production URL; `CRON_SECRET` is a long random value. `OPENAPI_EXTENSION_KEY` is the extension key the gateway reads catalogue metadata from; get the exact value from the gateway admins.
3. In the gateway console, issue an API client for Planning with `intern:read` and `department:read`, and set `INTERLINK_CLIENT_ID` / `INTERLINK_CLIENT_SECRET`.
4. Turn off Vercel Deployment Protection for Production (or exempt `/health` and `/openapi.json`); the gateway must reach both.
5. Deploy, then register the base URL with the gateway and run its `/conformance` check.

## Changes after 0.2.0 (not yet released)
Apply the new migrations to the production database BEFORE deploying: `DATABASE_URL='<pooled url>' npm run db:migrate`. Locally, run `npm run db:migrate`.
- `0002` adds `rate_limits` (each person or program may make 60 changes in a burst, then one a second; over that they get `429` with `Retry-After`) and `job_runs` (one delivery sweep per 30 seconds across all instances). If the code is deployed first, both features fail open and log a line until the migration runs.
- `0003` adds `email_opt_outs`: people can turn email off per notice type from "Email settings" in the bell. In-app notices always arrive.
- The daily notifications cron also deletes read notices older than 90 days, finished outbox rows older than 30 days and idle rate-limit buckets. Its response now includes `pruned` counts and `alerts`. Each alert is also logged as a line starting with `[alert]` (failed emails, undeliverable notices, a directory older than 48 hours), so log alerts can match it.
- `0004` adds `recurrences` and `shift_templates`, four new columns on `shifts` (`recurrence_id`, `recurrence_index`, `recurrence_detached`, `copied_from`), and `organisation_settings.recurrence_horizon_months` (1–24, default 6).
- Shifts can now repeat daily, weekly or monthly, and an edit or delete on a repeated shift can apply to "this", "this and following" or "all" occurrences. Shift templates (Settings → Templates) fill in a shift's role, time and break in one click. "Copy previous week" on the schedule toolbar duplicates last week's one-off shifts into this week as drafts. A shift can also be split into two from its edit dialog.

## Upgrading to 0.2.0 (M2)
Do these in order:
1. Apply the new migration to the production database BEFORE deploying the new code: `DATABASE_URL='<pooled url>' npm run db:migrate`. After merging, also run `npm run db:migrate` on your local dev database.
2. In Vercel set `SMTP_URL` and `MAIL_FROM` (leave them unset to only log mail). Keep `GATEWAY_BADGES=off` until the gateway exposes `/api/badges` (OI-07).
3. Deploy.
4. Immediately call `GET /internal/cron/directory` with `Authorization: Bearer $CRON_SECRET`, so the directory gets employee emails. Until then queued emails wait one hour at a time instead of being lost.
5. Notices queued before the upgrade whose shifts are already over are dropped automatically (marked `expired`); later ones are delivered.
6. A second cron, `/internal/cron/notifications` (daily at 18:30 UTC), now exists. Notices are mainly delivered shortly after each request.
7. Shift reminders need an external scheduler (for example cron-job.org) that calls `GET /internal/cron/sweep` every 5 minutes with `Authorization: Bearer $CRON_SECRET`. The route queues due reminders and delivers due notices; it is plain HTTP, so it works on any host. The daily check raises an alert when the sweep has not run for 30 minutes.

## Version
`/health` and `/openapi.json` report `SERVICE_VERSION` (`src/server/config/serviceInfo.ts`). Change it in the same commit as any API change.
