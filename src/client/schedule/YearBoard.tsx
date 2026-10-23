'use client';

import { WarningIcon } from '../icons';
import './year.css';
import type { YearRow } from './year';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const hoursText = (h: number) => `${h.toFixed(1)} hours`;

/** A read-only summary of hours per month. Each cell opens that month in Month scale. */
export function YearBoard({ rows, onPick }: { rows: YearRow[]; onPick: (month: string) => void }) {
  const head = rows.find((r) => r.months.length > 0)?.months ?? [];
  return (
    <div className="year-board">
      <table>
        <thead>
          <tr>
            <th scope="col">Employee</th>
            {head.map((m) => <th scope="col" key={m.month}>{MONTH_NAMES[Number(m.month.slice(5, 7)) - 1].slice(0, 3)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => row.kind === 'header' ? (
            <tr key={row.key} className="group"><th scope="colgroup" colSpan={13}>{row.label}</th></tr>
          ) : (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {row.months.map((m) => {
                const total = m.draft + m.published;
                const open = row.kind === 'open';
                const count = m.openCount ?? 0;
                const name = open
                  ? `${row.label}, ${monthName(m.month)}: ${count} open shift${count === 1 ? '' : 's'}, ${hoursText(total)}`
                  : `${row.label}, ${monthName(m.month)}: ${hoursText(total)}${m.over ? ', over-allocated' : ''}`;
                const cls = [open ? 'open-count' : '', total === 0 && !(open && count > 0) ? 'zero' : '', m.over ? 'over' : ''].filter(Boolean).join(' ');
                return (
                  <td key={m.month}>
                    <button
                      type="button"
                      className={cls || undefined}
                      aria-label={name}
                      style={{ '--pub': total > 0 ? `${(m.published / total) * 100}%` : '0%' } as React.CSSProperties}
                      onClick={() => onPick(m.month)}
                    >
                      {m.over && <><WarningIcon /><span className="visually-hidden">Over-allocated</span></>}
                      <span aria-hidden="true">{open ? (count > 0 ? count : '–') : total > 0 ? total.toFixed(1) : '–'}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
