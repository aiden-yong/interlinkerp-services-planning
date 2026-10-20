# Planning M3 Design: Repeating Shifts, Templates, Copying and Splitting

**Status:** written 2026-10-20. The user asked to skip the design questions and start, so every decision below is the builder's call, based on the usual industry workflow (Odoo Planning, Deputy, When I Work), because InterlinkERP is sold to companies in any industry. **Requirements:** [ListOfRequirements.md](../../../ListOfRequirements.md) (FR-REC-01..04, FR-TPL-01..04, FR-PUB-04, FR-SHF-06, FR-CFG-06, BR-08). **Roadmap:** [M3](../plans/2026-10-13-planning-roadmap.md#m3--recurrence-templates-copying).

This document records only the decisions the requirements leave open. It does not restate the requirements.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | What a repeat copies | The shift it is set up on (the first shift) plus one draft per later date, each copying employee, role, break, percentage and note. Times stay on the organisation's wall clock, so 09:00 stays 09:00 across a DST change. | FR-REC-02; the same wall-clock rule as Duplicate. |
| D2 | Monthly repeats on a day some months lack (29–31) | Those months are skipped. | Nobody gets a shift on a day they did not expect. |
| D3 | How far ahead | Up to the horizon (BR-08, `recurrence_horizon_months`, default 6, 1..24) from today. The daily notifications cron extends every series. Reading the schedule also extends a series whose horizon is more than a day behind, so a missed cron run fixes itself. Shrinking the horizon stops further generation and keeps the shifts already made. | FR-REC-03, NFR-11; deleting made shifts would be a surprise. |
| D4 | A deleted occurrence must not come back | Each generated shift stores `recurrence_id` and `recurrence_index` (the step number). A unique index on them includes soft-deleted rows, so regeneration skips steps that were ever made. | No separate "excluded dates" list to keep in sync. |
| D5 | Editing a repeated shift (FR-REC-04) | The dialog asks **This shift / This and following / All**. *This shift* edits only that shift and marks it `recurrence_detached`. *This and following* and *All* change attributes (employee, role, start and end time of day, break, percentage, note) on that series' **not-yet-started drafts that are not detached**, starting from this shift (*following*) or from the first not-started one (*all*). Published or individually edited shifts are left alone, so no published shift changes without the manager publishing again. | Safest choice for shifts people already rely on. |
| D6 | Changing the pattern itself (interval, unit, end) | Allowed only with *This and following* or *All*. It ends the old series before the chosen shift (its untouched future drafts from there on are removed) and starts a new series from the chosen shift with the new pattern. Published shifts of the old series stay as they are. | Step numbers keep their meaning, so D4 stays true. |
| D7 | Deleting a repeated shift | *This shift* is the normal delete with its 30-second undo. *This and following* and *All* delete every not-started shift of the series from that point, drafts and published alike, after a confirm, and end the series. Published ones get the usual deletion notice after 30 seconds. Series deletes have no undo. | FR-SHF-07's undo is for one shift; a series delete is confirmed instead. |
| D8 | Conflicts on generated shifts | Never block generation. The create request answers 409 `SHIFT_CONFLICT` listing the conflicting dates unless `acknowledge_conflicts` is sent, as for one shift; acknowledged occurrences record the manager. Shifts made later by the cron are flagged without an acknowledgement, so the schedule shows the warning. | FR-SHF-09 applied to a series. |
| D9 | Templates without a role | Offered for every employee. Templates with a role are offered only to employees holding it; an employee with no roles sees all templates (FR-TPL-03). | A role-less template fits anyone. |
| D10 | Template fields | Name (unique per organisation, case-insensitive, up to 80 characters), optional role, start time (`HH:MM`), duration in minutes (excluding the break, 1..10,080) and break minutes. Applying one sets role, start, break and end = start + duration + break (FR-TPL-02). *Save as template* takes the shift's start time, its length minus its break, its break and its role. Deleting a template is permanent and never touches shifts. | FR-TPL-01..04. |
| D11 | Copy previous week (FR-PUB-04) | A *Copy previous week* button in the schedule's week view copies into the week on screen. It copies live shifts that start in the previous week (organisation's time zone) and do not belong to a series, as drafts at +7 days on the wall clock, keeping employee (open shifts stay open), role, break, percentage and note. Shifts of people no longer on the roster are skipped. Each copy stores `copied_from`; a source already copied into this week is skipped, so pressing the button twice does not double the week. Conflicts are flagged, not blocking. A confirm shows the counts first. | FR-PUB-04 AC1, and a safe repeat press. |
| D12 | Split (FR-SHF-06) | Split at a time strictly inside the shift, leaving at least 15 minutes on each side. The break stays with the longer part; if it does not fit there, the split is refused. Both parts keep employee, role, percentage, note and state. The first part keeps the shift's id. If the shift was published, its employee gets one "shift changed" notice. A split occurrence is detached from its series, and the second part does not belong to the series. | Keeps notices to one per split. |
| D13 | Scope | All M3 requirements, including the Shoulds (FR-REC-04, FR-TPL-04, FR-SHF-06, FR-CFG-06). | They share the same code paths. |

## Data (one migration, `0004`)

- New `recurrences`: `id` (uuid), `organisation_id`, `interval` (smallint 1..99), `unit` (`day` | `week` | `month`), `ends` (`never` | `on` | `after`), `until_date` (date, for `on`), `occurrence_count` (smallint 1..999, for `after`), `timezone` (the organisation's zone when created), `first_start_local` (timestamp without zone: the wall-clock start of step 0), `duration_minutes`, plus the copied attributes (`employee_ref`, `role_id`, `break_minutes`, `allocated_percent`, `note`), `last_index` (null; set when a series is ended early), `generated_until` (instant), `created_by`, `created_at`, `updated_at`. CHECKs on the enums and ranges.
- `shifts`: `recurrence_id` (uuid, null), `recurrence_index` (integer, null), `recurrence_detached` (boolean, default false), `copied_from` (uuid, null). Unique index `(organisation_id, recurrence_id, recurrence_index)` where `recurrence_id is not null`, with no `deleted_at` condition (D4).
- New `shift_templates`: `id`, `organisation_id`, `name`, `role_id` (null), `start_time` (`HH:MM`, char 5), `duration_minutes`, `break_minutes`, `created_at`, `updated_at`. Unique `(organisation_id, lower(name))`.
- `organisation_settings`: `recurrence_horizon_months` (smallint 1..24, default 6).

## Generation

One pure function, `occurrences(rule, fromIndex, untilInstant)`, returns `(index, start, end)` in order. It adds `index × interval` units to `first_start_local` in the rule's zone with Luxon, skips step results whose day of month changed (D2), stops at the end condition (`until_date` inclusive, `occurrence_count` counting created steps, `last_index`) and at `untilInstant`. A single run makes at most 1,000 shifts per series. `RecurrenceService.extend(now)` runs per series inside a transaction with `pg_advisory_xact_lock` on the series, inserts with `on conflict do nothing` on the unique index, and moves `generated_until` forward.

## API

- `POST /api/shifts` accepts `repeat: { interval, unit, ends, until_date?, count? }`. It creates the series, the first shift and every occurrence up to the horizon in one transaction and returns `{ shift, conflicts, recurrence: { id, created } }`.
- `PATCH /api/shifts/{id}` accepts `scope` (`this` | `following` | `all`, default `this`) and, for `following` or `all`, an optional `repeat` to change the pattern (D6). It returns the edited shift and `{ updated }`, the number of other shifts changed.
- `DELETE /api/shifts/{id}?scope=following|all` deletes series shifts (D7) and returns `{ deleted }`; without `scope` it is the existing single delete.
- Shift payloads gain `recurrence: { id, interval, unit, ends, until_date, count, index, detached } | null` and `copied_from`.
- `GET|POST /api/shift-templates`, `PATCH|DELETE /api/shift-templates/{id}`; `POST /api/shift-templates` also accepts `{ from_shift_id, name }` (FR-TPL-04).
- `POST /api/week-copies` with `{ week_start }` (a Monday, `YYYY-MM-DD`) returns `{ created, skipped_recurring, skipped_already_copied, skipped_off_roster, conflicts }`. A `dry_run: true` returns the same counts without creating anything, for the confirm.
- `POST /api/shift-splits` with `{ shift_id, version, at }` returns `{ shifts: [first, second] }`.
- `GET|PATCH /api/settings` gains `recurrence_horizon_months`.
- New error codes: `RECURRENCE_PATTERN_SCOPE` (pattern change with `scope=this`), `SPLIT_OUTSIDE` and `BREAK_DOES_NOT_FIT`, all 422 with field details, and `TEMPLATE_NAME_TAKEN` (409).

## UI

- **Shift dialog:** a *Template* picker above the times (filtered per D9), a *Repeat* section (every N days/weeks/months; ends never / on a date / after N shifts), a *Split* button that reveals a time field, and *Save as template* for an existing shift. Saving or deleting a repeated shift asks *This shift / This and following / All*, through a new three-choice confirm in `feedback.tsx`.
- **Schedule:** a small repeat mark on series shifts; *Copy previous week* in the week view, with a confirm showing the dry-run counts.
- **Settings:** a *Templates* tab (list, add, edit, delete) and *Recurrence horizon (months)* in General.

## Testing

- Pure generation tests: every unit, all three end types, month-end skipping, DST at 09:00 local, and the 1,000 cap.
- FR-REC-03 AC1 with a fixed clock: created on 1 Jan, shifts exist to 1 Jul only; after moving the clock to 1 Feb and running the cron, to 1 Aug.
- A deleted occurrence is not regenerated; the three edit scopes and pattern changes behave as D5 and D6; published and detached shifts are untouched.
- FR-PUB-04 AC1: 20 shifts last week, 4 from a series, gives 16 drafts, conflicts flagged; a second copy creates nothing.
- Split: the break goes to the longer part, the refusals, one notice for a published shift.
- FR-TPL-03 filtering and FR-TPL-02's end time.
- One browser test: make a weekly repeat in the dialog and see it next week; copy previous week.

## Not in M3

- Repeats on chosen weekdays (for example Monday, Wednesday and Friday). Make three weekly series instead. A later milestone can add a weekday list without changing D4.
- Undo for series deletes (D7).
- Templates that span several shifts (a whole day's pattern).

## Branching

Built on `feature/m3-recurrence-templates` off `main`, in the main checkout. Each task is merged into that branch, and the branch into `main` at the end.
