const toMs = (v: Date | number | string) => (typeof v === 'number' ? v : new Date(v).getTime());

/** A half-open span of time [start, end) in epoch milliseconds. */
export class Interval {
  constructor(readonly start: number, readonly end: number) {
    if (!(end > start)) throw new RangeError('An interval must end after it starts.');
  }

  static of(start: Date | number | string, end: Date | number | string): Interval {
    return new Interval(toMs(start), toMs(end));
  }

  overlaps(other: Interval): boolean {
    return this.start < other.end && other.start < this.end;
  }

  intersect(other: Interval): Interval | null {
    const start = Math.max(this.start, other.start);
    const end = Math.min(this.end, other.end);
    return start < end ? new Interval(start, end) : null;
  }

  get ms(): number {
    return this.end - this.start;
  }

  get hours(): number {
    return this.ms / 3_600_000;
  }
}
