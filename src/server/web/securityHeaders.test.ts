import { describe, expect, it } from 'vitest';
import { API_SECURITY_HEADERS, pageContentSecurityPolicy, SECURITY_HEADERS } from './securityHeaders';

describe('security headers', () => {
  it('sets HSTS, nosniff and the referrer policy on every response', () => {
    expect(Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]))).toEqual({
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });

  it('locks JSON responses down completely', () => {
    expect(API_SECURITY_HEADERS).toEqual([{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }]);
  });

  it('allows only nonce-tagged scripts on pages and forbids framing', () => {
    const policy = pageContentSecurityPolicy('abc123', false);
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain('unsafe-eval');
  });

  it("adds 'unsafe-eval' only in development, where React needs it for debugging", () => {
    expect(pageContentSecurityPolicy('n', true)).toContain("'nonce-n' 'strict-dynamic' 'unsafe-eval'");
  });
});
