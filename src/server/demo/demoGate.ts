import { readCookies, SESSION_COOKIE, type SessionCodec } from '../auth/session';
import type { Logger } from '../http/kernel';
import { redactAddresses } from '../support/scrub';
import type { Gate, GateResult } from '../web/pageGate';
import { safeReturnPath } from '../web/pageGate';
import { demoCredit, demoSession, isDemoSession } from './demo';
import { demoLandingPage } from './landing';

export interface DemoData {
  ensureReady(): Promise<void>;
  reset(): Promise<void>;
}

/**
 * The sign-in gate in demo mode (demo.ts), used in place of PageGate: the landing page, a redirect after a form post, or
 * the app. The gateway is never contacted. The forms post back to the page they're on; the session cookie is
 * SameSite=Lax, so another site can't submit sign-out or reset on a signed-in visitor's behalf.
 */
export class DemoGate implements Gate {
  constructor(
    private readonly sessions: SessionCodec,
    private readonly data: DemoData,
    private readonly publicUrl: string,
    private readonly log: Logger,
  ) {}

  private get secure(): boolean {
    return this.publicUrl.startsWith('https://');
  }

  private landing(error: string | null, status: number): GateResult {
    return { kind: 'page', status, html: demoLandingPage({ publicUrl: this.publicUrl, error, credit: demoCredit() }), cookies: [] };
  }

  async handle(request: Request): Promise<GateResult> {
    const signedIn = isDemoSession(this.sessions.decode(readCookies(request)[SESSION_COOKIE]));
    if (request.method === 'POST') return this.act(request, signedIn);
    if (!signedIn) return this.landing(null, 200);
    return { kind: 'pass', cookies: [this.sessions.issue(demoSession(), this.secure)] };
  }

  private async act(request: Request, signedIn: boolean): Promise<GateResult> {
    const cookies: string[] = [];
    const action = await request.formData().then((form) => form.get('demo_action'), () => null);
    if (action === 'sign_in') {
      try {
        // A fresh demo database gets its sample data on the first visit, and old sample data is replaced.
        await this.data.ensureReady();
      } catch (error) {
        this.log(`[planning-web] demo database setup failed: ${redactAddresses((error as Error).message)}`);
        return this.landing('The demo database could not be reached right now. Please try again in a minute.', 503);
      }
      cookies.push(this.sessions.issue(demoSession(), this.secure));
    } else if (action === 'sign_out') {
      cookies.push(this.sessions.clear(this.secure));
    } else if (action === 'reset' && signedIn) {
      try {
        await this.data.reset();
      } catch (error) {
        this.log(`[planning-web] demo data reset failed: ${redactAddresses((error as Error).message)}`);
      }
    }
    // Post/redirect/get, back to the page the form was on.
    return { kind: 'see-other', path: safeReturnPath(new URL(request.url).pathname), cookies };
  }
}
