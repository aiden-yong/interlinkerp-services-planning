import type { NextConfig } from 'next';

// Auth guide §7: authenticated pages must never be served from the browser cache.
const noStore = [
  { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
  { key: 'Pragma', value: 'no-cache' },
  { key: 'Expires', value: '0' },
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  async headers() {
    return ['/', '/schedule', '/my', '/settings', '/settings/:path*', '/not-on-roster'].map((source) => ({ source, headers: noStore }));
  },
};

export default config;
