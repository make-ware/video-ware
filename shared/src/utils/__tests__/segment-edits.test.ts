import { describe, expect, it } from 'vitest';
import {
  MIN_SEGMENT_SECONDS,
  clampSegmentsToWindow,
  cutSegments,
  deleteSegment,
  deriveClipTimes,
  normalizeSegments,
  roundToMs,
  slipSegments,
  splitSegments,
  trimSegment,
} from '../segment-edits';
import type { CompositeSegment } from '../composite-utils';

const segs = (...pairs: Array<[number, number]>): CompositeSegment[] =>
  pairs.map(([start, end]) => ({ start, end }));

describe('roundToMs', () => {
  it('rounds to the millisecond grid', () => {
    expect(roundToMs(0.1 + 0.2)).toBe(0.3);
    expect(roundToMs(1.23456)).toBe(1.235);
    expect(roundToMs(0)).toBe(0);
  });
});

describe('normalizeSegments', () => {
  it('sorts segments by start', () => {
    expect(normalizeSegments(segs([5, 6], [1, 2]))).toEqual(
      segs([1, 2], [5, 6])
    );
  });

  it('rounds boundaries to milliseconds', () => {
    expect(normalizeSegments(segs([0.1 + 0.2, 1.0000004]))).toEqual(
      segs([0.3, 1])
    );
  });

  it('merges genuinely overlapping segments', () => {
    expect(normalizeSegments(segs([1, 5], [3, 8]))).toEqual(segs([1, 8]));
  });

  it('merges fully contained segments', () => {
    expect(normalizeSegments(segs([1, 10], [3, 5]))).toEqual(segs([1, 10]));
  });

  it('keeps exactly-touching segments separate (split boundaries survive)', () => {
    expect(normalizeSegments(segs([1, 5], [5, 8]))).toEqual(
      segs([1, 5], [5, 8])
    );
  });

  it('snaps sub-epsilon gaps flush without merging', () => {
    expect(normalizeSegments(segs([1, 5], [5.0005, 8]))).toEqual(
      segs([1, 5], [5, 8])
    );
  });

  it('drops slivers shorter than the minimum', () => {
    expect(
      normalizeSegments(segs([1, 2], [3, 3 + MIN_SEGMENT_SECONDS / 2]))
    ).toEqual(segs([1, 2]));
  });

  it('clamps to [0, mediaDuration] and drops out-of-range segments', () => {
    expect(
      normalizeSegments(segs([-1, 2], [9.5, 12], [20, 25]), {
        mediaDuration: 10,
      })
    ).toEqual(segs([0, 2], [9.5, 10]));
  });

  it('applies no upper clamp when media duration is 0 (image/legacy)', () => {
    expect(normalizeSegments(segs([2, 500]), { mediaDuration: 0 })).toEqual(
      segs([2, 500])
    );
  });

  it('never mutates its input', () => {
    const input = segs([5, 6], [1, 2]);
    const copy = segs([5, 6], [1, 2]);
    normalizeSegments(input);
    expect(input).toEqual(copy);
  });
});

describe('deriveClipTimes', () => {
  it('spans the segments and sums effective duration', () => {
    expect(
      deriveClipTimes(segs([1.8, 6.7], [12.3, 13.5], [14.8, 17.1]))
    ).toEqual({ start: 1.8, end: 17.1, duration: roundToMs(4.9 + 1.2 + 2.3) });
  });

  it('handles a single segment', () => {
    expect(deriveClipTimes(segs([2, 5]))).toEqual({
      start: 2,
      end: 5,
      duration: 3,
    });
  });

  it('throws on an empty list', () => {
    expect(() => deriveClipTimes([])).toThrow(/empty segment list/i);
  });
});

describe('splitSegments', () => {
  it('splits a segment into two touching pieces', () => {
    expect(splitSegments(segs([0, 10]), [4])).toEqual(segs([0, 4], [4, 10]));
  });

  it('preserves effective duration', () => {
    const before = deriveClipTimes(segs([0, 10], [20, 30]));
    const after = deriveClipTimes(splitSegments(segs([0, 10], [20, 30]), [25]));
    expect(after.duration).toBe(before.duration);
  });

  it('applies multiple points across segments', () => {
    expect(splitSegments(segs([0, 10], [20, 30]), [25, 4])).toEqual(
      segs([0, 4], [4, 10], [20, 25], [25, 30])
    );
  });

  it('rejects a point in a gap, listing segment ranges', () => {
    expect(() => splitSegments(segs([0, 10], [20, 30]), [15])).toThrow(
      /not inside any segment.*0–10s, 20–30s/
    );
  });

  it('rejects a point outside all segments', () => {
    expect(() => splitSegments(segs([0, 10]), [50])).toThrow(
      /not inside any segment/
    );
  });

  it('rejects a point on a segment boundary', () => {
    expect(() => splitSegments(segs([0, 10], [10, 20]), [10])).toThrow(
      /not inside any segment/
    );
  });

  it('rejects a sliver-producing point', () => {
    expect(() => splitSegments(segs([0, 10]), [0.05])).toThrow(
      /shorter than 0.1s/
    );
  });

  it('rejects an empty point list', () => {
    expect(() => splitSegments(segs([0, 10]), [])).toThrow(
      /at least one split point/
    );
  });
});

describe('cutSegments', () => {
  it('splits a segment for an interior cut', () => {
    expect(cutSegments(segs([0, 30]), 10, 12)).toEqual(segs([0, 10], [12, 30]));
  });

  it('cuts across a gap and multiple segments', () => {
    expect(cutSegments(segs([0, 10], [20, 30], [40, 50]), 5, 45)).toEqual(
      segs([0, 5], [45, 50])
    );
  });

  it('removes a segment that the range exactly covers', () => {
    expect(cutSegments(segs([0, 10], [20, 30]), 20, 30)).toEqual(segs([0, 10]));
  });

  it('drops a sliver left at a cut edge', () => {
    expect(cutSegments(segs([0, 10]), 0.05, 5)).toEqual(segs([5, 10]));
  });

  it('rejects from >= to', () => {
    expect(() => cutSegments(segs([0, 10]), 5, 5)).toThrow(/invalid cut/i);
    expect(() => cutSegments(segs([0, 10]), 6, 5)).toThrow(/invalid cut/i);
  });

  it('rejects a range that intersects nothing', () => {
    expect(() => cutSegments(segs([0, 10], [20, 30]), 12, 18)).toThrow(
      /nothing to cut/i
    );
  });

  it('rejects removing all content', () => {
    expect(() => cutSegments(segs([0, 10]), 0, 10)).toThrow(
      /remove all remaining content/i
    );
  });

  it('rejects a cut leaving less than the minimum total', () => {
    expect(() => cutSegments(segs([0, 10]), 0.05, 9.98)).toThrow(
      /remove all remaining content/i
    );
  });
});

describe('trimSegment', () => {
  it('tightens a segment edge', () => {
    expect(trimSegment(segs([0, 10], [20, 30]), 0, { end: 8 })).toEqual(
      segs([0, 8], [20, 30])
    );
  });

  it('extends into a gap (restores cut content)', () => {
    expect(trimSegment(segs([0, 10], [20, 30]), 1, { start: 15 })).toEqual(
      segs([0, 10], [15, 30])
    );
  });

  it('snaps flush when extending to the neighbor edge', () => {
    expect(trimSegment(segs([0, 10], [20, 30]), 1, { start: 10.0005 })).toEqual(
      segs([0, 10], [10, 30])
    );
  });

  it('applies start-only and end-only patches', () => {
    expect(trimSegment(segs([5, 10]), 0, { start: 6 })).toEqual(segs([6, 10]));
    expect(trimSegment(segs([5, 10]), 0, { end: 9 })).toEqual(segs([5, 9]));
  });

  it('rejects crossing the previous segment', () => {
    expect(() => trimSegment(segs([0, 10], [20, 30]), 1, { start: 8 })).toThrow(
      /cross the previous segment/i
    );
  });

  it('rejects crossing the next segment', () => {
    expect(() => trimSegment(segs([0, 10], [20, 30]), 0, { end: 22 })).toThrow(
      /cross the next segment/i
    );
  });

  it('rejects exceeding the media duration', () => {
    expect(() =>
      trimSegment(segs([0, 10]), 0, { end: 12 }, { mediaDuration: 10.5 })
    ).toThrow(/exceeds the media duration/i);
  });

  it('allows extending past a zero media duration (image/legacy)', () => {
    expect(
      trimSegment(segs([0, 10]), 0, { end: 500 }, { mediaDuration: 0 })
    ).toEqual(segs([0, 500]));
  });

  it('rejects a negative start', () => {
    expect(() => trimSegment(segs([1, 10]), 0, { start: -1 })).toThrow(
      /cannot be negative/i
    );
  });

  it('rejects shrinking below the minimum length', () => {
    expect(() =>
      trimSegment(segs([0, 10]), 0, { start: 9.95, end: 10 })
    ).toThrow(/shorter than 0.1s/i);
  });

  it('rejects an out-of-range index', () => {
    expect(() => trimSegment(segs([0, 10]), 3, { end: 8 })).toThrow(
      /out of range \(0–0\)/
    );
  });

  it('rejects an empty patch', () => {
    expect(() => trimSegment(segs([0, 10]), 0, {})).toThrow(
      /--start and\/or --end/
    );
  });
});

describe('slipSegments', () => {
  it('slips the whole list by the requested delta', () => {
    expect(slipSegments(segs([2, 5], [8, 10]), 1)).toEqual({
      segments: segs([3, 6], [9, 11]),
      applied: 1,
    });
  });

  it('clamps a leftward slip at 0 and reports the applied delta', () => {
    expect(slipSegments(segs([2, 5]), -3.5)).toEqual({
      segments: segs([0, 3]),
      applied: -2,
    });
  });

  it('clamps a rightward slip at the media end', () => {
    expect(slipSegments(segs([2, 5]), 100, { mediaDuration: 8 })).toEqual({
      segments: segs([5, 8]),
      applied: 3,
    });
  });

  it('slips a single segment clamped against both neighbors', () => {
    expect(
      slipSegments(segs([0, 4], [6, 8], [9, 12]), 5, { index: 1 })
    ).toEqual({ segments: segs([0, 4], [7, 9], [9, 12]), applied: 1 });
    expect(
      slipSegments(segs([0, 4], [6, 8], [9, 12]), -5, { index: 1 })
    ).toEqual({ segments: segs([0, 4], [4, 6], [9, 12]), applied: -2 });
  });

  it('returns applied 0 when fully clamped', () => {
    expect(slipSegments(segs([0, 5]), -2)).toEqual({
      segments: segs([0, 5]),
      applied: 0,
    });
  });

  it('never flips the slip direction while clamping', () => {
    // Segment already touches its left neighbor; a leftward slip cannot move,
    // and must not turn into a rightward one.
    const result = slipSegments(segs([0, 4], [4, 8]), -1, { index: 1 });
    expect(result.applied).toBe(0);
  });

  it('applies no upper clamp when media duration is 0 (image/legacy)', () => {
    expect(slipSegments(segs([2, 5]), 100, { mediaDuration: 0 })).toEqual({
      segments: segs([102, 105]),
      applied: 100,
    });
  });

  it('rejects an out-of-range index', () => {
    expect(() => slipSegments(segs([0, 5]), 1, { index: 2 })).toThrow(
      /out of range/
    );
  });
});

describe('deleteSegment', () => {
  it('removes the segment at the given index', () => {
    expect(deleteSegment(segs([0, 10], [20, 30], [40, 50]), 1)).toEqual(
      segs([0, 10], [40, 50])
    );
  });

  it('removes the first and last segments', () => {
    expect(deleteSegment(segs([0, 10], [20, 30]), 0)).toEqual(segs([20, 30]));
    expect(deleteSegment(segs([0, 10], [20, 30]), 1)).toEqual(segs([0, 10]));
  });

  it('addresses the sorted, normalized list', () => {
    // index 0 is the earliest segment regardless of input order
    expect(deleteSegment(segs([20, 30], [0, 10]), 0)).toEqual(segs([20, 30]));
  });

  it('removes a segment flush against its neighbor without merging it', () => {
    expect(deleteSegment(segs([0, 10], [10, 20], [20, 30]), 1)).toEqual(
      segs([0, 10], [20, 30])
    );
  });

  it('rejects deleting the only remaining segment', () => {
    expect(() => deleteSegment(segs([0, 10]), 0)).toThrow(
      /only remaining segment/i
    );
  });

  it('rejects an out-of-range index', () => {
    expect(() => deleteSegment(segs([0, 10], [20, 30]), 2)).toThrow(
      /out of range \(0–1\)/
    );
    expect(() => deleteSegment(segs([0, 10], [20, 30]), -1)).toThrow(
      /out of range/
    );
  });

  it('never mutates its input', () => {
    const input = segs([0, 10], [20, 30]);
    const copy = segs([0, 10], [20, 30]);
    deleteSegment(input, 0);
    expect(input).toEqual(copy);
  });
});

describe('clampSegmentsToWindow', () => {
  it('trims segments to the window', () => {
    expect(clampSegmentsToWindow(segs([0, 10], [20, 30]), 5, 25)).toEqual(
      segs([5, 10], [20, 25])
    );
  });

  it('returns empty when the window misses all segments', () => {
    expect(clampSegmentsToWindow(segs([0, 10]), 50, 60)).toEqual([]);
  });

  it('returns empty when the window sits inside a gap', () => {
    expect(clampSegmentsToWindow(segs([0, 10], [20, 30]), 12, 18)).toEqual([]);
  });

  it('rejects an inverted window', () => {
    expect(() => clampSegmentsToWindow(segs([0, 10]), 8, 3)).toThrow(
      /invalid time range/i
    );
  });
});
