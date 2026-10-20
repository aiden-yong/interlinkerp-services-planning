import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { THEME_BOOT_SCRIPT } from '@/client/theme';
import './globals.css';

export const metadata: Metadata = { title: 'Planning · InterlinkERP' };
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#101012' },
  ],
};
// Every page is per-user and must not be cached (auth guide §7).
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set by src/proxy.ts; the page Content-Security-Policy only runs scripts carrying it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // The boot script may set data-theme before React hydrates, so <html> is allowed to differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
