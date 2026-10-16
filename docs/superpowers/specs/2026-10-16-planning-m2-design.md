# Planning M2 Design: Open Shifts, Giving Up Shifts, Notification Delivery

**Status:** approved 2026-10-16. **Requirements:** [ListOfRequirements.md](../../../ListOfRequirements.md) v0.4 (FR-OPN-01..05, FR-PUB-03, FR-NTF-01..04, FR-CFG-05, BR-05..07, NFR-04, and FR-PUB-01 AC1 completed). **Roadmap:** [M2](../plans/2026-10-13-planning-roadmap.md#m2--open-shifts-giving-up-shifts-notifications).

This document records only the decisions the requirements leave open. It does not restate the requirements.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | How notices are delivered on Vercel Hobby (crons at most daily) | A sweep runs after every API response (Next.js `after()`, throttled to once per 30 s per instance), plus a daily cron route as a backstop. | No new services or cost. A deletion notice that becomes due 30 s after the delete goes out on the next request anyone makes. |
| D2 | Email provider | SMTP through nodemailer, configured by `SMTP_URL` and `MAIL_FROM`. When unset, a mailer that only logs. | Works today with a Gmail or Workspace app password and no domain; any provider later by changing settings. |
| D3 | In-app notifications while the gateway is being updated | Planning keeps its own inbox (a bell in the header). A badge adapter pushes each person's unread count to the gateway. It is off unless `GATEWAY_BADGES=on`. | Only the adapter changes if the gateway's API changes (OI-07). |
| D4 | Scope | All M2 requirements, including the Shoulds (FR-OPN-04, FR-CFG-05, FR-PUB-03). | They reuse the same eligibility and notification code. |
| D5 | Who "Planning Managers" are as notice recipients (FR-NTF-03) | Everyone on the Planning Manager list. Gateway admins who are not on the list do not receive manager notices. | Gateway admins cannot be listed from Planning. An admin who wants notices adds themselves to the list. |

## Data (one migration)

- `shifts`: `switch_requested_at` (instant, null). The requester is always the shift's own employee, so no separate column is kept. A request is active only while the shift has not started, so it lapses by itself when the shift starts (FR-OPN-03 AC3). There is no lapse job and no lapsed state.
- `organisation_settings`: `give_up_mode` (`switch` | `unassign`, default `switch`, CHECK), `unassign_window_days` (smallint 0..60, default 2).
- `employee_directory`: `email` (null). The refresher stores the roster's email, normalised to lower case. Like the display fields it is replaced on every refresh and used only to address emails (DR-02 as amended in v0.4).
- `notification_outbox`: `audience` (`employee` | `managers`, default `employee`), `attempts` (smallint, default 0), `last_error` (text, null). A row addresses one employee (`employee_ref`) or the Planning Manager list (`audience = 'managers'`).
- New `notifications` (the inbox): `id` (bigserial), `organisation_id`, exactly one of `recipient_ref` (an employee) or `recipient_email` (a Planning Manager, from the manager list), so no copy of an employee's email is kept (DR-02), `kind`, `title`, `body`, `link`, `shift_id` (null), `outbox_id`, `created_at`, `read_at` (null), `emailed_at` (null), `email_attempts` (smallint, default 0), `email_next_at` (instant), `email_error` (null). Indexes: `(organisation_id, recipient_ref, created_at)`, `(organisation_id, recipient_email, created_at)`, and a partial index on `email_next_at` for unsent email. A signed-in person's inbox is the rows matching their `employee_ref` or their email.

## Claiming, switching and unassigning (NFR-04)

Each action is one transaction:

1. `pg_advisory_xact_lock(hashtext(org || ':' || employee_ref))` for the acting employee. This stops one person claiming two overlapping shifts in parallel.
2. Eligibility (BR-05): the shift has no role or one of the employee's roles, and taking it creates no BR-01 conflict, using the existing conflict check.
3. One conditional `UPDATE … RETURNING`, which also bumps `version`:
   - **claim** (`POST /api/shift-claims`): `employee_ref is null`, published, not deleted, `start_at > now`.
   - **request switch** (`POST /api/switch-requests`): my shift, published, `start_at > now`, mode is `switch`, no active request.
   - **cancel switch** (`DELETE /api/switch-requests/{shift_id}`): my shift with an active request.
   - **take over** (`POST /api/switch-takeovers`): the request is active, it is still the requester's shift, `start_at > now`. Clears the request.
   - **unassign** (`POST /api/unassignments`): my shift, published, mode is `unassign`, `start_at > now + window days` (BR-06). Sets `employee_ref` to null, so the shift becomes an open shift and stays published.
4. No row → 409 with a specific code: `SHIFT_TAKEN`, `SHIFT_STARTED`, `OUTSIDE_UNASSIGN_WINDOW`, `MODE_NOT_ACTIVE`, or `NOT_UP_FOR_SWITCH`. An eligibility failure is 409 `NOT_ELIGIBLE` with the reasons in `details`.
5. Queue the notices in the same transaction (FR-NTF-03, FR-OPN-03 AC1).

Only an employee on the roster (`employee_ref` set) can claim, switch or unassign. FR-OPN-05 is covered by `start_at > now` in every condition.

Related changes:
- Changing `give_up_mode` to `unassign` clears every active switch request and queues a notice to each owner, in one transaction (BR-07).
- A manager edit that changes a shift's employee clears its switch request.

## Delivery

`DeliveryService.deliverDue()` runs these steps:

1. **Expand.** In one transaction, select due queue rows (`deliver_after <= now`, not delivered, not cancelled) with `FOR UPDATE SKIP LOCKED LIMIT 100`. For each row, resolve the recipients: the employee (`recipient_ref`), or every Planning Manager email (`recipient_email`). Render the message, insert the inbox rows, and mark the queue row delivered. A row whose employee has no email is marked delivered with `last_error` set and no inbox row. A rendering failure increments `attempts`; after 5 attempts the row is marked delivered with the error recorded.
2. **Email.** Select inbox rows with `emailed_at is null`, `email_attempts < 5` and `email_next_at <= now`, again with `FOR UPDATE SKIP LOCKED LIMIT 50`. Address it from the directory email (employees) or the manager email. With no address, record `email_error` and stop retrying. Send each one. On failure, increment the attempts and set `email_next_at = now + 2^attempts minutes`.
3. **Badges.** For every recipient touched in steps 1 and 2, and on mark-read, push the unread count. Batches hold at most 500 entries.

Messages are rendered in one module with times in the recipient's time zone: the employee's profile zone, otherwise the organisation's. Publishing produces one notice per employee that lists their shifts (FR-PUB-01 AC1). The link points to `PUBLIC_URL` plus `/my`, or plus `/schedule` for managers.

Triggers:
- `handleApi` registers `after(() => app.deliveryTrigger().kick())` on every API request. `kick()` is a no-op if it ran within the last 30 s in this instance. It never throws, and it logs failures.
- The `/internal/cron/notifications` route uses the same `CRON_SECRET` check as the directory cron. It is added to `vercel.json` once a day.

Adapters each have a "not configured" version, so local development and tests need nothing:
- **`Mailer`:** an SMTP version (nodemailer, `SMTP_URL`, `MAIL_FROM`) and a log-only version.
- **`BadgePublisher`:** a gateway version that sends `POST {GATEWAY_URL}/api/badges` with body `{service: SERVICE_ID, badges: [{email, count}]}`, using HTTP Basic auth with `INTERLINK_CLIENT_ID` and `INTERLINK_CLIENT_SECRET`. It matches the recruitment app's implementation. There is also a no-op version.
- Neither adapter ever throws. Each returns success or failure.

## API and UI

- `GET /api/my/open-shifts` returns `{ open: [...], up_for_switch: [...] }`: published shifts in the future that I am eligible for. The range is up to 62 days, as for My Planning.
- `GET /api/notifications?unread=` returns my inbox, newest first, 50 per page. `POST /api/notification-reads` accepts `{ ids }` or `{ all: true }` and returns 201 with the number of rows marked.
- `PATCH /api/settings` adds `give_up_mode` and `unassign_window_days`. `GET /api/settings` returns them.
- `POST /api/publications` adds `notify_open_shifts` (boolean). It queues one "open shifts available" notice for each employee who is eligible for at least one of the open shifts being published (FR-PUB-03).
- The schedule payload shows `switch_requested` on a shift.
- UI changes:
  - a bell with the unread count and an inbox panel in `AppShell`, for everyone;
  - a My Planning "Available shifts" section with Claim and Take buttons;
  - a give-up action on my future published shifts that follows the active mode;
  - an "up for switch" marker on the schedule;
  - the mode and window in Settings → General;
  - a checkbox in the publish confirm.

## Testing

- **Claim race:** two separate PostgreSQL connections claim the same shift at once. Exactly one gets 201 and the other gets 409 `SHIFT_TAKEN` (roadmap done-when).
- **One employee, overlapping shifts:** the same employee claims two overlapping open shifts in parallel. One succeeds; the other gets 409 `NOT_ELIGIBLE`.
- **Overlapping sweeps:** two sweeps run at once, and each notice reaches the inbox once.
- **Email retry:** a fake mailer fails twice and then succeeds. After five failures the sweep gives up and the inbox row stays.
- **Refusals:** BR-06 inside the window, FR-OPN-05 after the start, a mode that isn't active, and a role mismatch.
- **Mode change:** switching to `unassign` cancels the active requests and notifies their owners.
- **FR-PUB-03:** only eligible employees get the open-shift notice.

## Not in M2

- Shift reminders (FR-NTF-05, M4).
- Notification preferences and muting, inbox retention or pruning, and push notifications.
- A gateway pop-up or "nudge" protocol beyond badges. Waiting on OI-07.

## Branching

M2 is built on `feature/m2-open-shifts`, in the worktree `.worktrees/m2`, off `main`. The UI tasks touch files that `refactor/planning-ui` is changing (`AppShell.tsx`, `MyPlanningPage.tsx`, `SchedulePage.tsx`, `globals.css`). Merge that branch into `main` before the M2 UI tasks start, then rebase this branch onto it.
