import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../feedback';
import type { Me } from '../types';
import { SchedulePage } from './SchedulePage';
import { payload } from './testData';

const me = (timezone: string): Me => ({
  name: 'Manager', email: 'm@example.test', gateway_role: 'admin', employee_ref: null, roster_status: 'not_found',
  is_manager: true, timezone, organisation_timezone: 'Asia/Kuala_Lumpur',
});

/** Renders the page and returns the first schedule request it makes. */
async function firstRequest(viewer: Me): Promise<URL> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<FeedbackProvider><SchedulePage me={viewer} /></FeedbackProvider>);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return new URL((fetchMock.mock.calls[0] as unknown as [string])[0], 'http://planning.test');
}

describe('SchedulePage time zone (BR-10)', () => {
  beforeEach(() => {
    // Sunday 16:00 in New York, already Monday 04:00 in Kuala Lumpur.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T20:00:00Z'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks for the schedule in the viewer's own time zone", async () => {
    const url = await firstRequest(me('America/New_York'));
    expect(url.pathname).toBe('/api/schedule');
    expect(url.searchParams.get('timezone')).toBe('America/New_York');
  });

  it("starts on the week that contains today where the viewer is, not where the organisation is", async () => {
    expect((await firstRequest(me('America/New_York'))).searchParams.get('from')).toBe('2026-10-12');
    cleanup();
    expect((await firstRequest(me('Asia/Kuala_Lumpur'))).searchParams.get('from')).toBe('2026-10-19');
  });
});
