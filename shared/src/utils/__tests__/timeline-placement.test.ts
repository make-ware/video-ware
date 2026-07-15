import { describe, it, expect } from 'vitest';
import type { TimelineClip } from '../../schema/timeline-clip.js';
import type { TimelineTrackRecord } from '../../schema/timeline-track.js';
import {
  buildPlaybackTracks,
  clipPlaybackRegions,
  clipSourceTimeAtOffset,
  computeClipPlacement,
  computeTimelineDuration,
  findActiveClip,
  findNextClip,
  findNextPlaybackCut,
  findNonOverlappingTimelineStart,
  getClipRanges,
  getClipTimelineDuration,
  planOverwriteAtTime,
  planRippleDelete,
  planRippleInsert,
  playbackRegionAt,
  regionSourceEnd,
} from '../timeline-placement.js';

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

function makeCaptionClip(
  overrides: Partial<TimelineClip> & { id: string }
): TimelineClip {
  return makeClip({
    MediaRef: undefined,
    CaptionRef: 'caption-1',
    ...overrides,
  });
}

function makeTrack(
  overrides: Partial<TimelineTrackRecord> & { id: string }
): TimelineTrackRecord {
  return {
    collectionId: 'timelinetracks',
    collectionName: 'TimelineTracks',
    created: '',
    updated: '',
    TimelineRef: 'tl-1',
    layer: 0,
    volume: 1,
    opacity: 1,
    isMuted: false,
    isLocked: false,
    ...overrides,
  } as TimelineTrackRecord;
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
      trims: [
        { clipId: 'c1', start: 0, end: 6, duration: 6, timelineStart: 4 },
      ],
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
      trims: [
        { clipId: 'c1', start: 14, end: 20, duration: 6, timelineStart: 8 },
      ],
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
      trims: [
        { clipId: 'c1', start: 0, end: 5, duration: 5, timelineStart: 0 },
      ],
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
        { clipId: 'c1', start: 0, end: 3, duration: 3, timelineStart: 0 },
        { clipId: 'c3', start: 2, end: 4, duration: 2, timelineStart: 8 },
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
      trims: [
        { clipId: 'c2', start: 0, end: 1, duration: 1, timelineStart: 3 },
      ],
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

  it('trims composite clips in effective time via their edit list', () => {
    // Edit list [0,5] + [12,15]: 8s effective, occupying [0,8] on the
    // timeline. Inserting at 6 keeps a 6s head — 5s from the first segment
    // plus 1s into the second, so the new window ends at source 13.
    const composite = makeClip({
      id: 'c1',
      timelineStart: 0,
      start: 0,
      end: 15,
      duration: 8,
      meta: {
        segments: [
          { start: 0, end: 5 },
          { start: 12, end: 15 },
        ],
      },
    });
    expect(planOverwriteAtTime([composite], 6, 4)).toEqual({
      trims: [
        { clipId: 'c1', start: 0, end: 13, duration: 6, timelineStart: 0 },
      ],
      removals: [],
    });
  });

  it('trims a composite tail through the windowed edit list', () => {
    // Same list, insert [0,3]: the 5s tail starts at effective offset 3 —
    // source 3 — and the edit list itself is untouched.
    const composite = makeClip({
      id: 'c1',
      timelineStart: 0,
      start: 0,
      end: 15,
      duration: 8,
      meta: {
        segments: [
          { start: 0, end: 5 },
          { start: 12, end: 15 },
        ],
      },
    });
    expect(planOverwriteAtTime([composite], 0, 3)).toEqual({
      trims: [
        { clipId: 'c1', start: 3, end: 15, duration: 5, timelineStart: 3 },
      ],
      removals: [],
    });
  });
});

describe('planRippleDelete', () => {
  it('returns no moves when the deleted clip is last on the track', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 3, start: 0, end: 2, duration: 2 }),
    ];
    expect(planRippleDelete(clips, ['c2'])).toEqual([]);
  });

  it('shifts following clips left by the deleted clip duration', () => {
    // c1 [0,3], c2 [3,8], c3 [8,10]; delete c2 → c3 moves to 3
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 3, start: 0, end: 5, duration: 5 }),
      makeClip({ id: 'c3', timelineStart: 8, start: 0, end: 2, duration: 2 }),
    ];
    expect(planRippleDelete(clips, ['c2'])).toEqual([
      { clipId: 'c3', timelineStart: 3 },
    ]);
  });

  it('preserves gaps that already existed between clips', () => {
    // c1 [0,3], gap, c2 [5,8], gap, c3 [10,12]; delete c2 → c3 keeps its
    // 2s lead-in gap and only closes c2's 3s extent
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 5, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c3', timelineStart: 10, start: 0, end: 2, duration: 2 }),
    ];
    expect(planRippleDelete(clips, ['c2'])).toEqual([
      { clipId: 'c3', timelineStart: 7 },
    ]);
  });

  it('does not move clips positioned before the deleted clip', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 5, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c3', timelineStart: 8, start: 0, end: 2, duration: 2 }),
    ];
    expect(planRippleDelete(clips, ['c2'])).toEqual([
      { clipId: 'c3', timelineStart: 5 },
    ]);
  });

  it('accumulates shifts when multiple clips are deleted', () => {
    // c1 [0,2], c2 [2,5], c3 [5,6], c4 [6,10]; delete c1+c3 →
    // c2 closes c1's 2s, c4 closes c1's 2s + c3's 1s
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 2, duration: 2 }),
      makeClip({ id: 'c2', timelineStart: 2, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c3', timelineStart: 5, start: 0, end: 1, duration: 1 }),
      makeClip({ id: 'c4', timelineStart: 6, start: 0, end: 4, duration: 4 }),
    ];
    expect(planRippleDelete(clips, ['c1', 'c3'])).toEqual([
      { clipId: 'c2', timelineStart: 0 },
      { clipId: 'c4', timelineStart: 3 },
    ]);
  });

  it('pins sequential clips (no timelineStart) at their shifted position', () => {
    // Sequential clips occupy [0,3], [3,6], [6,8]; delete the middle one
    const clips = [
      makeClip({ id: 'c1', start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c3', start: 0, end: 2, duration: 2 }),
    ];
    // getClipRanges places them in array order (all default to position 0
    // when sorting), so c3 sits at [6,8] and shifts to 3
    expect(planRippleDelete(clips, ['c2'])).toEqual([
      { clipId: 'c3', timelineStart: 3 },
    ]);
  });

  it('ignores deleted ids that are not on the track', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 3, start: 0, end: 2, duration: 2 }),
    ];
    expect(planRippleDelete(clips, ['other-track-clip'])).toEqual([]);
  });
});

describe('buildPlaybackTracks', () => {
  it('places clips at their timelineStart', () => {
    const tracks = [makeTrack({ id: 't0', layer: 0 })];
    const clips = [
      makeClip({
        id: 'c1',
        TimelineTrackRef: 't0',
        timelineStart: 5,
        start: 2,
        end: 6,
      }),
    ];

    const [track] = buildPlaybackTracks(clips, tracks);
    expect(track.mediaClips).toHaveLength(1);
    expect(track.mediaClips[0].globalStart).toBe(5);
    expect(track.mediaClips[0].globalEnd).toBe(9);
  });

  it('places clips without timelineStart sequentially after preceding clips', () => {
    const tracks = [makeTrack({ id: 't0', layer: 0 })];
    const clips = [
      makeClip({
        id: 'c1',
        TimelineTrackRef: 't0',
        timelineStart: 0,
        start: 0,
        end: 3,
      }),
      makeClip({ id: 'c2', TimelineTrackRef: 't0', start: 0, end: 2 }),
    ];

    const [track] = buildPlaybackTracks(clips, tracks);
    expect(track.mediaClips[1].globalStart).toBe(3);
    expect(track.mediaClips[1].globalEnd).toBe(5);
  });

  it('keeps tracks independent so clips can overlap across layers', () => {
    const tracks = [
      makeTrack({ id: 't0', layer: 0 }),
      makeTrack({ id: 't1', layer: 1 }),
    ];
    const clips = [
      makeClip({
        id: 'c1',
        TimelineTrackRef: 't0',
        timelineStart: 0,
        start: 0,
        end: 10,
      }),
      makeClip({
        id: 'c2',
        TimelineTrackRef: 't1',
        timelineStart: 2,
        start: 0,
        end: 4,
      }),
    ];

    const [bottom, top] = buildPlaybackTracks(clips, tracks);
    expect(bottom.layer).toBe(0);
    expect(top.layer).toBe(1);
    // Both clips are active at t=3
    expect(findActiveClip(bottom.mediaClips, 3)?.clip.id).toBe('c1');
    expect(findActiveClip(top.mediaClips, 3)?.clip.id).toBe('c2');
  });

  it('returns tracks sorted by layer ascending regardless of input order', () => {
    const tracks = [
      makeTrack({ id: 't2', layer: 2 }),
      makeTrack({ id: 't0', layer: 0 }),
      makeTrack({ id: 't1', layer: 1 }),
    ];

    const result = buildPlaybackTracks([], tracks);
    expect(result.map((t) => t.layer)).toEqual([0, 1, 2]);
  });

  it('assigns clips without a track to the layer-0 track', () => {
    const tracks = [
      makeTrack({ id: 't1', layer: 1 }),
      makeTrack({ id: 't0', layer: 0 }),
    ];
    const clips = [makeClip({ id: 'c1', start: 0, end: 4 })];

    const result = buildPlaybackTracks(clips, tracks);
    const layer0 = result.find((t) => t.trackId === 't0');
    expect(layer0?.mediaClips).toHaveLength(1);
  });

  it('synthesizes a layer-0 track for legacy timelines with no track records', () => {
    const clips = [
      makeClip({ id: 'c1', start: 0, end: 3 }),
      makeClip({ id: 'c2', start: 0, end: 2, order: 1 }),
    ];

    const result = buildPlaybackTracks(clips, []);
    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe(0);
    expect(result[0].mediaClips).toHaveLength(2);
    // Sequential placement
    expect(result[0].mediaClips[1].globalStart).toBe(3);
  });

  it('splits media and caption clips but places them in a shared lane', () => {
    const tracks = [makeTrack({ id: 't0', layer: 0 })];
    const clips = [
      makeClip({
        id: 'c1',
        TimelineTrackRef: 't0',
        timelineStart: 0,
        start: 0,
        end: 3,
      }),
      // No timelineStart: placed sequentially after the media clip
      makeCaptionClip({ id: 'cap1', TimelineTrackRef: 't0', start: 0, end: 2 }),
    ];

    const [track] = buildPlaybackTracks(clips, tracks);
    expect(track.mediaClips).toHaveLength(1);
    expect(track.captionClips).toHaveLength(1);
    expect(track.captionClips[0].globalStart).toBe(3);
    expect(track.captionClips[0].globalEnd).toBe(5);
  });

  it('carries track settings through', () => {
    const tracks = [
      makeTrack({
        id: 't0',
        layer: 0,
        opacity: 0.5,
        volume: 0.25,
        isMuted: true,
      }),
    ];

    const [track] = buildPlaybackTracks([], tracks);
    expect(track.opacity).toBe(0.5);
    expect(track.volume).toBe(0.25);
    expect(track.isMuted).toBe(true);
  });
});

describe('findActiveClip', () => {
  it('uses an inclusive start and exclusive end', () => {
    const tracks = [makeTrack({ id: 't0', layer: 0 })];
    const clips = [
      makeClip({
        id: 'c1',
        TimelineTrackRef: 't0',
        timelineStart: 2,
        start: 0,
        end: 4,
      }),
    ];
    const [track] = buildPlaybackTracks(clips, tracks);

    expect(findActiveClip(track.mediaClips, 1.99)).toBeUndefined();
    expect(findActiveClip(track.mediaClips, 2)?.clip.id).toBe('c1');
    expect(findActiveClip(track.mediaClips, 5.99)?.clip.id).toBe('c1');
    expect(findActiveClip(track.mediaClips, 6)).toBeUndefined();
  });
});

describe('findNextClip', () => {
  const place = (clips: TimelineClip[]) => {
    const tracks = [makeTrack({ id: 't0', layer: 0 })];
    return buildPlaybackTracks(clips, tracks)[0].mediaClips;
  };

  it('returns undefined for an empty list', () => {
    expect(findNextClip([], 0)).toBeUndefined();
  });

  it('returns the first clip when the time is before it', () => {
    const placed = place([
      makeClip({ id: 'c1', timelineStart: 4, start: 0, end: 3 }),
    ]);
    expect(findNextClip(placed, 0)?.clip.id).toBe('c1');
  });

  it('returns the following clip from inside a clip', () => {
    const placed = place([
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 4 }),
      makeClip({ id: 'c2', timelineStart: 4, start: 0, end: 3 }),
    ]);
    expect(findNextClip(placed, 1.5)?.clip.id).toBe('c2');
  });

  it('returns the following clip from inside a gap', () => {
    const placed = place([
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3 }),
      makeClip({ id: 'c2', timelineStart: 8, start: 0, end: 2 }),
    ]);
    expect(findNextClip(placed, 5)?.clip.id).toBe('c2');
  });

  it('skips the newly active clip at an exact back-to-back boundary', () => {
    // findActiveClip's interval is [start, end): at t=4 c2 is active, so the
    // next clip is c3
    const placed = place([
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 4 }),
      makeClip({ id: 'c2', timelineStart: 4, start: 0, end: 4 }),
      makeClip({ id: 'c3', timelineStart: 8, start: 0, end: 2 }),
    ]);
    expect(findActiveClip(placed, 4)?.clip.id).toBe('c2');
    expect(findNextClip(placed, 4)?.clip.id).toBe('c3');
  });

  it('returns undefined after the last clip starts', () => {
    const placed = place([
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 4 }),
    ]);
    expect(findNextClip(placed, 2)).toBeUndefined();
    expect(findNextClip(placed, 10)).toBeUndefined();
  });

  it('picks the earliest upcoming clip from unsorted input', () => {
    const placed = [
      {
        clip: makeClip({ id: 'late', start: 0, end: 2 }),
        globalStart: 9,
        globalEnd: 11,
      },
      {
        clip: makeClip({ id: 'soon', start: 0, end: 2 }),
        globalStart: 5,
        globalEnd: 7,
      },
    ];
    expect(findNextClip(placed, 3)?.clip.id).toBe('soon');
  });
});

describe('clipSourceTimeAtOffset', () => {
  it('maps plain clips linearly from the trim window', () => {
    const clip = makeClip({ id: 'c1', start: 2, end: 9, duration: 7 });
    expect(clipSourceTimeAtOffset(clip, 0)).toBe(2);
    expect(clipSourceTimeAtOffset(clip, 3)).toBe(5);
  });

  it('maps composite clips through meta.segments', () => {
    const clip = makeClip({
      id: 'c1',
      start: 10,
      end: 23,
      duration: 5,
      meta: {
        segments: [
          { start: 10, end: 12 },
          { start: 20, end: 23 },
        ],
      },
    });
    expect(clipSourceTimeAtOffset(clip, 0)).toBe(10);
    expect(clipSourceTimeAtOffset(clip, 1)).toBe(11);
    // Past the first 2s segment: 0.5s into the second segment
    expect(clipSourceTimeAtOffset(clip, 2.5)).toBe(20.5);
  });

  it('windows the edit list by the clip start/end trim', () => {
    // Full list [10,12] + [20,23]; trim window 11–22 keeps [11,12] + [20,22]
    const clip = makeClip({
      id: 'c1',
      start: 11,
      end: 22,
      duration: 3,
      meta: {
        segments: [
          { start: 10, end: 12 },
          { start: 20, end: 23 },
        ],
      },
    });
    expect(clipSourceTimeAtOffset(clip, 0)).toBe(11);
    expect(clipSourceTimeAtOffset(clip, 1.5)).toBe(20.5);
  });

  it('falls back to expanded MediaClip segments, with meta winning', () => {
    const viaMediaClip = makeClip({
      id: 'c1',
      start: 0,
      end: 30,
      duration: 20,
      MediaClipRef: 'mc-1',
    });
    (viaMediaClip as TimelineClip & { expand?: unknown }).expand = {
      MediaClipRef: {
        id: 'mc-1',
        type: 'composite',
        clipData: {
          segments: [
            { start: 0, end: 10 },
            { start: 20, end: 30 },
          ],
        },
      },
    };
    expect(clipSourceTimeAtOffset(viaMediaClip, 15)).toBe(25);

    const withOverride = makeClip({
      id: 'c2',
      start: 0,
      end: 30,
      duration: 5,
      MediaClipRef: 'mc-1',
      meta: { segments: [{ start: 3, end: 8 }] },
    });
    (withOverride as TimelineClip & { expand?: unknown }).expand = {
      MediaClipRef: {
        id: 'mc-1',
        type: 'composite',
        clipData: { segments: [{ start: 0, end: 10 }] },
      },
    };
    expect(clipSourceTimeAtOffset(withOverride, 1)).toBe(4);
  });
});

describe('computeTimelineDuration', () => {
  it('uses the furthest clip end, not the sum of clip durations', () => {
    const tracks = [
      makeTrack({ id: 't0', layer: 0 }),
      makeTrack({ id: 't1', layer: 1 }),
    ];
    const clips = [
      makeClip({
        id: 'c1',
        TimelineTrackRef: 't0',
        timelineStart: 0,
        start: 0,
        end: 10,
      }),
      // Overlapping overlay clip: must not extend the duration to 14
      makeClip({
        id: 'c2',
        TimelineTrackRef: 't1',
        timelineStart: 2,
        start: 0,
        end: 4,
      }),
    ];

    expect(computeTimelineDuration(clips, tracks)).toBe(10);
  });

  it('respects timelineStart gaps', () => {
    const tracks = [makeTrack({ id: 't0', layer: 0 })];
    const clips = [
      makeClip({
        id: 'c1',
        TimelineTrackRef: 't0',
        timelineStart: 20,
        start: 0,
        end: 5,
      }),
    ];

    expect(computeTimelineDuration(clips, tracks)).toBe(25);
  });

  it('includes caption clips', () => {
    const tracks = [makeTrack({ id: 't0', layer: 0 })];
    const clips = [
      makeCaptionClip({
        id: 'cap1',
        TimelineTrackRef: 't0',
        timelineStart: 4,
        start: 0,
        end: 3,
      }),
    ];

    expect(computeTimelineDuration(clips, tracks)).toBe(7);
  });

  it('returns 0 for an empty timeline', () => {
    expect(computeTimelineDuration([], [])).toBe(0);
  });
});

describe('getClipTimelineDuration', () => {
  it('spans end - start for plain media clips', () => {
    const clip = makeClip({ id: 'c1', start: 2, end: 7, duration: 5 });
    expect(getClipTimelineDuration(clip)).toBe(5);
  });

  it('sums meta.segments for composite clips (skipping gaps)', () => {
    const clip = makeClip({
      id: 'c1',
      start: 1,
      end: 20,
      duration: 7,
      meta: {
        segments: [
          { start: 1, end: 5 },
          { start: 12, end: 15 },
        ],
      },
    });
    // 4 + 3 = 7, not the 19s source span
    expect(getClipTimelineDuration(clip)).toBe(7);
  });

  it('falls back to the source MediaClip composite segments', () => {
    const clip = makeClip({
      id: 'c1',
      start: 0,
      end: 30,
      duration: 30,
      MediaClipRef: 'mc-1',
    });
    (clip as TimelineClip & { expand?: unknown }).expand = {
      MediaClipRef: {
        id: 'mc-1',
        type: 'composite',
        clipData: {
          segments: [
            { start: 0, end: 10 },
            { start: 20, end: 30 },
          ],
        },
      },
    };
    expect(getClipTimelineDuration(clip)).toBe(20);
  });

  it('prefers meta.segments over the MediaClip segments', () => {
    const clip = makeClip({
      id: 'c1',
      start: 0,
      end: 30,
      duration: 5,
      MediaClipRef: 'mc-1',
      meta: { segments: [{ start: 0, end: 5 }] },
    });
    (clip as TimelineClip & { expand?: unknown }).expand = {
      MediaClipRef: {
        id: 'mc-1',
        type: 'composite',
        clipData: { segments: [{ start: 0, end: 10 }] },
      },
    };
    expect(getClipTimelineDuration(clip)).toBe(5);
  });

  it('keeps end - start for nested-timeline clips', () => {
    const clip = makeClip({
      id: 'c1',
      MediaRef: undefined,
      SourceTimelineRef: 'tl-child',
      start: 3,
      end: 10,
      duration: 7,
    });
    expect(getClipTimelineDuration(clip)).toBe(7);
  });

  it('windows the edit list by start/end (non-destructive trim)', () => {
    // Full list spans [1,5] + [12,15] (7s effective); window 3–13 keeps
    // [3,5] + [12,13] = 3s
    const clip = makeClip({
      id: 'c1',
      start: 3,
      end: 13,
      duration: 3,
      meta: {
        segments: [
          { start: 1, end: 5 },
          { start: 12, end: 15 },
        ],
      },
    });
    expect(getClipTimelineDuration(clip)).toBe(3);
  });
});

describe('getClipRanges with composite clips', () => {
  it('places sequential clips after the effective (not span) duration', () => {
    const composite = makeClip({
      id: 'c1',
      start: 0,
      end: 20,
      duration: 8,
      meta: {
        segments: [
          { start: 0, end: 5 },
          { start: 17, end: 20 },
        ],
      },
    });
    const next = makeClip({ id: 'c2', start: 0, end: 4, duration: 4 });
    const ranges = getClipRanges([composite, next]);
    expect(ranges[0]).toEqual({ start: 0, end: 8 });
    expect(ranges[1]).toEqual({ start: 8, end: 12 });
  });

  it('sizes absolutely positioned composite clips by effective duration', () => {
    const composite = makeClip({
      id: 'c1',
      timelineStart: 10,
      start: 2,
      end: 30,
      duration: 6,
      meta: {
        segments: [
          { start: 2, end: 6 },
          { start: 28, end: 30 },
        ],
      },
    });
    expect(getClipRanges([composite])[0]).toEqual({ start: 10, end: 16 });
  });
});

describe('planRippleInsert', () => {
  it('returns no moves on an empty track', () => {
    expect(planRippleInsert([], 5, 3)).toEqual([]);
  });

  it('returns no moves when all clips end before the insert point', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
    ];
    expect(planRippleInsert(clips, 5, 3)).toEqual([]);
  });

  it('shifts clips at/after the insert point right by the duration', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', timelineStart: 5, start: 0, end: 2, duration: 2 }),
      makeClip({ id: 'c3', timelineStart: 9, start: 0, end: 2, duration: 2 }),
    ];
    // Insert 4s at t=5: c2 and c3 shift by 4, preserving their 2s gap
    expect(planRippleInsert(clips, 5, 4)).toEqual([
      { clipId: 'c2', timelineStart: 9 },
      { clipId: 'c3', timelineStart: 13 },
    ]);
  });

  it('moves a straddling clip fully clear of the inserted range', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 2, start: 0, end: 6, duration: 6 }),
      makeClip({ id: 'c2', timelineStart: 10, start: 0, end: 2, duration: 2 }),
    ];
    // Insert 3s at t=4, mid-c1: c1 must land at 7 (insert end), so the
    // uniform delta is 7 - 2 = 5; c2 keeps its relative spacing.
    expect(planRippleInsert(clips, 4, 3)).toEqual([
      { clipId: 'c1', timelineStart: 7 },
      { clipId: 'c2', timelineStart: 15 },
    ]);
  });

  it('excludes the growing clip itself and shifts by effective growth', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 5, duration: 5 }),
      makeClip({ id: 'c2', timelineStart: 5, start: 0, end: 3, duration: 3 }),
    ];
    // c1 grows by 2s at its end (t=5): only c2 moves
    expect(planRippleInsert(clips, 5, 2, 'c1')).toEqual([
      { clipId: 'c2', timelineStart: 7 },
    ]);
  });

  it('pins previously sequential clips with an explicit timelineStart', () => {
    const clips = [
      makeClip({ id: 'c1', start: 0, end: 3, duration: 3 }),
      makeClip({ id: 'c2', start: 0, end: 2, duration: 2 }),
    ];
    // Sequential layout: c1 [0,3), c2 [3,5). Insert 2s at t=0.
    expect(planRippleInsert(clips, 0, 2)).toEqual([
      { clipId: 'c1', timelineStart: 2 },
      { clipId: 'c2', timelineStart: 5 },
    ]);
  });

  it('ignores zero and negative insert durations', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 0, start: 0, end: 3, duration: 3 }),
    ];
    expect(planRippleInsert(clips, 0, 0)).toEqual([]);
    expect(planRippleInsert(clips, 0, -2)).toEqual([]);
  });
});

describe('playback regions and cuts', () => {
  it('resolves a plain clip to a single region', () => {
    const placed = {
      clip: makeClip({ id: 'c1', start: 2, end: 9, duration: 7 }),
      globalStart: 5,
      globalEnd: 12,
    };
    expect(clipPlaybackRegions(placed)).toEqual([
      { key: 'c1', timelineStart: 5, timelineEnd: 12, sourceStart: 2 },
    ]);
  });

  it('splits a composite clip into one region per edit-list run', () => {
    const placed = {
      clip: makeClip({
        id: 'c1',
        start: 10,
        end: 23,
        duration: 5,
        meta: {
          segments: [
            { start: 10, end: 12 },
            { start: 20, end: 23 },
          ],
        },
      }),
      globalStart: 5,
      globalEnd: 10,
    };
    const regions = clipPlaybackRegions(placed);
    expect(regions).toEqual([
      { key: 'c1#0', timelineStart: 5, timelineEnd: 7, sourceStart: 10 },
      { key: 'c1#1', timelineStart: 7, timelineEnd: 10, sourceStart: 20 },
    ]);
    expect(regionSourceEnd(regions[0])).toBe(12);
    expect(regionSourceEnd(regions[1])).toBe(23);
  });

  it('coalesces segments that touch in source time into one region', () => {
    // A split point that removes nothing must not force a playback seek
    const placed = {
      clip: makeClip({
        id: 'c1',
        start: 0,
        end: 8,
        duration: 8,
        meta: {
          segments: [
            { start: 0, end: 3 },
            { start: 3, end: 5 },
            { start: 6, end: 8 },
          ],
        },
      }),
      globalStart: 0,
      globalEnd: 7,
    };
    expect(clipPlaybackRegions(placed)).toEqual([
      { key: 'c1#0', timelineStart: 0, timelineEnd: 5, sourceStart: 0 },
      { key: 'c1#1', timelineStart: 5, timelineEnd: 7, sourceStart: 6 },
    ]);
  });

  it('windows regions by the clip start/end trim', () => {
    // Full list [10,12] + [20,23]; trim window 11–22 keeps [11,12] + [20,22]
    const placed = {
      clip: makeClip({
        id: 'c1',
        start: 11,
        end: 22,
        duration: 3,
        meta: {
          segments: [
            { start: 10, end: 12 },
            { start: 20, end: 23 },
          ],
        },
      }),
      globalStart: 0,
      globalEnd: 3,
    };
    expect(clipPlaybackRegions(placed)).toEqual([
      { key: 'c1#0', timelineStart: 0, timelineEnd: 1, sourceStart: 11 },
      { key: 'c1#1', timelineStart: 1, timelineEnd: 3, sourceStart: 20 },
    ]);
  });

  it('playbackRegionAt resolves the region at a time, clamped at the edges', () => {
    const placed = {
      clip: makeClip({
        id: 'c1',
        start: 10,
        end: 23,
        duration: 5,
        meta: {
          segments: [
            { start: 10, end: 12 },
            { start: 20, end: 23 },
          ],
        },
      }),
      globalStart: 5,
      globalEnd: 10,
    };
    expect(playbackRegionAt(placed, 5).key).toBe('c1#0');
    expect(playbackRegionAt(placed, 6.9).key).toBe('c1#0');
    expect(playbackRegionAt(placed, 7).key).toBe('c1#1');
    // Clamped: before the clip → first region, at/after the end → last
    expect(playbackRegionAt(placed, 4).key).toBe('c1#0');
    expect(playbackRegionAt(placed, 10).key).toBe('c1#1');
  });

  it('findNextPlaybackCut returns the edit-list jump inside the active clip', () => {
    const placed = [
      {
        clip: makeClip({
          id: 'c1',
          start: 10,
          end: 23,
          duration: 5,
          meta: {
            segments: [
              { start: 10, end: 12 },
              { start: 20, end: 23 },
            ],
          },
        }),
        globalStart: 5,
        globalEnd: 10,
      },
      {
        clip: makeClip({ id: 'c2', MediaRef: 'media-2', start: 0, end: 3 }),
        globalStart: 12,
        globalEnd: 15,
      },
    ];
    const cut = findNextPlaybackCut(placed, 5.5);
    expect(cut).toMatchObject({
      time: 7,
      mediaId: 'media-1',
      region: { key: 'c1#1', sourceStart: 20 },
    });
  });

  it('findNextPlaybackCut falls through to the next clip, gaps included', () => {
    const placed = [
      {
        clip: makeClip({ id: 'c1', start: 0, end: 5 }),
        globalStart: 0,
        globalEnd: 5,
      },
      {
        clip: makeClip({ id: 'c2', MediaRef: 'media-2', start: 1, end: 4 }),
        globalStart: 8,
        globalEnd: 11,
      },
    ];
    // Inside c1 (no intra-clip jumps) and idling in the gap after it
    for (const time of [2, 6]) {
      expect(findNextPlaybackCut(placed, time)).toMatchObject({
        time: 8,
        mediaId: 'media-2',
        region: { key: 'c2', sourceStart: 1 },
      });
    }
    expect(findNextPlaybackCut(placed, 12)).toBeUndefined();
  });
});
