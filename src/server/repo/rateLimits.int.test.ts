import { describe, expect, it } from 'vitest';
import { ORG, useTestDatabase } from '../test/db';
import { FixedClock } from '../test/fakes';
import { JobRuns } from './jobRuns';
import { RateLimiter } from './rateLimits';

const database = useTestDatabase();

describe('RateLimiter (backlog item 10)', () => {
  it('allows a burst, then refuses with the seconds to wait, then refills', async () => {
    const clock = FixedClock.at('2026-10-20T00:00:00Z');
    const limiter = new RateLimiter(database.db, ORG, clock, { capacity: 3, perSecond: 0.5 });
    expect(await limiter.take('person:ana')).toBeNull();
    expect(await limiter.take('person:ana')).toBeNull();
    expect(await limiter.take('person:ana')).toBeNull();
    expect(await limiter.take('person:ana')).toBe(2); // one token takes 2 s at 0.5 per second
    expect(await limiter.take('person:bo')).toBeNull(); // buckets are per caller
    clock.advance(2);
    expect(await limiter.take('person:ana')).toBeNull();
    expect(await limiter.take('person:ana')).toBe(2);
  });

  it('never refills past the burst size, and keeps organisations apart', async () => {
    const clock = FixedClock.at('2026-10-20T00:00:00Z');
    const limiter = new RateLimiter(database.db, ORG, clock, { capacity: 2, perSecond: 1 });
    await limiter.take('person:ana');
    clock.advance(3600);
    expect(await limiter.take('person:ana')).toBeNull();
    expect(await limiter.take('person:ana')).toBeNull();
    expect(await limiter.take('person:ana')).toBe(1);
    expect(await new RateLimiter(database.db, 'other-org', clock, { capacity: 2, perSecond: 1 }).take('person:ana')).toBeNull();
  });

  it('prunes buckets untouched for a day', async () => {
    const clock = FixedClock.at('2026-10-20T00:00:00Z');
    const limiter = new RateLimiter(database.db, ORG, clock);
    await limiter.take('person:ana');
    clock.advance(86_400);
    await limiter.take('person:bo');
    expect(await limiter.prune(new Date(clock.now().getTime() - 3600_000))).toBe(1);
  });
});

describe('JobRuns (backlog item 30)', () => {
  it('lets one caller start a job per gap, across instances', async () => {
    const a = new JobRuns(database.db, ORG);
    const b = new JobRuns(database.db, ORG);
    const at = new Date('2026-10-20T00:00:00Z');
    expect(await a.claim('delivery', at, 30_000)).toBe(true);
    expect(await b.claim('delivery', new Date(at.getTime() + 10_000), 30_000)).toBe(false);
    expect(await b.claim('delivery', new Date(at.getTime() + 30_000), 30_000)).toBe(true);
    expect(await a.claim('other-job', at, 30_000)).toBe(true);
  });
});
