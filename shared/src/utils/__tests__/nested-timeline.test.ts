import { describe, it, expect } from 'vitest';
import type { TimelineClip } from '../../schema/timeline-clip';
import type { TimelineTrackRecord } from '../../schema/timeline-track';
import {
  buildPlaybackChannels,
  collectNestedTimelineIds,
  projectChildWindow,
  wouldCreateTimelineCycle,
  type NestedTimelineMap,
} from '../nested-timeline';
import { generateTracks } from '../generate-tracks';

function makeClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    TimelineRef: 'timeline1',
    order: 0,
    start: 0,
    end: 0,
    duration: 0,
    ...overrides,
  } as unknown as TimelineClip;
}

function makeTrack(
  overrides: Partial<TimelineTrackRecord>
): TimelineTrackRecord {
  return {
    id: 'track',
    TimelineRef: 'timeline1',
    layer: 0,
    volume: 1,
    opacity: 1,
    isMuted: false,
    isLocked: false,
    ...overrides,
  } as unknown as TimelineTrackRecord;
}

describe('projectChildWindow', () => {
  // Nested clip placed at parent 10s, trimmed to child time [2, 8)
  it('projects a window fully inside the trim', () => {
    expect(projectChildWindow(10, 2, 8, 3, 5)).toEqual({
      parentStart: 11,
      parentEnd: 13,
      headTrim: 0,
    });
  });

  it('head-trims a window straddling the trim in-point', () => {
    expect(projectChildWindow(10, 2, 8, 0, 5)).toEqual({
      parentStart: 10,
      parentEnd: 13,
      headTrim: 2,
    });
  });

  it('tail-clips a window straddling the trim out-point', () => {
    expect(projectChildWindow(10, 2, 8, 6, 12)).toEqual({
      parentStart: 14,
      parentEnd: 16,
      headTrim: 0,
    });
  });

  it('returns null for a window outside the trim', () => {
    expect(projectChildWindow(10, 2, 8, 8, 12)).toBeNull();
    expect(projectChildWindow(10, 2, 8, 0, 2)).toBeNull();
  });
});

describe('wouldCreateTimelineCycle', () => {
  const nested: NestedTimelineMap = {
    b: {
      clips: [makeClip({ id: 'b1', SourceTimelineRef: 'c' })],
      tracks: [],
    },
    c: { clips: [], tracks: [] },
  };

  it('detects self-reference', () => {
    expect(wouldCreateTimelineCycle('a', 'a', nested)).toBe(true);
  });

  it('detects a transitive cycle', () => {
    const withBack: NestedTimelineMap = {
      ...nested,
      c: {
        clips: [makeClip({ id: 'c1', SourceTimelineRef: 'a' })],
        tracks: [],
      },
    };
    expect(wouldCreateTimelineCycle('a', 'b', withBack)).toBe(true);
  });

  it('accepts an acyclic insert', () => {
    expect(wouldCreateTimelineCycle('a', 'b', nested)).toBe(false);
  });

  it('collects unique nested ids', () => {
    expect(
      collectNestedTimelineIds([
        makeClip({ id: '1', SourceTimelineRef: 'x' }),
        makeClip({ id: '2', SourceTimelineRef: 'x' }),
        makeClip({ id: '3', MediaRef: 'm' }),
      ])
    ).toEqual(['x']);
  });
});

describe('buildPlaybackChannels', () => {
  // Child timeline "sub": two tracks, one media clip each.
  //   track s0 (layer 0): media clip [0, 6) of mediaA
  //   track s1 (layer 1, volume 0.5): media clip at 1s, [0, 4) of mediaB
  const nested: NestedTimelineMap = {
    sub: {
      clips: [
        makeClip({
          id: 'subclip-a',
          TimelineTrackRef: 's0',
          MediaRef: 'mediaA',
          start: 0,
          end: 6,
          timelineStart: 0,
        }),
        makeClip({
          id: 'subclip-b',
          TimelineTrackRef: 's1',
          MediaRef: 'mediaB',
          start: 0,
          end: 4,
          timelineStart: 1,
        }),
      ],
      tracks: [
        makeTrack({ id: 's0', TimelineRef: 'sub', layer: 0 }),
        makeTrack({ id: 's1', TimelineRef: 'sub', layer: 1, volume: 0.5 }),
      ],
    },
  };

  const parentTracks = [makeTrack({ id: 'p0', layer: 0 })];

  it('expands a nested clip into derived channels with projected clips', () => {
    // Nested clip at parent 10s, trimmed to child [2, 8) => 6s long
    const clips = [
      makeClip({
        id: 'own',
        TimelineTrackRef: 'p0',
        MediaRef: 'mediaC',
        start: 0,
        end: 10,
        timelineStart: 0,
      }),
      makeClip({
        id: 'nest',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'sub',
        start: 2,
        end: 8,
        timelineStart: 10,
      }),
    ];

    const result = buildPlaybackChannels({
      clips,
      tracks: parentTracks,
      nestedTimelines: nested,
      rootTimelineId: 'root',
    });

    expect(result.requiredChannels).toBe(3);
    expect(result.droppedChannelCount).toBe(0);
    expect(result.channels).toHaveLength(3);

    // Bottom: the parent's own channel
    expect(result.channels[0].trackId).toBe('p0');
    expect(result.channels[0].mediaClips.map((p) => p.clip.id)).toEqual([
      'own',
    ]);

    // Child track s0's clip [0,6) head-trimmed by 2 => parent [10, 14)
    const derived0 = result.channels[1];
    expect(derived0.mediaClips).toHaveLength(1);
    expect(derived0.mediaClips[0].globalStart).toBe(10);
    expect(derived0.mediaClips[0].globalEnd).toBe(14);
    expect(derived0.mediaClips[0].clip.start).toBe(2); // source in advanced
    expect(derived0.mediaClips[0].clip.MediaRef).toBe('mediaA');

    // Child track s1's clip [1,5) intersect [2,8) => head-trim 1, parent [10, 13)
    const derived1 = result.channels[2];
    expect(derived1.mediaClips[0].globalStart).toBe(10);
    expect(derived1.mediaClips[0].globalEnd).toBe(13);
    expect(derived1.mediaClips[0].clip.start).toBe(1);
    expect(derived1.volume).toBe(0.5); // child track volume folded in
  });

  it('shares derived channels across repeats of the same nested timeline', () => {
    const clips = [
      makeClip({
        id: 'nest1',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'sub',
        start: 0,
        end: 6,
        timelineStart: 0,
      }),
      makeClip({
        id: 'nest2',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'sub',
        start: 0,
        end: 6,
        timelineStart: 6,
      }),
    ];

    const result = buildPlaybackChannels({
      clips,
      tracks: parentTracks,
      nestedTimelines: nested,
    });

    // Two insertions share the same two derived channels
    expect(result.requiredChannels).toBe(2);
    expect(result.channels[0].mediaClips).toHaveLength(2);
    expect(result.channels[0].mediaClips.map((p) => p.globalStart)).toEqual([
      0, 6,
    ]);
  });

  it('drops nested channels beyond the budget and reports the count', () => {
    const clips = [
      makeClip({
        id: 'own',
        TimelineTrackRef: 'p0',
        MediaRef: 'mediaC',
        start: 0,
        end: 10,
        timelineStart: 0,
      }),
      makeClip({
        id: 'nest',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'sub',
        start: 0,
        end: 6,
        timelineStart: 10,
      }),
    ];

    const result = buildPlaybackChannels({
      clips,
      tracks: parentTracks,
      nestedTimelines: nested,
      maxChannels: 2,
    });

    expect(result.requiredChannels).toBe(3);
    expect(result.droppedChannelCount).toBe(1);
    expect(result.channels).toHaveLength(2);
    // The parent's own channel always survives
    expect(result.channels[0].trackId).toBe('p0');
  });

  it('ignores cycles back to the root timeline', () => {
    const cyclic: NestedTimelineMap = {
      sub: {
        clips: [
          makeClip({
            id: 'back',
            SourceTimelineRef: 'root',
            start: 0,
            end: 5,
            timelineStart: 0,
          }),
        ],
        tracks: [makeTrack({ id: 's0', TimelineRef: 'sub' })],
      },
    };

    const result = buildPlaybackChannels({
      clips: [
        makeClip({
          id: 'nest',
          TimelineTrackRef: 'p0',
          SourceTimelineRef: 'sub',
          start: 0,
          end: 5,
          timelineStart: 0,
        }),
      ],
      tracks: parentTracks,
      nestedTimelines: cyclic,
      rootTimelineId: 'root',
    });

    expect(result.requiredChannels).toBe(0);
    expect(result.channels).toHaveLength(0);
  });

  it('projects nested captions into parent time', () => {
    const withCaption: NestedTimelineMap = {
      sub: {
        clips: [
          {
            ...makeClip({
              id: 'subcap',
              TimelineTrackRef: 's0',
              CaptionRef: 'cap1',
              start: 0,
              end: 4,
              timelineStart: 1,
            }),
            expand: { CaptionRef: { id: 'cap1', text: 'hello' } },
          } as unknown as TimelineClip,
        ],
        tracks: [makeTrack({ id: 's0', TimelineRef: 'sub' })],
      },
    };

    const result = buildPlaybackChannels({
      clips: [
        makeClip({
          id: 'nest',
          TimelineTrackRef: 'p0',
          SourceTimelineRef: 'sub',
          start: 2,
          end: 5,
          timelineStart: 10,
        }),
      ],
      tracks: parentTracks,
      nestedTimelines: withCaption,
    });

    // Caption [1,5) intersect trim [2,5) => head-trim 1, parent [10, 13)
    expect(result.captionClips).toHaveLength(1);
    const projected = result.captionClips[0];
    expect(projected.globalStart).toBe(10);
    expect(projected.globalEnd).toBe(13);
    expect(projected.clip.start).toBe(1);
    expect(
      (projected.clip as { expand?: { CaptionRef?: { text: string } } }).expand
        ?.CaptionRef?.text
    ).toBe('hello');
  });
});

describe('generateTracks with nested-timeline clips', () => {
  const childTrack = makeTrack({ id: 'c0', TimelineRef: 'sub', layer: 0 });
  const childClips = [
    makeClip({
      id: 'subclip',
      TimelineTrackRef: 'c0',
      MediaRef: 'mediaA',
      start: 3,
      end: 9, // 6s of source starting at 3s
      timelineStart: 0,
    }),
  ];
  const nested: NestedTimelineMap = {
    sub: { clips: childClips, tracks: [childTrack] },
  };

  const parentTrack = makeTrack({ id: 'p0', layer: 0 });

  it('expands a nested clip into projected video + audio tracks', () => {
    const clips = [
      makeClip({
        id: 'own',
        TimelineTrackRef: 'p0',
        MediaRef: 'mediaC',
        start: 0,
        end: 4,
        timelineStart: 0,
      }),
      // Nested clip at 4s, trimmed to child [1, 5) => 4s long
      makeClip({
        id: 'nest',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'sub',
        start: 1,
        end: 5,
        timelineStart: 4,
      }),
    ];

    const tracks = generateTracks(clips, [parentTrack], {
      nestedTimelines: nested,
      rootTimelineId: 'root',
    });

    // parent video + parent audio + nested video + nested audio
    expect(tracks).toHaveLength(4);

    const nestedVideo = tracks.find(
      (t) => t.type === 'video' && t.id.startsWith('nest_')
    );
    expect(nestedVideo).toBeDefined();
    // Fractional layer between parent layer 0 and the next track
    expect(nestedVideo!.layer).toBeGreaterThan(0);
    expect(nestedVideo!.layer).toBeLessThan(1);

    // Child segment [0,6) source 3 → trimmed to [1,5): parent [4,8), source 4
    expect(nestedVideo!.segments).toHaveLength(1);
    const seg = nestedVideo!.segments[0];
    expect(seg.assetId).toBe('mediaA');
    expect(seg.time.start).toBe(4);
    expect(seg.time.duration).toBe(4);
    expect(seg.time.sourceStart).toBe(4);

    const nestedAudio = tracks.find(
      (t) => t.type === 'audio' && t.id.startsWith('nest_')
    );
    expect(nestedAudio).toBeDefined();
    expect(nestedAudio!.segments[0].time.start).toBe(4);
    expect(nestedAudio!.segments[0].audio?.volume).toBe(1);
  });

  it('scales nested audio by parent track volume and clip gain', () => {
    const quietParent = makeTrack({ id: 'p0', layer: 0, volume: 0.5 });
    const clips = [
      makeClip({
        id: 'nest',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'sub',
        start: 0,
        end: 6,
        timelineStart: 0,
        meta: { gain: 0.5 },
      }),
    ];

    const tracks = generateTracks(clips, [quietParent], {
      nestedTimelines: nested,
    });

    const nestedAudio = tracks.find(
      (t) => t.type === 'audio' && t.id.startsWith('nest_')
    );
    expect(nestedAudio!.segments[0].audio?.volume).toBe(0.25);
  });

  it('drops nested audio when the parent track is muted', () => {
    const mutedParent = makeTrack({ id: 'p0', layer: 0, isMuted: true });
    const clips = [
      makeClip({
        id: 'nest',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'sub',
        start: 0,
        end: 6,
        timelineStart: 0,
      }),
    ];

    const tracks = generateTracks(clips, [mutedParent], {
      nestedTimelines: nested,
    });

    expect(
      tracks.find((t) => t.type === 'audio' && t.id.startsWith('nest_'))
    ).toBeUndefined();
    expect(
      tracks.find((t) => t.type === 'video' && t.id.startsWith('nest_'))
    ).toBeDefined();
  });

  it('keeps sequential layout when the child cannot be resolved', () => {
    const clips = [
      // Nested clip first (unresolvable child), then a media clip with no
      // timelineStart — it must still start after the nested clip's 6s.
      makeClip({
        id: 'nest',
        TimelineTrackRef: 'p0',
        SourceTimelineRef: 'missing',
        start: 0,
        end: 6,
      }),
      makeClip({
        id: 'own',
        TimelineTrackRef: 'p0',
        MediaRef: 'mediaC',
        start: 0,
        end: 4,
      }),
    ];

    const tracks = generateTracks(clips, [parentTrack], {
      nestedTimelines: nested,
    });

    const video = tracks.find((t) => t.id === 'p0');
    expect(video!.segments).toHaveLength(1);
    expect(video!.segments[0].time.start).toBe(6);
  });

  it('expands nested-in-nested timelines and stops on cycles', () => {
    // grand: media clip [0,4); mid: nests grand; root clip nests mid.
    const deepNested: NestedTimelineMap = {
      grand: {
        clips: [
          makeClip({
            id: 'gclip',
            TimelineTrackRef: 'g0',
            MediaRef: 'mediaG',
            start: 0,
            end: 4,
            timelineStart: 0,
          }),
        ],
        tracks: [makeTrack({ id: 'g0', TimelineRef: 'grand' })],
      },
      mid: {
        clips: [
          makeClip({
            id: 'mclip',
            TimelineTrackRef: 'm0',
            SourceTimelineRef: 'grand',
            start: 0,
            end: 4,
            timelineStart: 1,
          }),
          // Cycle back to root — must be ignored
          makeClip({
            id: 'mcycle',
            TimelineTrackRef: 'm0',
            SourceTimelineRef: 'root',
            start: 0,
            end: 2,
            timelineStart: 5,
          }),
        ],
        tracks: [makeTrack({ id: 'm0', TimelineRef: 'mid' })],
      },
    };

    const tracks = generateTracks(
      [
        makeClip({
          id: 'nest',
          TimelineTrackRef: 'p0',
          SourceTimelineRef: 'mid',
          start: 0,
          end: 7,
          timelineStart: 2,
        }),
      ],
      [parentTrack],
      { nestedTimelines: deepNested, rootTimelineId: 'root' }
    );

    // Grandchild segment: child-of-child placed at mid 1s → parent 2+1 = 3s
    const grandVideo = tracks.find(
      (t) =>
        t.type === 'video' && t.segments.some((s) => s.assetId === 'mediaG')
    );
    expect(grandVideo).toBeDefined();
    expect(grandVideo!.segments[0].time.start).toBe(3);
    expect(grandVideo!.segments[0].time.duration).toBe(4);

    // No segment should reference the root cycle
    const allAssetIds = tracks.flatMap((t) => t.segments.map((s) => s.assetId));
    expect(allAssetIds).not.toContain('root');
  });
});
