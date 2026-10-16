import { describe, expect, it } from 'vitest';
import { FixedClock } from '../test/fakes';
import { DeliveryTrigger } from './trigger';

function setup(result: () => Promise<unknown> = async () => ({}), push: (refs: string[]) => Promise<void> = async () => {}) {
  const clock = FixedClock.at('2026-10-13T02:00:00Z');
  const logs: string[] = [];
  const pushed: string[][] = [];
  let runs = 0;
  const trigger = new DeliveryTrigger({
    deliverDue: () => { runs++; return result(); },
    pushBadges: async (t) => { pushed.push([...t.refs, ...t.emails]); await push([...t.refs]); },
  }, clock, (l) => logs.push(l));
  return { trigger, clock, logs, pushed, runs: () => runs };
}

describe('DeliveryTrigger', () => {
  it('runs at most once per 30 seconds in one instance', async () => {
    const s = setup();
    await s.trigger.kick();
    await s.trigger.kick();
    expect(s.runs()).toBe(1);
    s.clock.advance(30);
    await s.trigger.kick();
    expect(s.runs()).toBe(2);
  });

  it('shares a run that is still going', async () => {
    let finish!: () => void;
    const s = setup(() => new Promise<void>((resolve) => { finish = resolve; }));
    const a = s.trigger.kick();
    s.clock.advance(60);
    const b = s.trigger.kick();
    finish();
    await Promise.all([a, b]);
    expect(s.runs()).toBe(1);
  });

  it('logs a failed sweep instead of throwing (Review Focus 3)', async () => {
    const s = setup(async () => { throw new Error('db down'); });
    await expect(s.trigger.kick()).resolves.toBeUndefined();
    expect(s.logs.join()).toContain('db down');
  });

  it('pushes noted badges on the next kick, even inside the 30-second gap, and only once', async () => {
    const s = setup();
    await s.trigger.kick();
    s.trigger.noteBadges({ refs: new Set(['E1']), emails: new Set(['ana@example.com']) });
    await s.trigger.kick();
    await s.trigger.kick();
    expect(s.runs()).toBe(1);
    expect(s.pushed).toEqual([['E1', 'ana@example.com']]);
  });

  it('notes badges again when pushing them failed, so the next kick retries', async () => {
    let fail = true;
    const s = setup(undefined, async () => { if (fail) throw new Error('gateway down'); });
    s.trigger.noteBadges({ refs: new Set(['E1']), emails: new Set() });
    await s.trigger.kick();
    expect(s.logs.join()).toContain('gateway down');
    fail = false;
    await s.trigger.kick();
    expect(s.pushed).toEqual([['E1'], ['E1']]);
    await s.trigger.kick();
    expect(s.pushed).toHaveLength(2);
  });
});
