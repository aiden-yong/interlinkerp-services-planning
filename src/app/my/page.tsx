'use client';

import { AppShell } from '@/client/AppShell';
import { MyPlanningPage } from '@/client/my/MyPlanningPage';

export default function Page() {
  return <AppShell screen="my">{(me) => <MyPlanningPage me={me} />}</AppShell>;
}
