import type { ReactNode } from 'react';

/** 16px line icons drawn in currentColor, so they follow the text colour in both themes. */
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const SunIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />
  </Icon>
);

export const DisplayIcon = () => (
  <Icon>
    <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.5" />
    <path d="M5.5 13.75h5M8 11v2.75" />
  </Icon>
);

export const ChevronLeftIcon = () => <Icon><path d="M10 3.5 5.5 8l4.5 4.5" /></Icon>;
export const ChevronRightIcon = () => <Icon><path d="M6 3.5 10.5 8 6 12.5" /></Icon>;

export const WarningIcon = () => (
  <Icon size={12}>
    <path d="M8 2.25 14.25 13.5H1.75L8 2.25Z" strokeWidth="1.75" />
    <path d="M8 6.75v2.75M8 11.6v.05" strokeWidth="1.75" />
  </Icon>
);

export const PlanningMark = () => (
  <Icon size={18}>
    <rect x="2" y="3" width="12" height="11" rx="2" />
    <path d="M2 6.5h12M5.5 1.75v2.5M10.5 1.75v2.5M5 9.25h3M5 11.5h5" />
  </Icon>
);
