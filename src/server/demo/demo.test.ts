import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, assertConfigured, REQUIRED_ENV } from '../app';
import { SessionCodec } from '../auth/session';
import { LogMailer } from '../notifications/mailer';
import { noBadges } from '../notifications/badges';
import { systemClock } from '../support/clock';
import { demoConfigurationError, demoCredit, demoEnabled, demoSession, isDemoDatabase } from './demo';
import { DemoGate } from './demoGate';
import { DemoAccessGuard } from './demoGuard';
import { demoLandingPage } from './landing';
import { buildSampleData, FIRST_WEEK, LAST_WEEK } from './sampleData';

const SAFE = 'postgres://u:p@localhost:5432/planning_demo?sslmode=require';
const SECRET = 's'.repeat(32);
const sessions = () => new SessionCodec(SECRET, systemClock);
const cookieOf = (setCookie: string) => setCookie.split(';')[0]!;

afterEach(() => vi.unstubAllEnvs());

describe('demo mode switch', () => {
  it('is off unless asked for', () => {
    vi.stubEnv('DEMO_MODE', '');
    vi.stubEnv('DATABASE_URL', SAFE);
    expect(demoEnabled()).toBe(false);
    expect(demoConfigurationError()).toBeNull();
    vi.stubEnv('DEMO_MODE', 'false');
    expect(demoEnabled()).toBe(false);
  });

  it('is on only with a database named demo', () => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('DATABASE_URL', SAFE);
    expect(demoEnabled()).toBe(true);
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/planning');
    expect(demoEnabled()).toBe(false);
    expect(demoConfigurationError()).toContain('DATABASE_URL');
  });

  it('reads only the database name, not the host, user or query', () => {
    expect(isDemoDatabase('postgres://demo:demo@demo.example/planning?x=demo')).toBe(false);
    expect(isDemoDatabase('postgres://u@h/Planning_DEMO')).toBe(true);
    expect(isDemoDatabase('not a url')).toBe(false);
    expect(isDemoDatabase(undefined)).toBe(false);
  });

  it('refuses to serve at all when DEMO_MODE meets a real database, rather than falling back to the gateway', () => {
    for (const key of REQUIRED_ENV) vi.stubEnv(key, 'x');
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/planning');
    expect(() => assertConfigured()).toThrow(/contains "demo"/);
  });

  it('does not need a gateway address', () => {
    for (const key of REQUIRED_ENV) vi.stubEnv(key, 'x');
    vi.stubEnv('GATEWAY_URL', '');
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('DATABASE_URL', SAFE);
    expect(() => assertConfigured()).not.toThrow();
    vi.stubEnv('DEMO_MODE', '');
    expect(() => assertConfigured()).toThrow(/GATEWAY_URL/);
  });
});

describe('nothing leaves a demo', () => {
  it('logs mail, drops badges and has no API client, whatever the settings say', () => {
    vi.stubEnv('SMTP_URL', 'smtps://u:p@smtp.example:465');
    vi.stubEnv('MAIL_FROM', 'a@b.example');
    vi.stubEnv('GATEWAY_BADGES', 'on');
    vi.stubEnv('INTERLINK_CLIENT_ID', 'id');
    vi.stubEnv('INTERLINK_CLIENT_SECRET', 'secret');
    vi.stubEnv('GATEWAY_URL', 'https://gateway.test');
    const app = new App({ demo: true });
    expect(app.mailer()).toBeInstanceOf(LogMailer);
    expect(app.badges()).toBe(noBadges);
    expect(app.credentials()).toBeNull();
    expect(app.devIdentity()).toBeNull();
  });
});

describe('credit line', () => {
  it('shows a name, and links it only to https', () => {
    vi.stubEnv('DEMO_CREDIT_NAME', '');
    expect(demoCredit()).toBeNull();
    vi.stubEnv('DEMO_CREDIT_NAME', 'A Builder');
    vi.stubEnv('DEMO_CREDIT_URL', 'https://example.com');
    expect(demoCredit()).toEqual({ name: 'A Builder', url: 'https://example.com' });
    vi.stubEnv('DEMO_CREDIT_URL', 'javascript:alert(1)');
    expect(demoCredit()).toEqual({ name: 'A Builder', url: null });
  });

  it('is escaped on the landing page', () => {
    const html = demoLandingPage({ publicUrl: 'https://demo.test', error: '<b>x</b>', credit: { name: '<script>', url: null } });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('DemoGate', () => {
  const setup = () => {
    const data = { ensureReady: vi.fn(async () => {}), reset: vi.fn(async () => {}) };
    const log = vi.fn();
    return { data, log, gate: new DemoGate(sessions(), data, 'https://demo.test', log) };
  };
  const signedIn = () => cookieOf(sessions().issue(demoSession(), true));
  const post = (action: string, cookie?: string, path = '/schedule') => new Request(`https://demo.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams({ demo_action: action }),
  });

  it('shows the landing page to a new visitor and never redirects to a gateway', async () => {
    const result = await setup().gate.handle(new Request('https://demo.test/schedule'));
    expect(result.kind).toBe('page');
    if (result.kind === 'page') {
      expect(result.status).toBe(200);
      expect(result.html).toContain('Explore the demo');
      expect(result.html).toContain('https://demo.test/og-image.png');
    }
  });

  it('signs in, loads the sample data and returns to the page', async () => {
    const { gate, data } = setup();
    const result = await gate.handle(post('sign_in'));
    expect(data.ensureReady).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ kind: 'see-other', path: '/schedule' });
    expect(sessions().decode(decodeURIComponent(cookieOf(result.cookies[0]!).split('=')[1]!))?.sid).toBe('demo-session');
  });

  it('stays on the landing page with a message when the database is unreachable', async () => {
    const { gate, data, log } = setup();
    data.ensureReady.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const result = await gate.handle(post('sign_in'));
    expect(result).toMatchObject({ kind: 'page', status: 503, cookies: [] });
    expect(result.kind === 'page' && result.html).toContain('could not be reached');
    expect(log).toHaveBeenCalledOnce();
  });

  it('lets a signed-in visitor through with a fresh cookie', async () => {
    const result = await setup().gate.handle(new Request('https://demo.test/my', { headers: { cookie: signedIn() } }));
    expect(result.kind).toBe('pass');
    expect(result.cookies).toHaveLength(1);
  });

  it('ignores a session that is not the demo one', async () => {
    const real = cookieOf(sessions().issue({ ...demoSession(), sid: 'real-gateway-sid' }, true));
    expect((await setup().gate.handle(new Request('https://demo.test/my', { headers: { cookie: real } }))).kind).toBe('page');
  });

  it('resets only for a signed-in visitor', async () => {
    const { gate, data } = setup();
    await gate.handle(post('reset'));
    expect(data.reset).not.toHaveBeenCalled();
    await gate.handle(post('reset', signedIn()));
    expect(data.reset).toHaveBeenCalledOnce();
  });

  it('offers the employee view on the landing page and signs in as that person, starting from home', async () => {
    const { gate } = setup();
    const landing = await gate.handle(new Request('https://demo.test/'));
    expect(landing.kind === 'page' && landing.html).toContain('name="demo_view" value="employee"');
    const form = new URLSearchParams({ demo_action: 'sign_in', demo_view: 'employee' });
    const result = await gate.handle(new Request('https://demo.test/schedule', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }));
    expect(result).toMatchObject({ kind: 'see-other', path: '/' });
    const session = sessions().decode(decodeURIComponent(cookieOf(result.cookies[0]!).split('=')[1]!));
    expect(session).toMatchObject({ gatewayRole: 'user', employeeRef: 'SVC-002' });
  });

  it('switches view only for a signed-in visitor, and keeps the view on later pages', async () => {
    const { gate } = setup();
    const switchTo = (view: string, cookie?: string) => new Request('https://demo.test/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams({ demo_action: 'view_as', demo_view: view }),
    });
    expect((await gate.handle(switchTo('employee'))).cookies).toEqual([]);
    const switched = await gate.handle(switchTo('employee', signedIn()));
    expect(switched).toMatchObject({ kind: 'see-other', path: '/' });
    const next = await gate.handle(new Request('https://demo.test/my', { headers: { cookie: cookieOf(switched.cookies[0]!) } }));
    expect(sessions().decode(decodeURIComponent(cookieOf(next.cookies[0]!).split('=')[1]!))?.employeeRef).toBe('SVC-002');
    const back = await gate.handle(switchTo('manager', cookieOf(switched.cookies[0]!)));
    expect(sessions().decode(decodeURIComponent(cookieOf(back.cookies[0]!).split('=')[1]!))?.gatewayRole).toBe('admin');
  });

  it('signs out by clearing the cookie', async () => {
    const result = await setup().gate.handle(post('sign_out', signedIn()));
    expect(result.cookies[0]).toContain('Max-Age=0');
    expect(result).toMatchObject({ kind: 'see-other', path: '/' });
  });
});

describe('DemoAccessGuard', () => {
  const guard = new DemoAccessGuard(sessions(), true);
  const route = { access: 'manager' } as never;

  it('makes a demo visitor a manager who is also on the roster', async () => {
    const cookie = cookieOf(sessions().issue(demoSession(), true));
    const { principal } = await guard.check(route, new Request('https://demo.test/api/schedule', { headers: { cookie } }));
    expect(principal).toMatchObject({ kind: 'person', isManager: true, employeeRef: 'SVC-001' });
  });

  it('makes the employee view a real employee: no manager routes, even with a crafted role elsewhere in the session', async () => {
    const cookie = cookieOf(sessions().issue(demoSession('employee'), true));
    const request = () => new Request('https://demo.test/api/schedule', { headers: { cookie } });
    await expect(guard.check(route, request())).rejects.toMatchObject({ status: 403 });
    const { principal } = await guard.check({ access: 'person' } as never, request());
    expect(principal).toMatchObject({ isManager: false, employeeRef: 'SVC-002', name: 'Nadia Rahman' });
  });

  it('refuses bearer tokens, which there is no gateway to verify, and sessions from anywhere else', async () => {
    await expect(guard.check(route, new Request('https://demo.test/api/schedule', { headers: { authorization: 'Bearer abc' } }))).rejects.toMatchObject({ status: 401 });
    const other = cookieOf(sessions().issue({ ...demoSession(), sid: 'other' }, true));
    await expect(guard.check(route, new Request('https://demo.test/api/schedule', { headers: { cookie: other } }))).rejects.toMatchObject({ status: 401 });
  });
});

describe('sample data', () => {
  const now = new Date('2026-11-04T04:00:00Z');
  const zone = 'Asia/Kuala_Lumpur';
  const data = buildSampleData(now, zone);

  it('has shifts around today, including something to do this week', () => {
    const weekEnd = new Date('2026-11-08T16:00:00Z');
    const open = data.shifts.filter((s) => s.employeeRef === null && s.start > now && s.start < weekEnd);
    expect(open.some((s) => s.published)).toBe(true);
    expect(open.some((s) => !s.published)).toBe(true);
    expect(data.shifts.some((s) => s.switchRequested && s.start > now && s.start < weekEnd)).toBe(true);
    expect(LAST_WEEK).toBeGreaterThan(2); // still weeks ahead when MAX_SAMPLE_AGE_DAYS later it gets replaced
    expect(FIRST_WEEK).toBeLessThan(0);
  });

  it('keeps every shift with a known role, a valid span, and a person who exists', () => {
    const refs = new Set(data.people.map((p) => p.ref));
    for (const s of data.shifts) {
      expect(s.end.getTime()).toBeGreaterThan(s.start.getTime());
      expect(data.roleIds[s.role]).toBeTruthy();
      if (s.employeeRef) expect(refs.has(s.employeeRef)).toBe(true);
    }
  });

  it('uses only addresses on a reserved domain, so nothing could ever reach a real person', () => {
    for (const p of data.people) expect(p.email.endsWith('.example')).toBe(true);
  });

  it('gives both people a visitor can be an inbox', () => {
    for (const ref of ['SVC-001', 'SVC-002']) expect(data.notices.filter((n) => n.recipientRef === ref && !n.read).length).toBeGreaterThan(0);
  });

  it('numbers a repeating series without gaps', () => {
    const steps = data.shifts.filter((s) => s.recurrenceIndex !== undefined).map((s) => s.recurrenceIndex);
    expect(steps).toEqual(Array.from({ length: data.recurrence.count }, (_, i) => i));
  });
});
