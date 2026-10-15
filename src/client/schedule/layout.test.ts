import { describe, expect, it } from 'vitest';
import { assignLanes, geometry } from './layout';

const FROM = '2026-10-12T00:00:00Z';
const TO = '2026-10-19T00:00:00Z';

describe('layout', () => {
  it('places a bar by time', () => {
    const g = geometry('2026-10-13T00:00:00Z', '2026-10-13T12:00:00Z', FROM, TO)!;
    expect(g.left).toBeCloseTo(100 / 7);
    expect(g.width).toBeCloseTo(100 / 14);
  });

  it('draws an overnight shift as one bar (FR-SHF-04) and clips at the edges', () => {
    expect(geometry('2026-10-13T22:00:00Z', '2026-10-14T06:00:00Z', FROM, TO)!.width).toBeCloseTo((8 / 168) * 100);
    expect(geometry('2026-10-11T20:00:00Z', '2026-10-12T04:00:00Z', FROM, TO)).toMatchObject({ left: 0, clippedStart: true });
    expect(geometry('2026-10-20T00:00:00Z', '2026-10-20T04:00:00Z', FROM, TO)).toBeNull();
  });

  it('stacks overlapping shifts into lanes', () => {
    const { lanes, count } = assignLanes([
      { id: 'a', start_at: '2026-10-13T01:00:00Z', end_at: '2026-10-13T05:00:00Z' },
      { id: 'b', start_at: '2026-10-13T03:00:00Z', end_at: '2026-10-13T07:00:00Z' },
      { id: 'c', start_at: '2026-10-13T05:00:00Z', end_at: '2026-10-13T08:00:00Z' },
    ]);
    expect([lanes.get('a'), lanes.get('b'), lanes.get('c'), count]).toEqual([0, 1, 0, 2]);
  });
});
