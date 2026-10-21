# Planning M4 Design: Reporting, Auto Plan and the Remaining Items

**Status:** written 2026-10-21. InterlinkERP is sold to companies in any industry, so every workflow decision below is the builder's call, based on the usual industry practice (Odoo Planning, Deputy, When I Work). **Requirements:** [ListOfRequirements.md](../../../ListOfRequirements.md) (FR-RPT-01..04, FR-AUT-01..02, BR-09, OI-04, FR-SCH-04, FR-SCH-05, DR-04, FR-MYP-03, FR-NTF-05). **Roadmap:** [M4](../plans/2026-10-13-planning-roadmap.md#m4--reporting-auto-plan-remaining-items).

This document records only the decisions the requirements leave open. It does not restate the requirements.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Scope | Every M4 requirement, Musts, Shoulds and Coulds. Tasks are ordered so the one Must (FR-RPT-01) and its CSV export land first, then Auto Plan, then the audit trail, then the schedule additions, then the calendar feed and reminders. | M3 shipped all its items the same way. If time runs short, the tail of the list can be cut without touching what came before. |
| D2 | Where reports live | A new **Reports** page (`/reports`), for Planning Managers only, with three tabs: *Planned hours*, *Utilisation* and *Open shifts*. Each tab has a period picker (This week, This month, Last month, Custom), the schedule's role and department filters, a table, and a *Download CSV* button. | The usual place: Odoo's Planning Analysis, Deputy's Reports. Employees do not see reports. |
| D3 | Report period and time zones | The period's days start and end at midnight in the viewer's zone, as on the schedule (BR-10). Each employee's hours are split by day in **their own** zone (BR-04, NFR-05), with exactly the schedule's code. The longest period is 366 days. | A report must give the same number as the schedule for the same period. |
| D4 | Planned hours (FR-RPT-01) | Grouped by one of *Employee*, *Role* or *Department* (chosen on the page). Columns: draft hours, published hours, total. Open shifts appear as their own *Open shifts* row under Employee and Department grouping, and inside their role under Role grouping. A shift partly inside the period counts only the part inside. Employees no longer on the roster still appear when they have hours, marked *(left)*. A shift with no role counts under *No role*; an employee with no department under *No department*. | One grouping level covers the requirement. A nested pivot is more UI than release 1 needs. |
| D5 | Utilisation (FR-RPT-03) | One row per employee: allocated hours, available hours, utilisation % (allocated ÷ available, one decimal), and the over-allocated days (BR-04). Draft and published both count, because that is what the schedule warns about. Flexible-hours employees show allocated hours with "—" for available and utilisation, and are never listed as over-allocated. An employee with 0 available hours and some allocated hours shows "—" for the percentage and is over-allocated. Over-allocated employees sort first, then by utilisation, highest first. | Matches the schedule's over-allocation marker. |
| D6 | Open shifts report (FR-RPT-04) | A role × day table for the period. Each cell shows *open / total*: shifts with no employee over all shifts of that role starting that day (in the viewer's zone). Rows: each role, then *No role*, then a totals row. A day with no shifts is blank. Draft open shifts and published open shifts both count; a toggle can limit the table to published ones, the ones employees can actually claim. | "How many are unfilled" reads best next to how many there are. |
| D7 | CSV (FR-RPT-02) | Each report endpoint returns CSV when called with `format=csv`, with the same filters, as a download named like `planned-hours_2026-10-01_2026-10-31.csv`. UTF-8 with a byte-order mark and CRLF line ends, so Excel opens it correctly. Hours are plain numbers with two decimals. Any cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'`, so a name cannot run as a spreadsheet formula. | Industry-standard CSV, and a known injection risk closed. |
| D8 | Which open shifts Auto Plan fills (FR-AUT-01) | **Draft** open shifts in the period on screen (Day, Week or Month) that have not started. Published open shifts are left alone: employees can already see and claim them, and assigning one silently would pull it away from them. They are listed in the result as *Already published, left for employees to claim*. | "Leave results as drafts" can only hold for shifts that are drafts. |
| D9 | Who can be assigned (BR-09) | An employee is a candidate for a shift when all of these are true: they are on the roster; they have working hours (not flexible) and at least one role; the shift has no role or one of their roles; the shift lies entirely inside their working hours, minus time off and public holidays; adding it creates no BR-01 conflict at all (overlap, time off, public holiday or role); and their allocated hours on each day the shift touches stay within that day's available hours (no new over-allocation). | BR-09 plus BR-02's "Auto Plan never creates a conflict". Holidays count here even though they do not count for claims (BR-05): a manager can still assign a holiday shift by hand. |
| D10 | Who gets the shift (OI-04) | **Spread evenly** (OI-04's default; OI-04 is marked resolved). Among the candidates, an employee whose *default* role is the shift's role comes first (BR-09). Then the employee with the fewest allocated hours in the period, counting what this run has already given them. Then name, then `employee_ref`, so the same input always gives the same result. | Spreading load is the common default (Deputy's auto-schedule, Odoo's), and the requirement's own default. |
| D11 | Order of filling | Shifts with the fewest candidates go first, then by start time, then by id. Each assignment is taken into account before the next shift is considered. | Hard-to-fill shifts get first pick, so more shifts get filled in total. |
| D12 | The result (FR-AUT-02) | A panel after the run: "Filled 7 of 10 open shifts", the list of filled shifts with who got them, and the list of unfilled shifts each with one reason. Reasons, checked in this order, and the first that applies to every possible employee is shown: *No one on the roster has this role*, *Everyone with this role is on flexible hours*, *Outside everyone's working hours*, *Everyone with this role is busy or away then*, *Would put everyone over their available hours*. Shifts that started are not considered and not listed. Assigned shifts stay drafts; nothing is sent until the manager publishes (FR-AUT-01 AC1). | The reason should tell the manager what to change. |
| D13 | Auto Plan and repeating shifts | An occurrence of a series that Auto Plan assigns is marked `recurrence_detached`, as if edited with *This shift*, so a later *All* edit does not undo it. | M3 D5's rule for individually edited shifts. |
| D14 | Auto Plan and concurrent edits | The run is one transaction under an advisory lock on the organisation's Auto Plan, so two runs never overlap. Each assignment is a conditional update on the shift's `version`; a shift a manager changed in the meantime is skipped and listed as *Changed while Auto Plan ran*. | Same atomicity approach as claims (NFR-04). |
| D15 | No undo for Auto Plan | Every result is a draft the manager can edit, reassign or delete before publishing. | Keeps the first version small; see *Not in M4*. |
| D16 | Audit trail (DR-04) | A new `audit_entries` table, written in the same transaction as each change. Recorded actions: created, changed, published, deleted, restored (undo), split, copied (week copy), generated (recurrence), auto-planned, claimed, switch requested, switch cancelled, taken over, unassigned. A *changed* entry stores the old and new value of each changed field (employee, role, start, end, break, percentage, note). The actor is the person's email (managers) or `employee_ref` (employees), or `system` for the recurrence cron. | DR-04 asks for who and when; storing what changed costs little and is what a manager asks next. |
| D17 | Where the audit trail shows | A *History* section at the bottom of the shift dialog, for managers only, newest first, in the viewer's time zone. Employees' entries show their current name from the directory. There is no organisation-wide audit screen in release 1. | Odoo shows a shift's history on the shift itself. |
| D18 | Existing shifts | The migration back-fills one *created* entry per existing shift from `created_by`/`created_at`, a *published* entry (actor unknown) from `published_at`, and a *deleted* entry from `deleted_by`/`deleted_at`. | History is not empty for shifts made before M4. |
| D19 | How long audit entries are kept | For as long as the shift row exists (shifts are only soft-deleted). No pruning in release 1. | Small rows; no retention rule in the requirements. |
| D20 | Year scale (FR-SCH-04) | A *Year* option next to Day, Week and Month. It shows employee rows and twelve month columns. Each cell shows that month's allocated hours (published and draft shaded differently) and a warning mark if the employee is over-allocated on any day that month. The open shifts row shows the number of open shifts per month. The year view is read-only: clicking a cell opens that month in Month scale. Prev/next moves a year. The name, department and state filters apply; role filter applies to the hours. | Showing every shift for a year is unreadable and too much data; Odoo's year scale is a summary too. |
| D21 | Group by department (FR-SCH-05) | *Department* is added next to *Employee* and *Role* in the schedule's group-by control (Day, Week, Month and Year). Employees appear under their department's header, alphabetically, with *No department* last. The open shifts row stays at the top. If the department service is down, everyone falls under *No department* (NFR-06). | Same pattern as the existing role grouping. |
| D22 | Calendar feed (FR-MYP-03) | Each employee can turn on a private feed URL on My Planning (*Add to your calendar*: copy link, reset link, turn off). The URL holds a random 256-bit token; only its SHA-256 hash is stored. The feed lists the employee's **published** shifts from 30 days ago to the recurrence horizon ahead, one event per shift with a stable UID (the shift id), start and end in UTC, the role name as the title, and the note and break in the description. Deleted or reassigned shifts drop out on the calendar's next refresh. An employee who leaves the roster gets 404 from their feed. The feed is rate-limited per token. | The industry norm (Deputy, When I Work, Odoo all use a secret URL). Calendar apps cannot sign in through the gateway. |
| D23 | Calendar feed vs NFR-03 | The feed is the one place the app answers without a gateway session. It is read-only, shows only the owner's own published shifts, and the token can be reset or turned off at any time. NFR-03 gets a written exception for it in the requirements (v0.5). Approved by the product owner. | NFR-03 as written makes FR-MYP-03 impossible; the exception is narrow. |
| D24 | Shift reminders (FR-NTF-05) | A setting in Settings → General, *Remind employees before their shifts*: Off, 30 min, 1 h, 2 h, 4 h, 12 h or 24 h. Default **1 hour**. Reminders go to the shift's employee in-app and by email, through the existing notification pipeline, and can be turned off by email per person with the existing email preferences (a new notice kind). Only published, assigned shifts get one. | Deputy and When I Work both remind by default; one hour is the common default. |
| D25 | How reminders are sent | No queue row is made at publish time. The notification sweep (which already runs after every API request and from the daily cron, M2 D1) gains a step: find published, assigned, live shifts starting within the lead time that have no reminder yet, queue one reminder each, and mark the shift. A shift that has already started gets no reminder. Changing a shift's start time or employee clears the mark, so the new time or the new person is reminded. | No reminders to cancel when a shift is edited or deleted. |
| D26 | Reminders on Vercel Hobby | The sweep runs only when someone uses the app or once a day from the cron, so a reminder can be late or skipped at quiet times. M4 adds a light route, `/internal/cron/sweep` (same `CRON_SECRET` check), that only queues reminders and delivers due notices; recurrence extension, pruning and the failure checks stay on the daily `/internal/cron/notifications`. It is called every 5 minutes by an external scheduler (decided below). | The daily route does heavy jobs and raises alerts; it must not run every few minutes. |

## Decided by the product owner (2026-10-21)

- **D23, calendar feed:** the NFR-03 exception for a secret, resettable, read-only feed link is approved.
- **D26, sweep frequency:** a free external scheduler (for example cron-job.org) calls `/internal/cron/sweep` with `CRON_SECRET` every 5 minutes. The hosting may move later (for example to Hostinger), so the route stays a plain authenticated HTTP endpoint any scheduler can call, with nothing Vercel-specific in it. The README documents the scheduler setup, and the existing ops check flags it when the sweep has not run for 30 minutes.

## Data (one migration, `0005`)

- New `audit_entries`: `id` (bigserial), `organisation_id`, `shift_id` (uuid), `action` (varchar 24, CHECK on the list in D16), `actor` (varchar 254: email, `employee_ref` or `system`), `actor_kind` (`manager` | `employee` | `system`), `changes` (jsonb, null: `{field: [old, new]}`), `at` (instant). Index `(organisation_id, shift_id, at)`. Plus the back-fill in D18.
- New `calendar_feeds`: `organisation_id`, `employee_ref` (primary key with the organisation), `token_hash` (char 64, unique), `created_at`, `last_used_at` (null).
- `shifts`: `reminded_at` (instant, null).
- `organisation_settings`: `reminder_lead_minutes` (smallint, default 60, CHECK in `0, 30, 60, 120, 240, 720, 1440`; 0 is off).

## Reporting service

One `ReportService` builds all three reports from the same reads the schedule uses (shifts overlapping the period plus the 7-day margin, profiles, directory, roles, time off, holidays), so reports reuse `allocatedByDay`, `availableByDay` and `overAllocatedDays` unchanged. Target: a one-month report for 50 employees answers in under 1 s (p95) on the deployed app; a 366-day report in under 3 s. The year view (D20) calls the same service with month buckets.

## Auto Plan

`AutoPlanService.run(period, actor)` is a pure planning step plus a write step:

- **Plan (pure):** given the open draft shifts, the candidates' profiles, existing shifts, time off and holidays, it returns `{ assignments, unfilled }` following D9–D12. It never reads the clock or the database itself, so it can be tested with generated rosters.
- **Write:** in one transaction (D14), apply the assignments with conditional updates, mark series occurrences detached (D13), write *auto-planned* audit entries, and return the result.

## API

- `GET /api/reports/planned-hours?from&to&group=employee|role|department&role_id&department_id&bucket=none|month&format=json|csv`
- `GET /api/reports/utilisation?from&to&role_id&department_id&bucket=none|month&format=json|csv`
- `GET /api/reports/open-shifts?from&to&role_id&published_only&format=json|csv`
- `POST /api/auto-plans` with `{ from, to }` (the period on screen) returns `{ filled: [{ shift_id, employee_ref }], unfilled: [{ shift_id, reason_code, reason }], skipped_published, skipped_changed }`.
- `GET /api/shifts/{id}/history` returns the audit entries (managers only).
- `GET /api/my/calendar-feed` returns `{ enabled, url }` (the URL only right after it is made); `POST /api/my/calendar-feed` makes or resets the link and returns the URL once; `DELETE /api/my/calendar-feed` turns it off.
- `GET /feeds/calendar/{token}.ics`: the feed itself, outside `/api`, with no gateway session (D23). `text/calendar`, `Cache-Control: private, max-age=900`.
- `GET|PATCH /api/settings` gains `reminder_lead_minutes`.
- All report and Auto Plan endpoints are manager-only. New error codes: `PERIOD_TOO_LONG` (422, over 366 days) and `AUTO_PLAN_RUNNING` (409, when another run holds the lock).
- The service `version` moves to 0.4.0 and the OpenAPI document lists every new route.

## UI

- **Header:** a *Reports* link for managers.
- **Reports page:** D2–D7.
- **Schedule:** *Auto Plan* button (Day, Week and Month scales), a confirm ("Fill the draft open shifts in this period?"), then the result panel (D12); *Year* in the scale switch (D20); *Department* in group-by (D21).
- **Shift dialog:** *History* section for managers (D17).
- **My Planning:** *Add to your calendar* section (D22), usable at 360 px wide (NFR-08).
- **Settings → General:** the reminder lead time (D24).

## Requirements updates (ListOfRequirements v0.5)

- OI-04 resolved: spread evenly (D10).
- NFR-03 gets the calendar-feed exception (D23).
- FR-AUT-01 notes that published open shifts are not auto-planned (D8).

## Testing

- **Reports:** planned hours equal the schedule's allocated hours for the same week; a shift across midnight and across the period edge is split correctly; draft and published are separate; DST in an employee's zone; flexible employees in utilisation; CSV escaping and the byte-order mark.
- **Auto Plan, FR-AUT-01 AC1:** 10 open shifts and 6 eligible employees; every assignment satisfies BR-09, no new conflict, nothing in the outbox.
- **Auto Plan, property test (roadmap done-when):** a few hundred generated rosters (random working hours, roles, time off, holidays and existing shifts, with a fixed seed). After each run: no shift of any employee has a BR-01 conflict it did not have before, nobody is newly over-allocated, every assignment is inside working hours, no flexible or role-less employee is assigned, and running twice on the same input gives the same result. Written with a small seeded generator in the test, or `fast-check` as a dev dependency (builder's choice).
- **Auto Plan:** spread-evenly and default-role tie-breaks; each unfilled reason; published open shifts skipped; a concurrent edit is skipped; two runs at once give one `AUTO_PLAN_RUNNING`.
- **Audit:** every action in D16 writes one entry with the right actor; the back-fill; history is manager-only.
- **Calendar feed:** a wrong or reset token gives 404; only published shifts of the owner; an employee off the roster gets 404; the output parses as valid iCalendar.
- **Reminders:** with a fixed clock, a shift 50 minutes away gets one reminder at a 1 h lead and no second one; a moved shift is reminded again; a started shift gets none; lead time Off sends none.
- **Browser tests:** run Auto Plan on a week and see the result panel; open Reports and download a CSV; switch to Year and click into a month.

## Not in M4

- Undo for an Auto Plan run (D15).
- Nested report grouping (for example department, then role) and charts.
- An organisation-wide audit log screen.
- Per-employee reminder lead times (one organisation setting only).
- Auto Plan across several periods at once, or "fill one person first" as an option.

## Branching

Built on `feature/m4-reporting-auto-plan` off `main`, in the main checkout. Each task is merged into that branch, and the branch into `main` at the end.
