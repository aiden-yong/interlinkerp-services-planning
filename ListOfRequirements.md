# InterlinkERP Planning — Software Requirements Specification

| | |
|---|---|
| Version | 0.4 (draft, reviewed) |
| Date | 2026-10-16 |
| Department | Services |
| Status | For review |

---

## 0. About this document

**Purpose.** This document states *what* the Planning app must do, so it can be built and checked against. It does not say *how* screens look; layout, colours and interaction details go in a separate UI spec.

**Format.** Lean form of ISO/IEC/IEEE 29148. Section numbers and IDs are kept stable so the document can be expanded into a full 29148 SRS later without renumbering.

**Requirement IDs.**

| Prefix | Meaning |
|---|---|
| `FR-<AREA>-nn` | Functional requirement |
| `BR-nn` | Business rule, referenced by FRs |
| `NFR-nn` | Non-functional requirement |
| `DR-nn` | Data requirement |
| `IF-nn` | External interface |
| `OI-nn` | Open issue |

IDs are never reused. A removed requirement is marked *Withdrawn*, not deleted.

**Priority (MoSCoW), scoped to release 1.**

| Value | Meaning |
|---|---|
| Must | Release 1 is not usable without it |
| Should | Planned for release 1; can slip to the next release without breaking it |
| Could | Nice to have; only if time allows |
| Won't | Explicitly not in release 1 (see §8) |

**Source codes.**

| Code | Meaning |
|---|---|
| ODOO-DOC | Odoo Planning official documentation (19.0 / 17.0) |
| ODOO-PAGE | Odoo Planning product page |
| VENDOR | Third-party Odoo guides; used only where they do not contradict ODOO-DOC |
| INTERLINK | InterlinkERP service contract, authentication and performance guides |
| OWN | Decision made for this project |

Each requirement states "The system shall …" and has acceptance criteria (AC) in Given / When / Then form. A requirement is done when all its ACs pass.

---

## 1. Glossary

| Term | Definition |
|---|---|
| Shift | A block of time, with a start and end, during which an employee is planned to work, optionally in a role. |
| Open shift | A shift with no employee assigned. |
| Draft | A shift visible only to Planning Managers. Employees are not notified of it. |
| Published | A shift visible to the assigned employee (or, if open, to eligible employees). |
| Role | A job function a shift needs (e.g. "Technician", "Receptionist"). |
| Default role | The role preselected when creating a shift for an employee; preferred by Auto Plan. |
| Employee | A person on the InterlinkERP employee roster (IF-02). Every roster employee can be planned. Identified by `employee_ref`. |
| Working hours | An employee's regular weekly schedule, with a time zone. |
| Flexible hours | An employee with no working hours set. |
| Allocated percentage | The share of the employee's time a shift takes, 1–100 %. Default 100 %. |
| Allocated hours | Hours a shift counts against an employee (see BR-04). |
| Available hours | Hours an employee can be planned in a period: working hours minus unavailability (see BR-04). |
| Break | Unpaid time inside a shift, in minutes. Not counted in allocated hours. |
| Unavailability | A period an employee cannot be planned: personal time off or a public holiday. |
| Recurrence | A rule that repeats a shift at a fixed interval. |
| Planning period | The date range currently shown in the schedule (a day, week, month or year). |
| Give-up mode | The organisation-wide setting choosing how employees release shifts: *Switch* or *Unassign* (BR-07). |

---

## 2. Users and permissions

| Actor | Who | Identified by |
|---|---|---|
| Planning Manager | Plans and publishes schedules | Gateway role `admin`, or listed in Planning's manager list (BR-12) |
| Employee | Views own schedule, claims and releases shifts | Gateway sign-in matched to an employee on the roster (IF-02) |

A signed-in person can be both. A signed-in person who is not a Planning Manager and is not on the roster sees a "not on the planning roster" message and nothing else.

| Capability | Manager | Employee |
|---|---|---|
| View all schedules, drafts and open shifts | ✓ | — |
| Create, edit, delete, publish shifts | ✓ | — |
| Copy previous period, Auto Plan | ✓ | — |
| Manage roles, templates, unavailability, settings | ✓ | — |
| Grant and revoke Planning Manager access | ✓ | — |
| View reports | ✓ | — |
| View own published shifts | ✓ | ✓ |
| View published open shifts for own roles | ✓ | ✓ |
| Claim an open shift | ✓ | ✓ |
| Ask to switch / mark unavailable on own shift | ✓ | ✓ |

**FR-ACC-01** · Must · INTERLINK
The system shall authenticate every request through the live gateway session, authorise it by BR-12, and shall hold no local passwords or login.
- AC1: Given an employee without the manager role, when they call any manager-only endpoint, then the system returns 403.
- AC2: Given a person who signed out at the gateway, when they make their next request, then the system rejects it and the UI locks.

**FR-ACC-02** · Must · ODOO-DOC
The system shall open on the user's own schedule (My Planning) for employees, and on the Schedule for Planning Managers.
- AC1: Given an employee without the manager role, when they open the app, then they land on My Planning and see no navigation to Schedule, Reports or Settings.

**FR-ACC-03** · Must · INTERLINK, OWN
The system shall let a Planning Manager grant and revoke Planning Manager access for a person, chosen from the roster (IF-02) and stored by the email address the gateway verifies at sign-in (the roster does not know gateway sub ids).
- AC1: Given a fresh install with an empty manager list, when a gateway `admin` signs in, then they are a Planning Manager and can grant access to others.
- AC2: Given a manager revokes someone's access, when that person makes their next request, then they are treated as an employee.
- AC3: Given only one non-admin manager remains, when they try to revoke themselves, then the system warns them before allowing it (gateway admins can always restore access).

---

## 3. Functional requirements

### 3.1 SCH — Schedule (manager)

**FR-SCH-01** · Must · ODOO-DOC
The system shall show shifts on a timeline with one row per employee, grouped by Employee or by Role.
- AC1: Given grouping by Employee, when the schedule loads, then every employee has a row, including employees with no shifts in the period.
- AC2: Given grouping by Role, when the schedule loads, then each role is a group containing the employees who have shifts in that role, and each shift appears under its role. Shifts with no role appear under "No role".

**FR-SCH-02** · Must · ODOO-DOC
The system shall show open shifts in their own row group, separate from assigned shifts.

**FR-SCH-03** · Must · VENDOR
The system shall let the manager change the planning period to Day, Week or Month, and move to the previous, current or next period.

**FR-SCH-04** · Could · VENDOR
The system shall offer a Year scale.

**FR-SCH-05** · Should · VENDOR
The system shall let the manager group by Department (department from IF-03).

**FR-SCH-06** · Must · OWN
The system shall filter the schedule by role, department, employee name, and state (draft / published / open).
- AC1: Given filter "draft", when applied, then only draft shifts are shown and all employee rows remain visible.

**FR-SCH-07** · Must · ODOO-DOC, VENDOR
The system shall visually distinguish draft from published shifts, and mark employee unavailability (ODOO-DOC) and periods outside working hours (VENDOR) on each row.

**FR-SCH-08** · Must · OWN
The system shall show each employee's allocated hours against available hours for the planning period, and mark days on which the employee is over-allocated (BR-04).

**FR-SCH-09** · Must · ODOO-DOC
The system shall flag every shift that breaks a conflict rule (BR-01) directly on the schedule, with the reason available on hover or open.

### 3.2 SHF — Shift lifecycle

**FR-SHF-01** · Must · ODOO-DOC
The system shall let a manager create a shift. The planned date and time range is the only required input; employee, role, template, break, allocated percentage and note are optional.
- AC1: Given a new shift with no employee, when saved, then it is created as an open draft shift.
- AC2: Given a new shift for an employee who has a default role, when the form opens, then the role is preset to that default role.

**FR-SHF-02** · Must · ODOO-DOC
The system shall let a manager create a shift by selecting an empty slot on an employee's row (or the open-shift row), preset to that employee and time.

**FR-SHF-03** · Must · ODOO-DOC
The system shall let a manager move a shift to another time or another employee (or the open-shift row), and change its start or end, directly on the schedule.
- AC1: Given a published shift moved to another employee, when saved, then it stays published (BR-11) and both the old and new employee are notified (FR-NTF-02).

**FR-SHF-04** · Must · VENDOR
The system shall support shifts that span more than one day.
- AC1: Given a shift from 22:00 Monday to 06:00 Tuesday, when shown in Week scale, then it appears as one continuous shift across both days.

**FR-SHF-05** · Must · ODOO-DOC
The system shall let a manager duplicate a shift.

**FR-SHF-06** · Should · ODOO-DOC
The system shall let a manager split a shift at a chosen time into two shifts with the same attributes.

**FR-SHF-07** · Must · OWN
The system shall let a manager delete a shift, with confirmation and an undo available for at least 10 seconds.
- AC1: Given a published shift is deleted and then undone within the undo window, then no deletion notification is sent.

**FR-SHF-08** · Must · ODOO-DOC
The system shall let a manager set an allocated percentage (1–100 %) on a shift and shall compute allocated hours (BR-04).

**FR-SHF-09** · Must · OWN
The system shall warn, not block, when a manager saves a shift that breaks a conflict rule (BR-01, BR-02), and shall record that the manager saved it anyway.
- AC1: Given an employee with approved unavailability on Friday, when a manager saves a Friday shift for them, then a warning is shown, the manager can confirm, and the shift saves with its conflict flag.

**FR-SHF-10** · Must · ODOO-DOC
The system shall let a manager attach a note to a shift, included in the employee's notification.

### 3.3 REC — Recurrence

**FR-REC-01** · Must · ODOO-DOC
The system shall let a manager repeat a shift every N days, weeks or months, ending on a date, after a number of occurrences, or never.

**FR-REC-02** · Must · ODOO-DOC
The system shall create repeated shifts as drafts, copying every attribute except the date.

**FR-REC-03** · Must · ODOO-DOC
The system shall generate occurrences only up to the recurrence horizon (BR-08) and keep extending as time passes.
- AC1: Given a weekly recurrence with no end and a 6-month horizon, when created on 1 Jan, then occurrences exist up to 1 Jul only; on 1 Feb, occurrences exist up to 1 Aug.

**FR-REC-04** · Should · OWN
The system shall let a manager edit or delete *this shift*, *this and following*, or *all* shifts in a recurrence.

### 3.4 TPL — Shift templates

**FR-TPL-01** · Must · ODOO-DOC, OWN
The system shall let a manager create, edit and delete shift templates with a name, role, start time and duration (ODOO-DOC), plus an optional break (OWN).

**FR-TPL-02** · Must · OWN
The system shall prefill a new shift from a selected template, setting the end time to start time + duration + break.
(Odoo instead stretches the end time over the employee's working hours; this project uses the simpler fixed rule.)

**FR-TPL-03** · Must · ODOO-DOC
The system shall offer only templates whose role is one of the selected employee's roles. If the employee has no roles, all templates are offered.

**FR-TPL-04** · Should · ODOO-DOC
The system shall let a manager save an existing shift as a new template.

### 3.5 PUB — Publishing and copying

**FR-PUB-01** · Must · ODOO-DOC, VENDOR
The system shall let a manager publish one shift (ODOO-DOC), or every draft shift in the current planning period and filter (VENDOR).
- AC1: Given 12 draft shifts across 5 employees in the week, when the manager publishes the week, then all 12 become published and each of the 5 employees receives one notification listing their shifts.

**FR-PUB-02** · Must · ODOO-DOC
The system shall not show drafts to employees or notify them about drafts.

**FR-PUB-03** · Should · VENDOR
When publishing a period, the system shall let the manager choose whether to also notify eligible employees (BR-05) of the open shifts being published.

**FR-PUB-04** · Must · VENDOR
The system shall copy the previous week's shifts into the current week as drafts, keeping assignments, roles and notes. Shifts that belong to a recurrence are not copied, because the recurrence already generates them.
- AC1: Given last week has 20 shifts, 4 of them from a recurrence, when the manager copies the previous week, then 16 draft shifts are created at the same weekdays and times this week, and any that break BR-01 are flagged.

### 3.6 OPN — Open shifts and giving up shifts

**FR-OPN-01** · Must · ODOO-DOC
The system shall show employees the published open shifts they are eligible for (BR-05).

**FR-OPN-02** · Must · ODOO-PAGE, VENDOR, OWN
The system shall let an employee claim an eligible open shift (ODOO-PAGE, VENDOR). The claim takes effect immediately; no approval is required (OWN).
- AC1: Given an eligible employee, when they claim an open shift, then it is assigned to them, stays published, and the manager is notified.
- AC2: Given an employee who would break BR-01 by taking the shift, when they try to claim it, then the claim is refused with the reason.
- AC3: Given two employees claiming the same shift at the same moment, then exactly one succeeds and the other is told it was already taken.

**FR-OPN-03** · Must · ODOO-DOC
In *Switch* mode (BR-07), the system shall let an employee mark a future published shift as "up for switch". The shift stays theirs until an eligible colleague takes it.
- AC1: Given a shift up for switch, when an eligible colleague takes it, then it is reassigned to the colleague and both people and the manager are notified.
- AC2: Given a shift up for switch, when the employee cancels the request before anyone takes it, then the shift returns to normal.
- AC3: Given a shift up for switch that nobody takes, when the shift starts, then the request lapses and the shift stays with the original employee.

**FR-OPN-04** · Should · ODOO-DOC
In *Unassign* mode (BR-07), the system shall let an employee mark a future published shift as unavailable, inside the unassign window (BR-06). The shift becomes an open shift.
- AC1: Given an unassign window of 2 days, when an employee tries to unassign a shift starting in 1 day, then the action is refused.

**FR-OPN-05** · Must · ODOO-DOC
The system shall not allow switching or unassigning past or already-started shifts.

### 3.7 MYP — My Planning (employee)

**FR-MYP-01** · Must · ODOO-DOC
The system shall show an employee their own published shifts as a list and a week calendar, in their time zone.

**FR-MYP-02** · Must · OWN
My Planning shall be usable on a phone (see NFR-08).

**FR-MYP-03** · Could · OWN
The system shall give each employee a private calendar feed (iCalendar) of their published shifts.

### 3.8 AUT — Auto Plan

**FR-AUT-01** · Should · ODOO-DOC
The system shall assign open shifts in the current planning period automatically, following BR-09, and leave results as drafts.
- AC1: Given 10 open shifts and 6 eligible employees, when Auto Plan runs, then each assignment satisfies BR-09, no new conflict (BR-01) is created, and nothing is sent to employees until the manager publishes.

**FR-AUT-02** · Should · OWN
The system shall report how many open shifts Auto Plan filled and which it could not fill, with the reason for each.

### 3.9 NTF — Notifications

**FR-NTF-01** · Must · ODOO-DOC
The system shall notify each employee of their shifts when the shifts are published (FR-PUB-01).

**FR-NTF-02** · Must · OWN
The system shall notify affected employees when a published shift's time, assignee, role or note changes, or when it is deleted. Deletion notices are sent only after the undo window closes (FR-SHF-07).

**FR-NTF-03** · Must · OWN
The system shall notify Planning Managers when an open shift is claimed, switched or unassigned. Recipients are the people on the Planning Manager list (FR-ACC-03); gateway admins who are not on the list do not receive these notices.

**FR-NTF-04** · Must · INTERLINK
The system shall deliver notifications in-app through the InterlinkERP notification standard (gateway badge sync), and by email.

**FR-NTF-05** · Could · OWN
The system shall send a reminder to an employee a configurable time before each published shift.

### 3.10 RPT — Reporting

**FR-RPT-01** · Must · ODOO-PAGE
The system shall report planned (allocated) hours grouped by employee, role and department, over a chosen period, with draft and published shown separately.

**FR-RPT-02** · Should · ODOO-PAGE
The system shall export any report to CSV.

**FR-RPT-03** · Should · OWN
The system shall report utilisation per employee (allocated hours ÷ available hours, BR-04) and list over-allocated employees.

**FR-RPT-04** · Could · OWN
The system shall report open shifts per role per day, showing how many are unfilled.

### 3.11 CFG — Configuration

**FR-CFG-01** · Must · ODOO-DOC
The system shall let a manager create, edit and archive roles, each with a name and colour.

**FR-CFG-02** · Must · ODOO-DOC
The system shall let a manager set each employee's planning profile: roles, one default role, and working hours with time zone, or none (flexible hours).
- AC1: Given an employee whose profile has never been set, when they appear in Planning, then they are treated as having no roles and flexible hours, in the organisation's time zone.

**FR-CFG-03** · Must · OWN
The system shall let a manager record, edit and delete personal unavailability for an employee (start, end, reason), until an HR leave service exists (IF-05, OI-01).

**FR-CFG-04** · Must · OWN
The system shall load public holidays automatically for the organisation's selected country and state/region from a holiday provider (IF-06), and let a manager add, edit or hide individual holidays.
- AC1: Given country and state are set, when a new calendar year starts, then that year's holidays are loaded without manual action.
- AC2: Given a manager hid a provider holiday, when holidays are re-synced, then it stays hidden.

**FR-CFG-05** · Should · ODOO-DOC
The system shall let a manager set the give-up mode (Switch or Unassign) and the unassign window (BR-06, BR-07). Ships together with FR-OPN-04; until then the mode is fixed at Switch.

**FR-CFG-06** · Should · ODOO-DOC
The system shall let a manager change the recurrence horizon (BR-08).

---

## 4. Business rules

**BR-01 Conflict.** A shift is in conflict when any of these is true for its assigned employee:
- (a) it overlaps another shift of theirs and the overlapping shifts' allocated percentages add up to more than 100 %;
- (b) it overlaps their unavailability (personal or public holiday);
- (c) its role is not one of the employee's roles (only checked if the employee has roles).

Open shifts are never in conflict. Over-allocation (BR-04) is shown as an indicator, not a conflict, so employees can still pick up extra shifts. Source: ODOO-DOC (a, b), OWN (c).

**BR-02 Warn or block.** Manager actions that create a conflict *warn* and can be saved anyway (FR-SHF-09). Employee self-service actions (claim, take a switch) that would create a conflict are *blocked*. Auto Plan never creates a conflict. Source: OWN.

**BR-03 Outside working hours.** A shift partly outside an employee's working hours is allowed and shown (FR-SCH-07). It is not a conflict. Source: OWN.

**BR-04 Allocation.**
- *Allocated hours* of a shift = (shift duration − break) × allocated percentage. Time outside working hours counts (e.g. weekend overtime).
- *Available hours* of an employee for a day = their working hours that day minus unavailability. Flexible-hours employees have no available-hours limit.
- An employee is *over-allocated* on a day when the allocated hours of their shifts that day exceed their available hours that day. Flexible-hours employees are never over-allocated.
- A shift spanning midnight counts its hours on each day it covers.

Source: ODOO-DOC (allocated time and percentage), VENDOR (over-allocation), OWN (counting time outside working hours; Odoo derives allocated time from the working schedule only, which under-counts overtime).

**BR-05 Eligibility to take a shift.** Applies to claiming an open shift and taking a shift up for switch. An employee is eligible when the shift has no role, or its role is one of their roles, and taking it would not create a conflict (BR-01). Public holidays do not count against eligibility: a manager who publishes a shift on a holiday has decided it should be worked. Source: ODOO-DOC; OWN (holidays).

**BR-06 Unassign window.** An employee may unassign a shift only if it starts more than N days from now. N is set by a manager. Default N = 2. Source: ODOO-DOC (setting), OWN (default value).

**BR-07 Give-up mode.** Exactly one of *Switch* or *Unassign* is active at a time. Default is *Switch*. Changing the mode to *Unassign* cancels pending switch requests and notifies their owners. Source: ODOO-DOC (mode), OWN (cancelling pending requests).

**BR-08 Recurrence horizon.** Recurring shifts are generated up to H months ahead. Default H = 6. Source: ODOO-DOC.

**BR-09 Auto Plan.**
- Assign only eligible employees (BR-05).
- Prefer employees whose *default* role matches the shift.
- Skip flexible-hours employees and employees with no roles.
- Respect working hours: never assign beyond them.

Source: ODOO-DOC. How ties are broken is OI-04.

**BR-10 Time.** All instants are stored in UTC. Each employee's working hours carry a time zone. Shifts display in the viewer's time zone: the zone on the viewer's own planning profile, or the organisation's when they have none. The schedule's days start and end at midnight in that zone, and times entered in the shift form are read in it. Source: OWN.

**BR-11 Editing published shifts.** Editing a published shift keeps it published; affected employees are notified (FR-NTF-02). There is no "unpublish". Source: OWN.

**BR-12 Who is a Planning Manager.** A signed-in person is a Planning Manager if, and only if, their gateway `role` is `admin` or the email address in their gateway-verified identity token is in Planning's manager list. Every other signed-in person is at most an Employee. A missing or unrecognised gateway role never grants manager access. Source: INTERLINK (gateway owns authentication, apps own app-specific authorisation), OWN.

---

## 5. Data requirements

**DR-01** · Must
Planning owns these entities in its own private database:
- Role
- Employee planning profile (roles, default role, working hours, time zone)
- Shift
- Recurrence
- Shift template
- Unavailability
- Public holiday (with provider id and hidden flag)
- Settings
- Manager grant (email, granted by, granted at)
- Audit entry

**DR-02** · Must
Planning shall not keep its own copy of employee personal data. It stores `employee_ref` (the roster id) as the only lasting reference. Display fields (name, photo URL, department) may be cached for at most 24 hours to meet NFR-01, and are refreshed from IF-02 / IF-03. The work email may be cached on the same terms, only to address notification emails (FR-NTF-04); notification records refer to employees by `employee_ref`, never by a stored copy of their email.

**DR-03** · Must
Personal unavailability shall be stored so it can be retired when an HR leave service exists (IF-05), without changing Shift or Auto Plan logic.

**DR-04** · Should
The system shall record who created, published, changed and deleted each shift, and when.

**DR-05** · Must
No entity shall assume a single organisation. Organisation-wide values (country, state/region, default time zone, give-up mode, unassign window, recurrence horizon) live in Settings, not in code (NFR-10).

---

## 6. External interfaces

| ID | Interface | Use | Priority |
|---|---|---|---|
| IF-01 | InterlinkERP gateway | Sign-in, token verification (JWKS), per-request session check, role claims | Must |
| IF-02 | Employee roster service (intern-database for release 1, OI-03) | List of plannable employees, names, photos, matching sign-in email to `employee_ref` | Must |
| IF-03 | Department service | Department names for grouping and filtering | Should |
| IF-04 | Notifications: InterlinkERP gateway badge API (unread counts) + email over SMTP | Delivery for FR-NTF-* | Must |
| IF-05 | HR leave service (future) | Approved leave, replacing FR-CFG-03 | Won't (release 1) |
| IF-06 | Public holiday provider | Holidays by country and state/region | Must |
| IF-07 | `/health` and `/openapi.json` | Discovery by the gateway, per the InterlinkERP service contract | Must |

Server-to-server calls (IF-02, IF-03, IF-05) use the app's own client credentials, never the user's token.

---

## 7. Non-functional requirements

**NFR-01 Performance — schedule.** Week view for 50 employees and 300 shifts: API response p95 ≤ 500 ms; fully rendered ≤ 1.5 s on a mid-range laptop (warm server).

**NFR-02 Performance — health.** `/health` responds p95 ≤ 300 ms warm and always < 1 s, with only a cheap database check.

**NFR-03 Security.** No local login, passwords or user table. Every request verifies the token signature and checks the live gateway session, with no caching of that check. Lock within one request of gateway sign-out.

**NFR-04 Concurrency.** Claiming and switch-taking are atomic: under simultaneous requests for the same shift, exactly one succeeds (FR-OPN-02 AC3).

**NFR-05 Time correctness.** Shifts across daylight-saving changes and midnight keep correct durations. Allocation is computed in each employee's time zone (BR-10).

**NFR-06 Reliability.** If an external service (IF-02, IF-03, IF-06) is down, the schedule still loads from Planning's own data, showing missing names, photos or departments as placeholders. External failures never block a manager from planning.

**NFR-07 Accessibility.** Every action possible by drag-and-drop is also possible through a form or keyboard. Forms meet WCAG 2.1 AA.

**NFR-08 Devices.**
- Schedule: supported from 1024 px wide.
- My Planning: fully usable from 360 px wide.
- Browsers: latest two versions of Chrome, Edge, Firefox and Safari.

**NFR-09 Service contract.** The service meets the InterlinkERP service contract: JSON over HTTP, `/health`, `/openapi.json`, standard error shape, and a `version` that changes whenever the API changes.

**NFR-10 Multi-organisation readiness.** Nothing in code or schema hard-codes a single organisation, so tenancy can be added later. Release 1 itself serves one organisation.

**NFR-11 Hosting.** Runs on serverless hosting with no always-on worker. Periodic work (recurrence extension FR-REC-03, holiday sync FR-CFG-04, reminders FR-NTF-05) runs on a scheduled trigger or when data is requested.

---

## 8. Out of scope for release 1

| Item | Reason |
|---|---|
| Planning shifts from sales orders; linking services to roles | No sales service in the ERP |
| Planning by project, project deadlines | No project service yet; revisit when one exists |
| Materials and equipment as resources | Services department plans people first |
| Custom fields per role (Odoo "property fields") | Low value for release 1 |
| Timesheet progress on shifts; planned vs. actual hours | No timesheet or attendance service |
| Payroll from shifts | Belongs to a payroll service |
| Live field map | Not needed |
| Link-based access for employees without a gateway account | The gateway is the only sign-in (OI-05) |
| Manager approval for claims | Decided: claims are instant (FR-OPN-02) |
| Integration with HR leave service (IF-05) | Service does not exist yet (OI-01) |

---

## 9. Open issues

| ID | Issue | Needed by | Default if undecided |
|---|---|---|---|
| OI-01 | Which future service will own approved leave, and when. Triggers retirement of FR-CFG-03. | Post-release 1 | Planning keeps storing unavailability |
| OI-02 | Which holiday provider (IF-06). Nager.Date has no Malaysia data; Calendarific and others need checking for state-level coverage and cost. | Before FR-CFG-04 | Manual holidays only until chosen |
| OI-03 | **Resolved 2026-10-13:** the employee roster is intern-database for release 1. May change later; IF-02 is the only place that knows the roster source. | — | — |
| OI-04 | Auto Plan tie-break: spread load evenly, or fill one person first. | Before FR-AUT-01 | Spread evenly |
| OI-05 | Whether employees without a gateway account need any access. | Post-release 1 | No access |
| OI-06 | **Resolved 2026-10-13:** the gateway has no per-app roles (only `admin`/`hr`/`supervisor`/`user`). Planning Managers are gateway admins plus a local manager list (BR-12, FR-ACC-03). | — | — |
| OI-07 | The gateway is being updated; its notification standard (badges and pop-ups) may change. Planning implements the badge API the recruitment app uses, behind an adapter that is off until the gateway is connected. | Before connecting to the gateway | Badges off; in-app inbox and email only |

---

## Appendix A. Source references

| Code | Reference |
|---|---|
| ODOO-DOC | https://www.odoo.com/documentation/19.0/applications/services/planning.html and the 17.0 equivalent |
| ODOO-PAGE | https://www.odoo.com/app/planning |
| VENDOR | https://octurasolutions.com/resources/odoo-19-planning-and-shift-management-schedule-your-workforce-with-precision and https://www.cybrosys.com/slides/multi-day-shift-creation-from-gantt-view-in-odoo-19-planning |
| INTERLINK | InterlinkERP service contract, microapp authentication and performance guides |
| Format | ISO/IEC/IEEE 29148:2018 |
