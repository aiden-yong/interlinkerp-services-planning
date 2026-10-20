/** Improvement backlog item 4: headers that stop framing, MIME sniffing and stray scripts. */
export interface HeaderPair {
  key: string;
  value: string;
}

/** Sent on every response, pages and API alike. Browsers ignore HSTS over plain-HTTP localhost. */
export const SECURITY_HEADERS: HeaderPair[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

/** JSON responses never load anything, so their policy allows nothing. */
export const API_SECURITY_HEADERS: HeaderPair[] = [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }];

/**
 * The page policy. Next.js reads the nonce from this header on the request and tags its own
 * scripts with it; the root layout tags the theme boot script. Inline styles stay allowed because
 * the schedule board positions shifts with style attributes. Employee photos may come from any
 * HTTPS host the directory points at.
 */
export function pageContentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
