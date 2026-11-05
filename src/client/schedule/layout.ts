export interface Geometry { left: number; width: number; clippedStart: boolean; clippedEnd: boolean }

/** Position as percentages of the period, or null when outside it. */
export function geometry(startIso: string, endIso: string, fromIso: string, toIso: string): Geometry | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (end <= from || start >= to) return null;
  const s = Math.max(start, from);
  const e = Math.min(end, to);
  return { left: ((s - from) / (to - from)) * 100, width: ((e - s) / (to - from)) * 100, clippedStart: start < from, clippedEnd: end > to };
}

/** Joins spans separated by a short gap: at week scale a lunch break is only a few pixels wide, and reads as noise. */
export function mergeShortGaps<T extends { start_at: string; end_at: string }>(spans: T[], gapMs: number): T[] {
  const merged: T[] = [];
  for (const span of [...spans].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))) {
    const last = merged.at(-1);
    if (last && Date.parse(span.start_at) - Date.parse(last.end_at) <= gapMs) merged[merged.length - 1] = { ...last, end_at: span.end_at };
    else merged.push(span);
  }
  return merged;
}

/** Greedy lanes so overlapping shifts in one row stay visible. */
export function assignLanes<T extends { id: string; start_at: string; end_at: string }>(items: T[]): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || Date.parse(a.end_at) - Date.parse(b.end_at));
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= Date.parse(item.start_at));
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = Date.parse(item.end_at);
    lanes.set(item.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}
