# InterlinkERP Planning: owner's to-do list

Everything left that needs **you** (or the gateway owners, or a decision) before and after go-live. Written 2026-10-23, when `main` was at `8e08fae`: service version 0.4.1, milestones M1–M4 built, CI green.

Tick a box when the step is done. Each item below has a link to its full instructions further down. Tell me the result of any item (paste the output, or just say "done") and I will update the docs and fix whatever it turns up.

Related files: [improvements.md](improvements.md) (the technical backlog), [../README.md](../README.md) (deploying), [../ListOfRequirements.md](../ListOfRequirements.md).

## Checklist

**Before deploying**
- [ ] [1. Apply migrations `0005` and `0006` to the production database](#t1)
- [ ] [2. Apply the migrations to your dev database](#t2)
- [ ] [3. Let the gateway, calendar apps and the scheduler reach the app (Vercel Deployment Protection)](#t3)
- [ ] [4. Set up the 5-minute reminder scheduler (cron-job.org) and the email settings](#t4)

**Ask the gateway owners**
- [ ] [5. Does the gateway return `state` unchanged on the sign-in callback?](#t5)
- [ ] [6. Get the extension key, register the app and run `/conformance`](#t6)

**GitHub settings**
- [ ] [7. Branch protection and automatic branch deletion](#t7)

**Decisions**
- [ ] [8. Hosting: Vercel Pro, Hobby, or Hostinger](#t8)
- [ ] [9. Backups: confirm the Neon restore window and test one restore](#t9)
- [ ] [10. Choose where alerts go](#t10)
- [ ] [11. Choose a public-holiday provider](#t11)
- [ ] [12. HR leave service (waiting on someone else)](#t12)

**After deploying**
- [ ] [13. Click through the screens in a browser (light and dark)](#t13)
- [ ] [14. Time the schedule and reports on the deployed app](#t14)

**When you want them**
- [ ] [15. Deferred features (#41–#49): pick which to design next](#t15)

Suggested order: 9 and 8 first (they decide where the app runs), then 1, 3, 4, 5, deploy, 6, 13, 14. Items 7, 10, 11 and 12 can happen any time.

---

## Before deploying

<a id="t1"></a>
### 1. Apply migrations `0005` and `0006` to the production database

**Who:** you. **Why it matters:** the new code reads columns and tables that don't exist until these run. Without `0006`, every read and write of repeating shifts fails. Without `0005`, saving any shift fails (it writes an audit entry) and reports, history, the calendar feed and reminders are broken.

**What they add**
- `0005_reporting_audit_feeds`: tables `audit_entries` and `calendar_feeds`, `shifts.reminded_at`, `organisation_settings.reminder_lead_minutes` (default 60), and a one-time back-fill of history for existing shifts (up to three rows each: created, published, deleted). On a large shifts table the back-fill is an INSERT per shift; it is quick for thousands of shifts.
- `0006_series_predecessor`: a nullable `recurrences.predecessor_id` plus an index. Existing series get null.

Both are additive, so old code keeps running against the new schema. That is why they go **before** the deploy.

**Steps**
1. Take a safety net first: in the Neon console create a branch of the production database (or note the current time so you can restore to it). See [item 9](#t9).
2. Get Neon's **pooled** connection string for the production database.
3. From the repo root, in PowerShell:
   ```powershell
   $env:DATABASE_URL = 'postgres://...pooled-url...'
   npm run db:migrate
   Remove-Item Env:DATABASE_URL
   ```
   Or in Git Bash: `DATABASE_URL='postgres://...' npm run db:migrate`.
4. The command prints nothing special on success. Check with any SQL client (Neon's SQL editor works): `select count(*) from audit_entries;` should return a number, and `select predecessor_id from recurrences limit 1;` should not error.
5. Then deploy the code.

**If it fails halfway:** each migration is applied in order and recorded; re-running continues from where it stopped. Paste the error to me.

<a id="t2"></a>
### 2. Apply the migrations to your dev database

**Who:** you. **Careful:** `.env.local` has pointed at the remote database in the past. Open `.env.local` and look at the host in `DATABASE_URL` first. If it is the remote/production database, then this step **is** item 1 — do it once, deliberately, not twice.

For a truly local dev database: `npm run db:migrate` from the repo root. The test database (`planning_test`) needs nothing; the tests migrate it themselves.

<a id="t3"></a>
### 3. Let the gateway, calendar apps and the scheduler reach the app

**Who:** you, in Vercel. **Why:** Vercel's Deployment Protection puts a Vercel login in front of the site, which blocks three things that must be reachable without one:
- `/health` and `/openapi.json`: the gateway reads these.
- `/feeds/*`: calendar apps (Google Calendar, Outlook, Apple) subscribe to the employee's calendar link and cannot sign in.
- `/internal/cron/sweep`: the external scheduler calls it. (It is protected by `CRON_SECRET`, not by a login.)

**Steps:** Vercel → your project → Settings → Deployment Protection. The simplest choice is to turn protection **off for Production** (the app has its own sign-in). If you prefer to keep protection on, add exceptions for the paths above — which options exist depends on your Vercel plan, so check what the page offers.

**Check it worked** (from any machine, not signed in to Vercel):
- `curl -i https://<host>/health` → `200` and JSON.
- `curl -i https://<host>/feeds/calendar/x.ics` → `404` with a JSON error body (not an HTML login page).
- `curl -i https://<host>/internal/cron/sweep` → `401` with a JSON error body.

<a id="t4"></a>
### 4. Set up the 5-minute reminder scheduler and email settings

**Who:** you. **Why:** Vercel Hobby crons run once a day; shift reminders need a check every few minutes. (Decided 2026-10-21: use a free external scheduler. See backlog item 40.)

**Prerequisites in Vercel (Settings → Environment Variables)**
- `CRON_SECRET`: a long random value (for example 40+ random characters). Redeploy after changing it.
- `SMTP_URL` and `MAIL_FROM`: needed for **emails**. Gmail/Workspace example: `smtps://you%40example.com:APP_PASSWORD@smtp.gmail.com:465` (the `@` in the address is written `%40`). If unset, emails are only logged and employees get in-app notices only.
- `GATEWAY_BADGES=off` stays off until the gateway exposes its `/api/badges` endpoint (OI-07).

**Steps with cron-job.org**
1. Create a free account and a new cron job.
2. URL: `https://<host>/internal/cron/sweep`. Schedule: every 5 minutes.
3. Advanced settings → add the header `Authorization` with value `Bearer <CRON_SECRET>` (the exact value from Vercel, after the word `Bearer` and a space).
4. Save, use "Test run", and check the response is `200` and the body is JSON with a `reminded` field.
5. Turn on "notify me on failure" in cron-job.org.

**How you will know it stopped:** the daily check raises an `[alert]` log line when the sweep has not run for 30 minutes (and one if it has never run). See [item 10](#t10) for where alerts go.

**If hosting moves** (item 8): any scheduler can call the same URL with the same header, including the host's own cron.

---

## Ask the gateway owners

<a id="t5"></a>
### 5. Does the gateway return `state` unchanged on the sign-in callback?

**Who:** the gateway owners (and you, to test). **Why:** since 2026-10-23 Planning protects sign-in against login CSRF. It sends the gateway a random one-time value as `state` and refuses a sign-in callback that doesn't bring the same value back. The gateway's auth guide never says whether it echoes `state`, so this is unverified.

**Ask them:** "When Planning sends `GET /oauth/authorize?redirect_uri=...&state=<value>`, does the gateway redirect back to `redirect_uri?code=...&state=<value>` with `state` unchanged? The value is a short random string (and `r.<random>` on a retry)."

**If yes:** nothing to do.

**If no, or you find out by testing:** after deploying, signing in shows an error page ("Your sign-in through InterlinkERP could not be verified."), and Vercel's logs show the line
`[planning-web] sign-in callback without state; set SIGNIN_STATE_OPTIONAL=1 only if the gateway does not return state`.
Then either ask the gateway owners to echo `state` (best), or set `SIGNIN_STATE_OPTIONAL=1` in Vercel and redeploy. That works but is weaker: a cookie alone then binds the sign-in. Tell me when the answer is known so I can remove the fallback or document it.

<a id="t6"></a>
### 6. Get the extension key, register the app and run `/conformance`

**Who:** gateway admins for the key and registration; you to trigger the check; me to fix findings. Blocked on the gateway update. (Backlog item 7.)

**Steps**
1. Ask the gateway admins for the exact `OPENAPI_EXTENSION_KEY` (the key the gateway reads catalogue metadata from). Set it in Vercel and redeploy.
2. In the gateway console: issue an API client for Planning with scopes `intern:read` and `department:read`, and set `INTERLINK_CLIENT_ID` and `INTERLINK_CLIENT_SECRET` in Vercel.
3. Register the app's base URL (the exact production URL, same as `PUBLIC_URL`) with the gateway.
4. Run the gateway's `/conformance` check. The goal is **0 failures**.
5. Paste the report to me. I will fix what it finds and re-test.

---

## GitHub settings

<a id="t7"></a>
### 7. Branch protection and automatic branch deletion

**Who:** you, in GitHub (the `gh` command-line tool isn't installed on this machine). CI already exists: `.github/workflows/ci.yml` runs typecheck, unit/integration tests (with Postgres), the build, and the browser tests on every push to `main` and every pull request. (Backlog item 2.)

**Do now (safe)**
1. Repo → Settings → General → Pull Requests → tick **Automatically delete head branches**.
2. Repo → Settings → Rules → Rulesets (or Branches → Branch protection rule) → new rule for `main`:
   - **Block force pushes**
   - **Restrict deletions**

   These don't change your current flow (merge locally, push `main`).

**Decide**
- Requiring CI to pass (the two checks are named **Typecheck, test, build** and **Browser tests**) also means GitHub rejects a direct push of a commit that hasn't passed yet. In practice that means switching to **pull requests**: branch → push the branch → open a PR → CI → merge. That is the better habit once more than one person works on the repo, or once the app is in production. While you are the only developer, the "safe" rules above are enough. When you want the full flow, tell me and I will use it from then on (I would need a GitHub token or the `gh` CLI to open PRs).

---

## Decisions

<a id="t8"></a>
### 8. Hosting: Vercel Pro, Hobby, or Hostinger

**Who:** you. (Backlog item 8.) **The problem:** Vercel's Hobby plan is licensed for non-commercial use only, and has tighter cron and function limits. A company ERP sold to customers needs a commercial plan or another host.

**Options**
- **Vercel Pro:** a paid plan (roughly USD 20 per month per seat; check current pricing). No code change. Crons can run every minute, so the external scheduler in item 4 becomes optional (I would move the sweep to `vercel.json`). Deployment Protection exceptions are easier too.
- **Stay on Hobby:** fine for a private trial, not for commercial use.
- **Hostinger (or any host you control):** I can prepare it. It needs a plan that runs a Node.js server all the time (the app needs Node 22 or newer; CI uses 24), HTTPS, and environment variables. What changes: run `next build` then `next start` behind a process manager (or a container); replace the two daily Vercel crons with the host's cron or cron-job.org (call `/internal/cron/directory` and `/internal/cron/notifications` once a day, and `/internal/cron/sweep` every 5 minutes, all with the `CRON_SECRET` header); choose a server near Singapore because the database (Neon) is in `aws-ap-southeast-1`; put the right `PUBLIC_URL` in the environment. Background work after each response keeps working on a long-running server.

**What I need from you:** which option, and for Hostinger the exact plan name so I can check it fits.

<a id="t9"></a>
### 9. Backups: confirm the Neon restore window and test one restore

**Who:** you. **Why:** no restore has ever been tried; an untested backup is a hope, not a backup. (Backlog item 8.)

**Steps**
1. Neon console → your project → **Backup & Restore** (point-in-time restore). Note the **restore window** your plan gives (how many hours or days back you can go). Write it down here: ____ .
2. Do one test: create a branch from a point in time a few minutes ago. Connect to the branch with any SQL client and check that data is there (for example `select count(*) from shifts;`).
3. Delete the test branch.
4. Tell me the window and the result; I'll record them in the README.

If the window is shorter than you'd like, a higher Neon plan lengthens it. For extra safety, schedule a periodic `pg_dump` to storage you control (I can write the script).

<a id="t10"></a>
### 10. Choose where alerts go

**Who:** you choose; mostly configuration, not code. (Backlog item 9.)

**What exists:** the daily job writes one log line starting `[alert]` for each problem: notification emails that failed for good, notices that couldn't be delivered, the employee directory not refreshed for 48 hours, and the 5-minute sweep not running for 30 minutes. A failed cron run is a separate signal.

**Options:** (a) a log drain to a log service (Better Stack, Datadog, Grafana Cloud…) with a rule that matches `[alert]` and sends email/Slack. Log drains are a paid Vercel feature, so check your plan; (b) an error tracker such as Sentry plus Vercel's cron-failure notifications; (c) **I add a webhook**: a small change so the daily check posts the alert lines to a Slack/Discord/email-gateway URL you provide (`ALERT_WEBHOOK_URL`). Option (c) needs no paid logging.

**What I need from you:** which option; for (c), the webhook URL.

<a id="t11"></a>
### 11. Choose a public-holiday provider

**Who:** you choose; then it's about half a day for me. (Backlog item 50, requirement OI-02.) Until then, holidays are entered by hand in Settings → Holidays, and automatic loading is off.

**Why not the obvious one:** Nager.Date has no Malaysia data. You need a provider with **Malaysian state-level holidays** (state-specific days, replacement days like cuti ganti, and years ahead), a fair price, and API terms that allow commercial use. Candidates worth checking: Calendarific, Abstract API Holidays, HolidayAPI, or a curated dataset you maintain. Check each for Malaysia/state coverage on a free trial before paying.

**What I need:** the provider's name, an API key, and its documentation link. I add one adapter class and its environment variables (`HolidayProvider` interface already exists); the Settings screen's country and region choose what is loaded. This completes FR-CFG-04 AC1.

<a id="t12"></a>
### 12. HR leave service (waiting on someone else)

**Who:** whoever builds it. (Backlog item 51, requirement OI-01.) Planning stores time off itself until a leave service exists. When it does, I need its API contract (how to read approved leave for a person and date range, its auth, and whether it pushes changes). Then I replace the time-off reads with an adapter; the design keeps this contained (DR-03). Nothing to do now.

---

## After deploying

<a id="t13"></a>
### 13. Click through the screens in a browser (light and dark)

**Who:** you; I fix what you find. (Backlog item 3, widened to M4.) Nothing from M2 or M4 has been clicked through by a person yet; they are covered by automated tests only. The README section the backlog mentions doesn't exist, so the walkthrough is here.

**Before you start:** use a throwaway database, **not** production, and not `.env.local`'s database if that is the remote one (you'll create shifts and notices). Easiest: run `npm run dev` against a local Postgres, then `npm run db:seed-demo -- --yes-this-is-a-demo-database` for sample data. Locally the **"Dev:"** picker in the top bar switches between a Planning Manager and any employee without signing in.

Switch the theme with the theme switch in the top bar and repeat the key screens in **light and dark**. Also check the schedule at ~1024 px wide and My Planning at ~360 px (browser devtools device mode). Try the main actions with the keyboard only.

**Round 1 — set up as a manager:** Settings → General (country, time zone, give-up mode, unassign window, recurrence horizon, **Remind employees before their shifts**) → Roles → Employees (give a few roles, working hours) → Time off → Holidays → Templates → Managers.

**Round 2 — plan on the schedule:**
- Add a shift (form and drag). Make a conflicting one: overlap, time off, wrong role; accept the warning and check the shift's **History** section records the acceptance.
- Use a template; make a weekly **repeat**; edit "this / this and following / all"; **split** a shift; **copy previous week**.
- Filter by role, department, name, state. Group by **Employee, Role, Department**. Switch **Day / Week / Month / Year**; in Year, click a month cell and confirm it opens Month; the over-allocation warning appears when someone is over their hours.
- Create several **draft open shifts**, then **Auto Plan**: check the confirm, the result dialog (filled and unfilled with reasons, keyboard closes it, focus returns to the button), that assigned shifts stay drafts, and that nothing is sent until you Publish.
- **Publish** with and without "Tell eligible employees about open shifts".

**Round 3 — Reports** (`Reports` in the top bar): the three tabs (Planned hours, Utilisation, Open shifts), group by Employee/Role/Department, filters, period presets, **Download CSV** (open it in Excel; names must not break the columns). Compare a week's hours with the schedule's numbers: they must match.

**Round 4 — as an employee** (switch to an employee in the picker): My Planning shows published shifts; **Available shifts** — claim one; **give up / switch** a shift (depends on the mode); the **bell** shows notices and unread counts; Email settings in the bell panel. **Add to your calendar**: get a link, copy it, subscribe in Google Calendar or Outlook, check that shifts appear; reset the link and confirm the old one stops working.

**Round 5 — notifications and reminders** (needs SMTP set and the scheduler from item 4, so do this on the deployed app): publish a shift that starts within the reminder window and confirm the in-app notice and email arrive; confirm a manager sees notices about claimed/switched/given-up shifts.

Write down anything odd (screenshot + steps) and send it to me.

<a id="t14"></a>
### 14. Time the schedule and reports on the deployed app

**Who:** you run it; I read the numbers. (Backlog item 15.) **Targets from the requirements:** schedule week view for 50 employees and 300 shifts: API p95 ≤ 500 ms (NFR-01); `/health` p95 ≤ 300 ms warm and always under 1 s (NFR-02); for M4, a one-month report for 50 employees p95 under 1 s and a 366-day report under 3 s.

**Steps** (Git Bash; the script uses GNU `date`)
1. Sign in to the deployed app in your browser, copy the `planning_session` cookie value from devtools (Application → Cookies).
2. Schedule and health: `BASE_URL=https://<host> COOKIE='planning_session=<value>' scripts/time-schedule.sh`
3. Reports (replace the dates with a month and with a year):
   ```bash
   curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -H "Cookie: planning_session=<value>" \
     "https://<host>/api/reports/planned-hours?from=2026-10-01&to=2026-10-31&group=employee"
   ```
   Run it five times for each of: planned-hours, utilisation, open-shifts, month and full year.
4. Do it twice: once warm, and once after leaving the app idle for ~10 minutes, so you see Neon waking from scale-to-zero.
5. Use a database with about 50 employees and a few hundred shifts (the demo seed is a start).
6. Send me the numbers (p50 and the worst of five); I record them in the backlog and fix anything over target.

---

## When you want them

<a id="t15"></a>
### 15. Deferred features (#41–#49)

None is needed to go live. Each was left out on purpose and is described in [improvements.md](improvements.md) (P4 section). Tell me which you want; I start with a short design for you to approve, like M3 and M4.

| # | Feature | What it would do | Decision needed from you |
|---|---|---|---|
| 41 | Undo an Auto Plan run | One click restores the shifts to open drafts exactly as before the run | Time limit for undo, and whether undo is allowed after publishing |
| 42 | Auto Plan options | Run over several periods; choose "fill one person first" instead of spreading evenly | Which option customers ask for |
| 43 | Reporting extras | Nested grouping (department, then role) and charts | Which reports matter most |
| 44 | Organisation-wide audit log | A screen to search every change by person, shift, date and action | Who may see it; how long to keep entries |
| 45 | Per-employee reminder times | Each employee chooses their own lead time | Whether managers can lock the organisation default |
| 46 | Repeat on chosen weekdays | "Mon, Wed, Fri" in one repeat instead of three series | Nothing; ready to design |
| 47 | Undo for series deletes | A 30-second undo for "delete this and following / all" | Same as single delete? |
| 48 | Templates that span several shifts | A template for a whole day's pattern (opening, middle, closing) | How day-patterns should be named and applied |
| 49 | Push notifications and gateway "nudge" | Browser push and a gateway pop-up in addition to badges | Waits on the gateway's notification protocol (OI-07) |

Other small items I can pick up any time without a decision from you are listed in [improvements.md](improvements.md) (Minor findings from the M4 reviews).
