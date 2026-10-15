'use client';

import Link from 'next/link';
import type { Me } from '../types';
import { EmployeesTab } from './EmployeesTab';
import { GeneralTab } from './GeneralTab';
import { HolidaysTab } from './HolidaysTab';
import { ManagersTab } from './ManagersTab';
import { RolesTab } from './RolesTab';
import { TimeOffTab } from './TimeOffTab';

const TABS = [
  ['general', 'General'], ['roles', 'Roles'], ['employees', 'Employees'], ['time-off', 'Time off'], ['holidays', 'Holidays'], ['managers', 'Managers'],
] as const;

export function SettingsPage({ me, tab }: { me: Me; tab: string }) {
  const active = TABS.some(([id]) => id === tab) ? tab : 'general';
  return (
    <section className="settings">
      <nav className="tabs" aria-label="Settings">
        {TABS.map(([id, label]) => <Link key={id} href={`/settings/${id}`} aria-current={id === active ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {active === 'general' && <GeneralTab />}
      {active === 'roles' && <RolesTab />}
      {active === 'employees' && <EmployeesTab />}
      {active === 'time-off' && <TimeOffTab me={me} />}
      {active === 'holidays' && <HolidaysTab me={me} />}
      {active === 'managers' && <ManagersTab />}
    </section>
  );
}
