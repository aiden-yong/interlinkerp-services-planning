import type { Logger } from '../http/kernel';
import type { Clock } from '../support/clock';
import type { Touched } from './deliveryService';

export const MIN_GAP_MS = 30_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * D1: work that runs after API responses (entry.ts calls kick() through Next.js after()).
 * - Badges noted by a request (mark-read) are pushed on the next kick, so the request never waits on the gateway.
 * - The delivery sweep runs at most once per 30 s in this instance, and a run in progress is shared.
 * Never throws.
 */
export class DeliveryTrigger {
  private lastStart = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;
  private pending: Touched = { refs: new Set(), emails: new Set() };

  constructor(
    private readonly delivery: { deliverDue(): Promise<unknown>; pushBadges(touched: Touched): Promise<void> },
    private readonly clock: Clock,
    private readonly log: Logger,
    private readonly minGapMs = MIN_GAP_MS,
  ) {}

  noteBadges(touched: Touched): void {
    for (const ref of touched.refs) this.pending.refs.add(ref);
    for (const email of touched.emails) this.pending.emails.add(email);
  }

  kick(): Promise<void> {
    return Promise.all([this.flushBadges(), this.sweep()]).then(() => undefined);
  }

  private flushBadges(): Promise<void> {
    if (this.pending.refs.size === 0 && this.pending.emails.size === 0) return Promise.resolve();
    const touched = this.pending;
    this.pending = { refs: new Set(), emails: new Set() };
    return this.delivery.pushBadges(touched).catch((error: unknown) => this.log(`[badges] push failed: ${message(error)}`));
  }

  private sweep(): Promise<void> {
    if (this.running) return this.running;
    const now = this.clock.now().getTime();
    if (now - this.lastStart < this.minGapMs) return Promise.resolve();
    this.lastStart = now;
    this.running = this.delivery.deliverDue()
      .then(() => undefined, (error: unknown) => this.log(`[delivery] trigger failed: ${message(error)}`))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
