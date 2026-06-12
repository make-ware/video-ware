import { describe, it, expect } from 'vitest';
import type { TimelineClip } from '@project/shared';
import {
  findNonOverlappingTimelineStart,
  computeClipPlacement,
  planOverwriteAtTime,
} from '../clip-placement';

function makeClip(
  overrides: Partial<TimelineClip> & { id: string }
): TimelineClip {
  return {
    collectionId: 'timelineclips',
    collectionName: 'TimelineClips',
    created: '',
    updated: '',
    TimelineRef: 'tl-1',
    MediaRef: 'media-1',
    order: 0,
    start: 0,
    end: 1,
    duration: 1,
    ...overrides,
  } as TimelineClip;
}

describe('findNonOverlappingTimelineStart', () => {
  it('returns desired time on empty track', () => {
    expect(findNonOverlappingTimelineStart([], 5, 2)).toBe(5);
  });

  it('returns desired time when no overlap with single clip', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
    ];
    // Place after existing clip at t=5, no overlap
    expect(findNonOverlappingTimelineStart(clips, 5, 2)).toBe(5);
  });

  it('shifts to after clip end when overlapping', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 2, start: 0, end: 5, duration: 5 }),
    ];
    // Desired t=3 overlaps with [2,7], should shift to 7
    expect(findNonOverlappingTimelineStart(clips, 3, 2)).toBe(7);
  });

  it('finds first available position after multiple overlapping clips', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 5, duration: 5 }),
      makeClip({ id: 'c2', timelineStart: 5, start: 0, end: 5, duration: 5 }),
    ];
    // Desired t=0 overlaps [0,5] -> shift to 5 -> overlaps [5,10] -> shift to 10
    expect(findNonOverlappingTimelineStart(clips, 0, 3)).toBe(10);
  });

  it('fits a clip in a gap between two existing clips', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 8, start: 0, end: 2, duration: 2 }),
    ];
    // Gap from 3 to 8 (5 seconds). Desired t=3 with duration 2 fits.
    expect(findNonOverlappingTimelineStart(clips, 3, 2)).toBe(3);
  });

  it('excludeClipId skips the excluded clip in collision checks', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 5, duration: 5 }),
      makeClip({ id: 'c2', timelineStart: 5, start: 0, end: 3, duration: 3 }),
    ];
    // Without exclude, t=0 overlaps c1 [0,5] -> shift to 5 -> overlaps c2 [5,8] -> shift to 8
    expect(findNonOverlappingTimelineStart(clips, 0, 2)).toBe(8);
    // With exclude c1, only c2 [5,8] matters, t=0 doesn't overlap -> returns 0
    expect(findNonOverlappingTimelineStart(clips, 0, 2, 'c1')).toBe(0);
  });

  it('clamps negative desired time to 0', () => {
    expect(findNonOverlappingTimelineStart([], -5, 2)).toBe(0);
  });

  it('handles clips at time 0', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 2, duration: 2 }),
    ];
    // Desired t=0 overlaps [0,2], should shift to 2
    expect(findNonOverlappingTimelineStart(clips, 0, 1)).toBe(2);
  });

  it('handles zero-duration clips (no collision)', () => {
    // Zero-duration clips are filtered out (range.end > range.start check)
    const clips = [
      makeClip({ id: 'c1', timelineStart: 5, start: 0, end: 0, duration: 0 }),
    ];
    expect(findNonOverlappingTimelineStart(clips, 5, 2)).toBe(5);
  });

  it('handles very large time values', () => {
    const clips = [
      makeClip({
        id: 'c1',
        timelineStart: 1_000_000,
        start: 0,
        end: 100,
        duration: 100,
      }),
    ];
    expect(findNonOverlappingTimelineStart(clips, 1_000_050, 10)).toBe(
      1_000_100
    );
  });
});

describe('computeClipPlacement', () => {
  it('appends at end of track when no selected clip', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 5, duration: 5 }),
    ];
    // End of track is 5, so new clip starts at 5
    expect(computeClipPlacement(clips, null, 2)).toBe(5);
  });

  it('places after selected clip (at end of track)', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 5, duration: 5 }),
      makeClip({ id: 'c2', timelineStart: 5, start: 0, end: 3, duration: 3 }),
    ];
    // Selected c1 ends at 5, but end of track is 8 (max of all ranges)
    // desiredTime = max(5, 8) = 8
    expect(computeClipPlacement(clips, 'c1', 2)).toBe(8);
  });

  it('starts at 0 on empty track', () => {
    expect(computeClipPlacement([], null, 2)).toBe(0);
  });
});

describe('planOverwriteAtTime', () => {
  it('returns an empty plan when nothing overlaps', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
    ];
    expect(planOverwriteAtTime(clips, 5, 2)).toEqual({
      trims: [],
      removals: [],
    });
    expect(planOverwriteAtTime([], 0, 2)).toEqual({ trims: [], removals: [] });
  });

  it('trims the out-point of a clip overlapped at its tail', () => {
    // Clip occupies [4,14] on the timeline (source [0,10]); insert at 10
    const clips = [
      makeClip({ id: 'c1', timelineStart: 4, start: 0, end: 10, duration: 10 }),
    ];
    expect(planOverwriteAtTime(clips, 10, 5)).toEqual({
      trims: [{ clipId: 'c1', start: 0, end: 6, timelineStart: 4 }],
      removals: [],
    });
  });

  it('trims the in-point and shifts a clip overlapped at its head', () => {
    // Clip occupies [4,14] on the timeline (source [10,20]); insert [2,8]
    const clips = [
      makeClip({
        id: 'c1',
        timelineStart: 4,
        start: 10,
        end: 20,
        duration: 10,
      }),
    ];
    expect(planOverwriteAtTime(clips, 2, 6)).toEqual({
      trims: [{ clipId: 'c1', start: 14, end: 20, timelineStart: 8 }],
      removals: [],
    });
  });

  it('removes clips fully covered by the insert range', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 2, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 6, start: 0, end: 2, duration: 2 }),
    ];
    expect(planOverwriteAtTime(clips, 0, 10)).toEqual({
      trims: [],
      removals: ['c1', 'c2'],
    });
  });

  it('keeps only the head when a clip spans the whole insert range', () => {
    // Clip occupies [0,20]; insert [5,8]
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 20, duration: 20 }),
    ];
    expect(planOverwriteAtTime(clips, 5, 3)).toEqual({
      trims: [{ clipId: 'c1', start: 0, end: 5, timelineStart: 0 }],
      removals: [],
    });
  });

  it('handles a mix of head trim, tail trim, and removal', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 4, duration: 4 }),
      makeClip({ id: 'c2', timelineStart: 4, start: 0, end: 2, duration: 2 }),
      makeClip({ id: 'c3', timelineStart: 6, start: 0, end: 4, duration: 4 }),
    ];
    // Insert [3,8]: c1 keeps [0,3], c2 removed, c3 keeps tail [8,10]
    expect(planOverwriteAtTime(clips, 3, 5)).toEqual({
      trims: [
        { clipId: 'c1', start: 0, end: 3, timelineStart: 0 },
        { clipId: 'c3', start: 2, end: 4, timelineStart: 8 },
      ],
      removals: ['c2'],
    });
  });

  it('positions sequential clips (no timelineStart) before planning', () => {
    // Sequential clips occupy [0,3] and [3,6]; insert [4,6] trims c2's tail
    const clips = [
      makeClip({ id: 'c1', start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', start: 0, end: 3, duration: 3 }),
    ];
    expect(planOverwriteAtTime(clips, 4, 2)).toEqual({
      trims: [{ clipId: 'c2', start: 0, end: 1, timelineStart: 3 }],
      removals: [],
    });
  });

  it('does not touch clips that merely touch the insert edges', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 5, duration: 5 }),
      makeClip({ id: 'c2', timelineStart: 8, start: 0, end: 2, duration: 2 }),
    ];
    // Insert exactly into the [5,8] gap
    expect(planOverwriteAtTime(clips, 5, 3)).toEqual({
      trims: [],
      removals: [],
    });
  });
});
