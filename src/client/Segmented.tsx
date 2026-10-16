'use client';

import { type ReactNode, useId } from 'react';

export interface Segment<T extends string> { value: T; label: string; icon?: ReactNode }

/**
 * A segmented control. Radio inputs sit underneath, so arrow keys, Tab and screen readers behave natively.
 * A segment with an icon shows only the icon; its label becomes the accessible name and the tooltip.
 */
export function Segmented<T extends string>({ label, value, segments, onChange, className }: {
  label: string;
  value: T;
  segments: readonly Segment<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={className ? `segmented ${className}` : 'segmented'}>
      {segments.map((s) => (
        <label key={s.value} title={s.icon ? s.label : undefined}>
          <input
            type="radio"
            name={name}
            value={s.value}
            checked={s.value === value}
            aria-label={s.icon ? s.label : undefined}
            onChange={() => onChange(s.value)}
          />
          {s.icon ?? s.label}
        </label>
      ))}
    </div>
  );
}
