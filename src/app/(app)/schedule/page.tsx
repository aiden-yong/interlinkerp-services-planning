'use client';

import { AppShell } from '@/client/AppShell';
import { SchedulePage } from '@/client/schedule/SchedulePage';

export default function Page() {
  return <AppShell screen="schedule">{(me) => <SchedulePage me={me} />}</AppShell>;
}
