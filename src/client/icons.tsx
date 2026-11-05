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
export const ChevronDownIcon = () => <Icon size={12}><path d="M3.5 6 8 10.5 12.5 6" /></Icon>;

export const WarningIcon = () => (
  <Icon size={12}>
    <path d="M8 2.25 14.25 13.5H1.75L8 2.25Z" strokeWidth="1.75" />
    <path d="M8 6.75v2.75M8 11.6v.05" strokeWidth="1.75" />
  </Icon>
);

export const CalendarIcon = () => (
  <Icon>
    <rect x="2" y="3" width="12" height="11" rx="2" />
    <path d="M2 6.5h12M5.25 1.75V4M10.75 1.75V4" />
  </Icon>
);

export const ChartIcon = () => <Icon><path d="M2.25 2.25v11.5h11.5M5 10.5l2.75-3 2.25 2 3-4" /></Icon>;

export const PersonIcon = () => (
  <Icon>
    <circle cx="8" cy="5.25" r="2.75" />
    <path d="M2.75 14c.5-2.75 2.6-4.25 5.25-4.25S12.75 11.25 13.25 14" />
  </Icon>
);

export const PeopleIcon = () => (
  <Icon>
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.75 13.5c.4-2.4 2.1-3.75 4.25-3.75s3.85 1.35 4.25 3.75M10.5 3.25a2.5 2.5 0 0 1 0 4.5M11.75 9.9c1.3.5 2.2 1.75 2.5 3.6" />
  </Icon>
);

export const GearIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
  </Icon>
);

export const TagIcon = () => (
  <Icon>
    <path d="M2.25 2.25h5.5l6 6-5.5 5.5-6-6v-5.5Z" />
    <path d="M5.25 5.25h.05" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5" />
    <path d="M10.75 5.25V3.5a1.25 1.25 0 0 0-1.25-1.25h-6A1.25 1.25 0 0 0 2.25 3.5v6a1.25 1.25 0 0 0 1.25 1.25h1.75" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Icon>
);

export const FlagIcon = () => <Icon><path d="M3.25 14.25V2.25h9l-2 3 2 3h-9" /></Icon>;

export const ShieldIcon = () => <Icon><path d="M8 1.75 13.25 3.5v4c0 3.25-2.25 5.5-5.25 6.75C5 13 2.75 10.75 2.75 7.5v-4L8 1.75Z" /></Icon>;

export const BellIcon = () => (
  <Icon>
    <path d="M3.5 11.25h9l-1-1.5V6.5a3.5 3.5 0 0 0-7 0v3.25l-1 1.5Z" />
    <path d="M6.75 13.5a1.4 1.4 0 0 0 2.5 0" />
  </Icon>
);
