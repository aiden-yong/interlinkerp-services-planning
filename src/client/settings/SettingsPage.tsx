'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ClockIcon, CopyIcon, FlagIcon, GearIcon, PeopleIcon, ShieldIcon, TagIcon } from '../icons';
import type { Me } from '../types';
import { EmployeesTab } from './EmployeesTab';
import { GeneralTab } from './GeneralTab';
import { HolidaysTab } from './HolidaysTab';
import { ManagersTab } from './ManagersTab';
import { RolesTab } from './RolesTab';
import { TemplatesTab } from './TemplatesTab';
import { TimeOffTab } from './TimeOffTab';

const TABS: readonly (readonly [string, string, ReactNode])[] = [
  ['general', 'General', <GearIcon key="general" />], ['roles', 'Roles', <TagIcon key="roles" />], ['templates', 'Templates', <CopyIcon key="templates" />],
  ['employees', 'Employees', <PeopleIcon key="employees" />], ['time-off', 'Time off', <ClockIcon key="time-off" />], ['holidays', 'Holidays', <FlagIcon key="holidays" />], ['managers', 'Managers', <ShieldIcon key="managers" />],
];

export function SettingsPage({ me, tab }: { me: Me; tab: string }) {
  const active = TABS.some(([id]) => id === tab) ? tab : 'general';
  return (
    <section className="settings">
      <header className="page-head">
        <h1>Settings</h1>
        <p>Planning rules, roles, shift templates, working hours and who can manage the schedule.</p>
      </header>
      <nav className="tabs" aria-label="Settings">
        {TABS.map(([id, label, icon]) => <Link key={id} href={`/settings/${id}`} aria-current={id === active ? 'page' : undefined}>{icon}{label}</Link>)}
      </nav>
      {active === 'general' && <GeneralTab />}
      {active === 'roles' && <RolesTab />}
      {active === 'templates' && <TemplatesTab />}
      {active === 'employees' && <EmployeesTab />}
      {active === 'time-off' && <TimeOffTab me={me} />}
      {active === 'holidays' && <HolidaysTab me={me} />}
      {active === 'managers' && <ManagersTab />}
    </section>
  );
}
