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

Optional demo data: `npm run db:seed-demo -- --yes-this-is-a-demo-database`. Browse the data with pgAdmin 4. To time the schedule endpoint, run `scripts/time-schedule.sh` while the dev server is up.

## Database changes
Edit `src/server/db/schema.ts`, run `npm run db:generate`, read the new SQL in `drizzle/`, then `npm run db:migrate`. Commit the generated files. Never edit a migration that has been applied anywhere.

## Tests
`npm test` runs everything. `npm run test:unit` needs nothing; `npm run test:integration` needs the local `planning_test` database. `npm run typecheck` for types.

## Deploying
1. Neon project in `aws-ap-southeast-1`; apply migrations with its pooled URL (`DATABASE_URL=... npm run db:migrate`).
2. In Vercel, import the repo and set every variable from `.env.example` except `DEV_*`, `TEST_DATABASE_URL` and `APP_ENV`. `DATABASE_URL` is Neon's pooled URL; `PUBLIC_URL` is the exact production URL; `CRON_SECRET` is a long random value. `OPENAPI_EXTENSION_KEY` is the extension key the gateway reads catalogue metadata from; get the exact value from the gateway admins.
3. In the gateway console, issue an API client for Planning with `intern:read` and `department:read`, and set `INTERLINK_CLIENT_ID` / `INTERLINK_CLIENT_SECRET`.
4. Turn off Vercel Deployment Protection for Production (or exempt `/health` and `/openapi.json`); the gateway must reach both.
5. Deploy, then register the base URL with the gateway and run its `/conformance` check.

## Version
`/health` and `/openapi.json` report `SERVICE_VERSION` (`src/server/config/serviceInfo.ts`). Change it in the same commit as any API change.
