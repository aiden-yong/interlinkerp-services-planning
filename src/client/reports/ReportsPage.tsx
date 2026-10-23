'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import { WarningIcon } from '../icons';
import { Segmented } from '../Segmented';
import { dayLabel } from '../schedule/period';
import { todayIn } from '../schedule/tz';
import type { EmployeeProfile, Me, OpenShiftCell, OpenShiftsReport, PlannedHoursReport, Role, UtilisationReport } from '../types';
import { type Preset, presetRange, type ReportName, reportUrl } from './reportQuery';
import './reports.css';

const TABS = [
  { value: 'planned-hours', label: 'Planned hours' },
  { value: 'utilisation', label: 'Utilisation' },
  { value: 'open-shifts', label: 'Open shifts' },
] as const satisfies readonly { value: ReportName; label: string }[];

type Report = PlannedHoursReport | UtilisationReport | OpenShiftsReport;
const hours = (n: number | null) => (n === null ? '–' : n.toFixed(1));

function PlannedHours({ report }: { report: PlannedHoursReport }) {
  const head = { employee: 'Employee', role: 'Role', department: 'Department' }[report.group];
  if (report.rows.length === 0) return <p className="empty">No shifts in this period.</p>;
  return (
    <table>
      <caption className="visually-hidden">Planned hours by {head.toLowerCase()}</caption>
      <thead>
        <tr><th scope="col">{head}</th><th scope="col" className="num">Draft</th><th scope="col" className="num">Published</th><th scope="col" className="num">Total</th></tr>
      </thead>
      <tbody>
        {report.rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.label}{r.left && <span className="muted"> (left)</span>}</th>
            <td className="num">{hours(r.draft_hours)}</td><td className="num">{hours(r.published_hours)}</td><td className="num">{hours(r.total_hours)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr><th scope="row">Total</th><td className="num">{hours(report.totals.draft_hours)}</td><td className="num">{hours(report.totals.published_hours)}</td><td className="num">{hours(report.totals.total_hours)}</td></tr>
      </tfoot>
    </table>
  );
}

function Utilisation({ report }: { report: UtilisationReport }) {
  if (report.rows.length === 0) return <p className="empty">No one to report on in this period.</p>;
  return (
    <table>
      <caption className="visually-hidden">Utilisation by employee</caption>
      <thead>
        <tr><th scope="col">Employee</th><th scope="col" className="num">Allocated</th><th scope="col" className="num">Available</th><th scope="col" className="num">Utilisation</th><th scope="col">Over-allocated days</th></tr>
      </thead>
      <tbody>
        {report.rows.map((r) => (
          <tr key={r.employee_ref} className={r.over_allocated_days.length > 0 ? 'over-row' : undefined}>
            <th scope="row">{r.name}{r.left && <span className="muted"> (left)</span>}{r.flexible && <span className="muted"> (flexible hours)</span>}</th>
            <td className="num">{hours(r.allocated_hours)}</td>
            <td className="num">{hours(r.available_hours)}</td>
            <td className="num">{r.utilisation_percent === null ? '–' : `${r.utilisation_percent.toFixed(1)}%`}</td>
            <td>
              {r.over_allocated_days.length > 0 && (
                <span className="over"><WarningIcon /> Over-allocated: {r.over_allocated_days.map((d) => dayLabel(d, 'week')).join(', ')}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A day with no shifts is blank (spec D6).
const cellText = (c: OpenShiftCell | undefined) => (c && c.total > 0 ? `${c.open} / ${c.total}` : '');

function OpenShifts({ report }: { report: OpenShiftsReport }) {
  if (report.rows.length === 0) return <p className="empty">No shifts in this period.</p>;
  return (
    <table className="grid">
      <caption className="visually-hidden">Open shifts out of all shifts, by role and day</caption>
      <thead>
        <tr><th scope="col">Role</th>{report.days.map((d) => <th scope="col" key={d} className="num">{dayLabel(d, 'week')}</th>)}</tr>
      </thead>
      <tbody>
        {report.rows.map((r) => (
          <tr key={r.role_id ?? 'none'}>
            <th scope="row">{r.label}</th>
            {report.days.map((d) => <td key={d} className={r.cells[d]?.open ? 'num has-open' : 'num'}>{cellText(r.cells[d])}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr><th scope="row">Total</th>{report.days.map((d) => <td key={d} className="num">{cellText(report.totals[d])}</td>)}</tr>
      </tfoot>
    </table>
  );
}

export function ReportsPage({ me }: { me: Me }) {
  const { toast } = useFeedback();
  const zone = me.timezone || me.organisation_timezone; // the same zone as the schedule, so the numbers match
  const [tab, setTab] = useState<ReportName>('planned-hours');
  const [preset, setPreset] = useState<Preset>('this-week');
  const [custom, setCustom] = useState(() => presetRange('this-week', todayIn(zone)));
  const [group, setGroup] = useState('employee');
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<[string, string][]>([]);
  const [state, setState] = useState<{ kind: ReportName | null; report: Report | null; error: string | null; loading: boolean }>({ kind: null, report: null, error: null, loading: true });

  const range = useMemo(() => (preset === 'custom' ? custom : presetRange(preset, todayIn(zone))), [preset, custom, zone]);
  const valid = Boolean(range.from && range.to && range.from <= range.to);

  useEffect(() => {
    api<{ roles: Role[] }>('GET', '/api/roles').then((r) => setRoles(r.roles), (e: Error) => toast(`Roles could not be loaded: ${e.message}`, undefined, 6000));
    api<{ employees: EmployeeProfile[] }>('GET', '/api/employees').then((r) => {
      const named = r.employees.filter((e) => e.department_id).map((e) => [e.department_id!, e.department_name ?? e.department_id!] as [string, string]);
      setDepartments([...new Map(named)].sort((a, b) => a[1].localeCompare(b[1])));
    }, (e: Error) => toast(`Departments could not be loaded: ${e.message}`, undefined, 6000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = {
    ...range, roleId, timezone: zone,
    group: tab === 'planned-hours' ? group : undefined,
    publishedOnly: tab === 'open-shifts' ? publishedOnly : undefined,
    departmentId: tab === 'open-shifts' ? undefined : departmentId,
  };
  const jsonUrl = valid ? reportUrl(tab, filters, 'json') : null;
  const csvUrl = valid ? reportUrl(tab, filters, 'csv') : null;

  const latest = useRef(0);
  useEffect(() => {
    if (!jsonUrl) return;
    const request = ++latest.current;
    const kind = tab;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<Report>('GET', jsonUrl).then(
      (report) => { if (request === latest.current) setState({ kind, report, error: null, loading: false }); },
      (e: Error) => { if (request === latest.current) setState({ kind, report: null, error: e.message, loading: false }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jsonUrl]);

  // Only a report that belongs to the active tab is drawn; the previous tab's data is never read as another shape.
  const shown = valid && state.report && !state.loading && state.kind === tab ? state.report : null;
  return (
    <section className="reports">
      <div className="toolbar">
        <h1 className="period">Reports</h1>
        <span className="spacer" />
        <Segmented label="Report" value={tab} segments={TABS} onChange={setTab} />
      </div>
      <div className="filters">
        <select aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          <option value="this-week">This week</option><option value="this-month">This month</option>
          <option value="last-month">Last month</option><option value="custom">Custom</option>
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
        {tab === 'planned-hours' && (
          <select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="employee">By employee</option><option value="role">By role</option><option value="department">By department</option>
          </select>
        )}
        <select aria-label="Filter by role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">All roles</option>
          {roles.filter((r) => !r.archived).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {tab !== 'open-shifts' && (
          <select aria-label="Filter by department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        {tab === 'open-shifts' && (
          <label className="check"><input type="checkbox" checked={publishedOnly} onChange={(e) => setPublishedOnly(e.target.checked)} /> Published only</label>
        )}
        <span className="spacer" />
        {csvUrl ? <a className="button" href={csvUrl} download>Download CSV</a> : <span className="button" aria-disabled="true">Download CSV</span>}
      </div>
      {!valid && <p role="alert" className="form-error">Choose a start date that is on or before the end date.</p>}
      {state.error && valid && <p role="alert" className="form-error">{state.error}</p>}
      {valid && state.loading && <p className="empty" role="status">Loading…</p>}
      {shown && (
        <div className="table-wrap">
          {tab === 'planned-hours' && <PlannedHours report={shown as PlannedHoursReport} />}
          {tab === 'utilisation' && <Utilisation report={shown as UtilisationReport} />}
          {tab === 'open-shifts' && <OpenShifts report={shown as OpenShiftsReport} />}
        </div>
      )}
    </section>
  );
}
