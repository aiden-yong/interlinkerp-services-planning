import { describe, expect, it } from 'vitest';
import { isApiPath } from '@/server/web/pageGate';
import { config } from './proxy';

describe('proxy matcher (backlog item 20)', () => {
  const runs = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it('runs for pages, the API and unknown paths', () => {
    for (const path of ['/', '/schedule', '/settings/roles', '/api/schedule', '/health', '/openapi.json', '/nope', '/api/v1.2/x']) expect(runs(path), path).toBe(true);
  });

  it('skips Next.js assets and static files', () => {
    for (const path of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/robots.txt', '/icons/bell.svg', '/fonts/inter.woff2', '/site.webmanifest']) expect(runs(path), path).toBe(false);
  });

  it('lets the public calendar feed through to its route handler instead of the page gate', () => {
    expect(runs('/feeds/calendar/x.ics')).toBe(true);
    expect(isApiPath('/feeds/calendar/x.ics')).toBe(true);
  });
});
