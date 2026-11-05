import type { ReactNode } from 'react';
import { AppFrame } from '@/client/AppShell';

/** A route group, so every page shares one header that stays mounted between them. URLs don't change. */
export default function Layout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
