import type { NextConfig } from 'next';
import { API_SECURITY_HEADERS, SECURITY_HEADERS } from './src/server/web/securityHeaders';

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
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      // Pages get a per-request nonce policy from src/proxy.ts instead.
      ...['/api/:path*', '/internal/:path*', '/health', '/openapi.json'].map((source) => ({ source, headers: API_SECURITY_HEADERS })),
      ...['/', '/schedule', '/my', '/settings', '/settings/:path*', '/not-on-roster'].map((source) => ({ source, headers: noStore })),
    ];
  },
};

export default config;
