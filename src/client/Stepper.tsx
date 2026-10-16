'use client';

import { ChevronLeftIcon, ChevronRightIcon } from './icons';

/** Previous / back-to-now / next, joined into one control because they act on the same thing. */
export function Stepper({ unit, nowLabel, onStep, onNow }: { unit: string; nowLabel: string; onStep: (direction: -1 | 1) => void; onNow: () => void }) {
  return (
    <div className="stepper" role="group" aria-label={`Change ${unit}`}>
      <button type="button" aria-label={`Previous ${unit}`} onClick={() => onStep(-1)}><ChevronLeftIcon /></button>
      <button type="button" onClick={onNow}>{nowLabel}</button>
      <button type="button" aria-label={`Next ${unit}`} onClick={() => onStep(1)}><ChevronRightIcon /></button>
    </div>
  );
}
