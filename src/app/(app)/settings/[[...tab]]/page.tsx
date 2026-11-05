'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/client/AppShell';
import { SettingsPage } from '@/client/settings/SettingsPage';

export default function Page() {
  const params = useParams<{ tab?: string[] }>();
  return <AppShell screen="settings">{(me) => <SettingsPage me={me} tab={params.tab?.[0] ?? 'general'} />}</AppShell>;
}
