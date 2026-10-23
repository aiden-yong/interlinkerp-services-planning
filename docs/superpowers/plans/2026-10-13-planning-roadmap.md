# InterlinkERP Planning — Release 1 Roadmap

**Spec:** [ListOfRequirements.md](../../../ListOfRequirements.md) (v0.2, approved 2026-10-13)

**Stack (decided 2026-10-15):** Next.js 16 App Router, React 19 and TypeScript; Drizzle ORM on PostgreSQL (18 locally, Neon `aws-ap-southeast-1` in production); Vercel region `sin1`. No separate backend service: the JSON API runs in Next.js route handlers.

Release 1 is built in four milestones. Each one ends with working, deployable software and gets its own detailed implementation plan, written when the milestone starts so it is based on the real code. M1, M3 and M4 have detailed plans so far: [2026-10-13-planning-m1-foundation.md](2026-10-13-planning-m1-foundation.md), [2026-10-20-planning-m3.md](2026-10-20-planning-m3.md) (spec: [2026-10-20-planning-m3-design.md](../specs/2026-10-20-planning-m3-design.md)) and [2026-10-21-planning-m4.md](2026-10-21-planning-m4.md) (spec: [2026-10-21-planning-m4-design.md](../specs/2026-10-21-planning-m4-design.md)).

| Milestone | Theme | Depends on | Detailed plan |
|---|---|---|---|
| M1 | Foundation: sign-in, configuration, shifts, schedule, publishing, My Planning | — | Written |
| M2 | Open shifts, giving up shifts, notification delivery | M1 | Write when M1 ships |
| M3 | Recurrence, shift templates, copy previous week, split | M1 (M2 for notifications on generated shifts) | Written |
| M4 | Reporting, Auto Plan, remaining Should/Could items | M1–M3 | Built (service 0.4.0): [plan](2026-10-21-planning-m4.md) |

---

## M1 — Foundation

**Goal:** A Planning Manager can sign in through the gateway, set up roles, employee profiles, time off and holidays, plan shifts on the schedule with conflict warnings, and publish them. Employees can see their published shifts on My Planning.

**Requirements**
- Access: FR-ACC-01, FR-ACC-02, FR-ACC-03, BR-12
- Schedule: FR-SCH-01, 02, 03, 06, 07, 08, 09
- Shifts: FR-SHF-01, 02, 03, 04, 05, 07, 08, 09, 10, BR-01, BR-02, BR-03, BR-04, BR-10, BR-11
- Publishing: FR-PUB-01, FR-PUB-02
- My Planning: FR-MYP-01, FR-MYP-02
- Configuration: FR-CFG-01, 02, 03, and FR-CFG-04 partly (manual holidays plus hide/edit; automatic loading waits on OI-02)
- Data: DR-01 (M1 tables), DR-02, DR-03, DR-05
- Interfaces: IF-01, IF-02, IF-03 (department names only), IF-06 (provider interface only), IF-07
- Non-functional: NFR-01, 02, 03, 05, 06, 07 (form alternative to drag), 08, 09, 10, 11

**Adds**
- Tables: `roles`, `employee_profiles`, `employee_roles`, `shifts`, `unavailabilities`, `public_holidays`, `organisation_settings`, `planning_managers`, `employee_directory`, `notification_outbox`
- Endpoints: `/health`, `/openapi.json`, `/api/me`, `/api/roles`, `/api/employees`, `/api/settings`, `/api/unavailabilities`, `/api/holidays`, `/api/holiday-syncs`, `/api/managers`, `/api/shifts`, `/api/shift-restorations`, `/api/schedule`, `/api/publications`, `/api/my/shifts`, `/internal/cron/directory`
- Pages: `/schedule`, `/my`, `/settings/*`, `/not-on-roster`

**Done when**
- Every acceptance criterion of the requirements above passes, through automated tests where the plan has them and through the manual checklist in M1 Task 24.
- The gateway's `/conformance` run shows 0 failures.
- NFR-01 and NFR-02 are measured on the deployed app and meet their targets.
- Signing out at the gateway locks an open Planning tab on its next request.

**Known gap:** publishing writes a notification row to `notification_outbox` but nothing delivers it until M2. FR-PUB-01 AC1 ("each employee receives one notification") is therefore only fully met at the end of M2.

---

## M2 — Open shifts, giving up shifts, notifications

**Requirements:** FR-OPN-01 to 05, FR-PUB-03, FR-NTF-01 to 04, FR-CFG-05, BR-05, BR-06, BR-07, NFR-04, completes FR-PUB-01 AC1.

**Depends on:** M1's `notification_outbox` (M2 adds delivery), shift `version` column (claim atomicity), conflict detector (eligibility).

**Likely adds**
- Columns: `organisation_settings.give_up_mode`, `organisation_settings.unassign_window_days`; on `shifts`: `switch_requested_at`, `switch_requested_by`.
- Endpoints: `GET /api/my/open-shifts`, `POST /api/shift-claims`, `POST /api/switch-requests`, `DELETE /api/switch-requests/{shift_id}`, `POST /api/switch-takeovers`, `POST /api/unassignments`, `/internal/cron/notifications`.
- Notification delivery using the InterlinkERP notification standard (in-app badges) and email. Read the recruitment app's notification and badge code first; it already follows the standard. Consider `SELECT ... FOR UPDATE SKIP LOCKED` on `notification_outbox` so overlapping delivery runs never send a notice twice.

**Open risk:** Vercel Hobby crons run at most once a day. Deletion notices wait 30 seconds and other notices should arrive within minutes, so M2 must either deliver inline at the end of the request that created the notice (with the cron only sweeping missed rows) or move to a plan with frequent crons. Decide at the start of M2.

**Done when:** all listed ACs pass; two employees claiming the same open shift at once results in exactly one success (automated test with two connections).

---

## M3 — Recurrence, templates, copying

**Requirements:** FR-REC-01 to 04, FR-TPL-01 to 04, FR-PUB-04, FR-SHF-06, FR-CFG-06, BR-08.

**Depends on:** M1 shifts; M2 notifications (edits to published recurring shifts notify).

**Status:** built and merged to `main` 2026-10-21 (commit `891ab34`).

**Likely adds**
- Tables: `recurrences` (type, interval, end type, count, until, excluded occurrences, generated_until), `shift_templates` (name, role, start time, duration, break).
- Column: `shifts.recurrence_id`; `organisation_settings.recurrence_horizon_months`.
- Endpoints: `/api/recurrences`, `/api/shift-templates`, `POST /api/week-copies`, `POST /api/shift-splits`, recurrence extension added to the daily cron.
- Copy previous week skips shifts with a `recurrence_id` (FR-PUB-04).

**Done when:** all listed ACs pass, including FR-REC-03 AC1 (rolling 6-month horizon) with a fixed-clock test.

---

## M4 — Reporting, Auto Plan, remaining items

**Requirements:** FR-RPT-01 to 04, FR-AUT-01, FR-AUT-02, BR-09, OI-04, FR-SCH-04 (Year scale), FR-SCH-05 (group by department), DR-04 (audit trail), FR-MYP-03 (calendar feed), FR-NTF-05 (reminders).

**Likely adds**
- Table: `audit_entries`.
- Endpoints: `/api/reports/planned-hours`, `/api/reports/utilisation`, `/api/reports/open-shifts`, CSV export variants, `POST /api/auto-plans`, `/api/my/calendar.ics` (token-protected feed).

**Done when:** all listed ACs pass; Auto Plan never creates a conflict (property-style test over generated rosters).

---

## Not tied to a milestone

- **OI-02 holiday provider.** M1 ships the `HolidayProvider` interface and a "not configured" implementation. When a provider is chosen, add one adapter class and its environment variables; this completes FR-CFG-04 AC1. About half a day of work.
- **OI-01 HR leave service.** When it exists, replace `UnavailabilityRepository` reads with an adapter for that service (DR-03 keeps this contained).
