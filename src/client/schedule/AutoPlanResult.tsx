'use client';

import { Modal } from '../feedback';
import type { AutoPlanReport, SchedulePayload } from '../types';
import { describeAutoPlan } from './autoPlan';

export function AutoPlanResult({ report, data, zone, onClose }: { report: AutoPlanReport; data: SchedulePayload; zone: string; onClose: () => void }) {
  const summary = describeAutoPlan(report, data, zone);
  return (
    <Modal title={summary.heading} onClose={onClose}>
      {summary.filled.length > 0 && (<><h3>Assigned</h3><ul className="lines">{summary.filled.map((l) => <li key={l.key}>{l.text}</li>)}</ul></>)}
      {summary.unfilled.length > 0 && (<><h3>Left open</h3><ul className="lines">{summary.unfilled.map((l) => <li key={l.key}>{l.text}</li>)}</ul></>)}
      {summary.notes.length > 0 && <ul className="lines">{summary.notes.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      <p>Assigned shifts stay drafts until you publish.</p>
      <div className="actions"><button type="button" className="primary" autoFocus onClick={onClose}>Close</button></div>
    </Modal>
  );
}
