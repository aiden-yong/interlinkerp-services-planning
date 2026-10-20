import { NextResponse, type NextRequest } from 'next/server';
import { REQUIRED_ENV } from '@/server/app';
import { requireAll } from '@/server/config/env';
import { getApp } from '@/server/entry';
import { correlationIdFor } from '@/server/http/kernel';
import { envelope } from '@/server/http/responses';
import { redactAddresses } from '@/server/support/scrub';
import { isApiPath, isPagePath } from '@/server/web/pageGate';
import { API_SECURITY_HEADERS, pageContentSecurityPolicy } from '@/server/web/securityHeaders';

const NO_STORE: Record<string, string> = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache', Expires: '0' };

/** Next.js 16 proxy (formerly middleware). Runs on Node.js before every request. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  if (isApiPath(path)) return NextResponse.next();

  if (!isPagePath(path)) {
    // Contract SS-5: an unrouted path gets the JSON envelope, never an HTML page.
    const cid = correlationIdFor(request);
    return NextResponse.json(envelope('RESOURCE_NOT_FOUND', `No route for ${path}.`, cid, null), { status: 404, headers: { 'X-Correlation-ID': cid, 'Content-Security-Policy': API_SECURITY_HEADERS[0].value } });
  }

  try {
    requireAll(REQUIRED_ENV);
  } catch (error) {
    console.error(`[planning-web] ${(error as Error).message}`);
    return new NextResponse('<!doctype html><p>Planning is misconfigured. See the server log.</p>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
  }

  let result;
  try {
    result = await getApp().pageGate().handle(request);
  } catch (error) {
    // Backlog item 12: a failure here must still be no-store, and its log line must not carry email addresses (DR-02).
    console.error(`[planning-web] ${correlationIdFor(request)} ${redactAddresses(error instanceof Error ? `${error.name}: ${error.message}` : String(error))}`);
    return new NextResponse('<!doctype html><p>Planning could not check your sign-in. Try again in a moment.</p>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
  }
  // Next.js tags its own scripts with the nonce it finds in the request's CSP header (backlog item 4).
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = pageContentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const forwarded = new Headers(request.headers);
  forwarded.set('x-nonce', nonce);
  forwarded.set('Content-Security-Policy', policy);
  const response = result.kind === 'redirect'
    ? NextResponse.redirect(result.location, 302)
    : result.kind === 'error'
      ? new NextResponse(result.html, { status: result.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      : NextResponse.next({ request: { headers: forwarded } });
  response.headers.set('Content-Security-Policy', policy);
  for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
  for (const cookie of result.cookies) response.headers.append('Set-Cookie', cookie);
  return response;
}

// Backlog item 20: static files (anything later put in public/) skip the proxy, so they are served instead of getting
// the JSON 404. Next.js needs this to be a literal; proxy.test.ts checks what it matches.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\.ico|.*\.(?:png|jpe?g|gif|svg|ico|webp|avif|txt|xml|css|js|map|woff2?|ttf|otf|webmanifest)$).*)'],
};
