import { Interval } from './interval';
import { splitByLocalDay } from './localDays';

/** The parts of a shift the planning rules need. */
export interface ShiftFacts {
  id: string;
  employeeRef: string | null;
  roleId: string | null;
  interval: Interval;
  breakMinutes: number;
  percent: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function sortedRounded(byDay: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, h]) => [d, round2(h)]));
}

/** BR-04: (duration - break) x percent, never negative. */
export function shiftHours(f: ShiftFacts): number {
  const paidMs = Math.max(0, f.interval.ms - f.breakMinutes * 60_000);
  return round2((paidMs / 3_600_000) * (f.percent / 100));
}

export function allocatedByDay(shifts: ShiftFacts[], zone: string): Record<string, number> {
  const byDay = new Map<string, number>();
  for (const f of shifts) {
    const paidRatio = Math.max(0, f.interval.ms - f.breakMinutes * 60_000) / f.interval.ms;
    for (const [date, piece] of splitByLocalDay(f.interval, zone)) {
      byDay.set(date, (byDay.get(date) ?? 0) + piece.hours * paidRatio * (f.percent / 100));
    }
  }
  return sortedRounded(byDay);
}

export function availableByDay(working: Interval[], unavailable: Interval[], zone: string): Record<string, number> {
  const byDay = new Map<string, number>();
  for (const interval of working) {
    for (const piece of subtract(interval, unavailable)) {
      for (const [date, part] of splitByLocalDay(piece, zone)) byDay.set(date, (byDay.get(date) ?? 0) + part.hours);
    }
  }
  return sortedRounded(byDay);
}

/** @param available null = flexible hours, never over-allocated */
export function overAllocatedDays(allocated: Record<string, number>, available: Record<string, number> | null): string[] {
  if (!available) return [];
  return Object.entries(allocated).filter(([date, hours]) => hours > (available[date] ?? 0) + 0.005).map(([date]) => date);
}

export function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let pieces = [base];
  for (const cut of cuts) {
    pieces = pieces.flatMap((piece) => {
      if (!piece.overlaps(cut)) return [piece];
      const left = cut.start > piece.start ? [new Interval(piece.start, cut.start)] : [];
      const right = cut.end < piece.end ? [new Interval(cut.end, piece.end)] : [];
      return [...left, ...right];
    });
  }
  return pieces;
}
