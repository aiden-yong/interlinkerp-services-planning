'use client';

import { AppShell } from '@/client/AppShell';
import { ReportsPage } from '@/client/reports/ReportsPage';

export default function Page() {
  return <AppShell screen="reports">{(me) => <ReportsPage me={me} />}</AppShell>;
}
