import { describe, it, expect } from 'vitest';
import { generateTracks } from '../generate-tracks';
import type { TimelineClip } from '../../schema/timeline-clip';
import type { MediaClip } from '../../schema/media-clip';
import { TimelineTrackRecord } from '../../schema';

// Mock types to match the expected inputs
type TimelineClipWithExpand = TimelineClip & {
  expand?: {
    MediaClipRef?: MediaClip;
  };
};

describe('generateTracks with composite clips', () => {
  it('should process sequential composite clips without overlap', () => {
    // Clip 1: Composite, 2 segments, total duration 10s
    const clip1: TimelineClipWithExpand = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 0,
      end: 0, // Not used for composite
      order: 0,
      TimelineTrackRef: 'track1', // Same track
      expand: {
        MediaClipRef: {
          id: 'mc1',
          type: 'composite',
          MediaRef: 'media1',
          start: 0,
          end: 0,
          clipData: {
            segments: [
              { start: 0, end: 5 }, // 5s
              { start: 10, end: 15 }, // 5s
            ],
          },
        } as unknown as MediaClip,
      },
    } as unknown as TimelineClipWithExpand;

    // Clip 2: Composite, 2 segments, total duration 5s
    const clip2: TimelineClipWithExpand = {
      id: 'clip2',
      TimelineRef: 'timeline1',
      MediaRef: 'media2',
      start: 0,
      end: 0,
      order: 1,
      TimelineTrackRef: 'track1', // Same track
      timelineStart: 0, // Explicitly set to 0 to simulate the bug
      expand: {
        MediaClipRef: {
          id: 'mc2',
          type: 'composite',
          MediaRef: 'media2',
          start: 0,
          end: 0,
          clipData: {
            segments: [
              { start: 0, end: 3 }, // 3s
              { start: 10, end: 12 }, // 2s
            ],
          },
        } as unknown as MediaClip,
      },
    } as unknown as TimelineClipWithExpand;

    // Define track entity
    const trackEntity: TimelineTrackRecord = {
      id: 'track1',
      layer: 0,
      TimelineRef: 'timeline1',
      opacity: 1,
      isMuted: false,
      volume: 1,
      name: 'Track 1',
      collectionId: 'coll1',
      isLocked: false,
      collectionName: 'TimelineTrack',
      expand: {},
      created: '2022-01-01T00:00:00.000Z',
      updated: '2022-01-01T00:00:00.000Z',
    };

    const tracks = generateTracks([clip1, clip2], [trackEntity]);

    expect(tracks).toHaveLength(2); // 1 video track + 1 audio track generated
    const videoTrack = tracks.find((t) => t.type === 'video');
    expect(videoTrack).toBeDefined();

    // Check segments in video track
    const segments = videoTrack!.segments;
    expect(segments).toHaveLength(4); // 2 from clip1 + 2 from clip2

    // Clip 1 Segments
    // Seg 1: 0 - 5
    expect(segments[0].time.start).toBe(0);
    expect(segments[0].time.duration).toBe(5);

    // Seg 2: 5 - 10
    expect(segments[1].time.start).toBe(5);
    expect(segments[1].time.duration).toBe(5);

    // Clip 2 Segments
    // Should start at 10!
    expect(segments[2].id).toContain('clip2');
    expect(segments[2].time.start).toBe(10);
    expect(segments[2].time.duration).toBe(3);
    expect(segments[3].time.start).toBe(13);
    expect(segments[3].time.duration).toBe(2);
  });

  it('should handle mixed regular and composite clips', () => {
    // Clip 1: Regular, duration 10
    const clip1 = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 0,
      end: 10,
      order: 0,
      TimelineTrackRef: 'track1',
    } as any;

    // Clip 2: Composite (edit list on a plain 'user' clip — type is origin
    // only, presence of the list is what makes it composite), duration 5
    const clip2 = {
      id: 'clip2',
      TimelineRef: 'timeline1',
      MediaRef: 'media2',
      start: 0,
      end: 0,
      order: 1,
      TimelineTrackRef: 'track1',
      expand: {
        MediaClipRef: {
          id: 'mc2',
          type: 'user',
          MediaRef: 'media2',
          start: 0,
          end: 12,
          clipData: {
            segments: [
              { start: 0, end: 3 },
              { start: 10, end: 12 },
            ],
          },
        },
      },
    } as any;

    const tracks = generateTracks(
      [clip1, clip2],
      [{ id: 'track1', layer: 0 } as any]
    );
    const segments = tracks[0].segments;

    expect(segments[0].time.start).toBe(0);
    expect(segments[0].time.duration).toBe(10);

    // Clip 2 should start after Clip 1
    expect(segments[1].time.start).toBe(10);
    expect(segments[1].time.duration).toBe(3);
    expect(segments[2].time.start).toBe(13);
    expect(segments[2].time.duration).toBe(2);
  });

  it('treats a 1-segment MediaClip list as a plain clip (start/end rule)', () => {
    // Writers collapse 1-segment lists (finalizeSegments), so start/end are
    // the source of truth; a stray 1-segment list must not activate the
    // composite path.
    const clip = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 2,
      end: 7,
      order: 0,
      TimelineTrackRef: 'track1',
      expand: {
        MediaClipRef: {
          id: 'mc1',
          type: 'user',
          MediaRef: 'media1',
          start: 2,
          end: 7,
          clipData: {
            segments: [{ start: 2, end: 7 }],
          },
        },
      },
    } as any;

    const tracks = generateTracks([clip], [{ id: 'track1', layer: 0 } as any]);
    const segments = tracks[0].segments;

    expect(segments).toHaveLength(1);
    expect(segments[0].id).toBe('clip1'); // standard path, no `_i` suffix
    expect(segments[0].time.start).toBe(0);
    expect(segments[0].time.duration).toBe(5);
    expect(segments[0].time.sourceStart).toBe(2);
  });

  it('a 1-segment meta.segments override still masks a composite source', () => {
    // The override threshold is deliberately >= 1: this placement cut its
    // source's list down to one run; unsetting it would unmask the source's
    // cuts, so it persists and plays as a single contiguous range.
    const clip = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 5,
      end: 10,
      order: 0,
      TimelineTrackRef: 'track1',
      meta: {
        segments: [{ start: 5, end: 10 }],
      },
      expand: {
        MediaClipRef: {
          id: 'mc1',
          type: 'user',
          MediaRef: 'media1',
          start: 0,
          end: 23,
          clipData: {
            segments: [
              { start: 0, end: 3 },
              { start: 20, end: 23 },
            ],
          },
        },
      },
    } as any;

    const tracks = generateTracks([clip], [{ id: 'track1', layer: 0 } as any]);
    const segments = tracks[0].segments;

    expect(segments).toHaveLength(1);
    expect(segments[0].time.sourceStart).toBe(5);
    expect(segments[0].time.duration).toBe(5);
    expect(segments[0].time.start).toBe(0);
  });

  it('should handle clips on multiple layers', () => {
    const clipLayer0 = {
      id: 'c0',
      order: 0,
      start: 0,
      end: 10,
      TimelineTrackRef: 't0',
    } as any;

    const clipLayer1 = {
      id: 'c1',
      order: 0,
      start: 0,
      end: 5,
      TimelineTrackRef: 't1',
      timelineStart: 2,
    } as any;

    const tracks = generateTracks(
      [clipLayer0, clipLayer1],
      [{ id: 't0', layer: 0 } as any, { id: 't1', layer: 1 } as any]
    );

    expect(tracks).toHaveLength(4); // 2 video + 2 audio

    const t0 = tracks.find((t) => t.id === 't0');
    const t1 = tracks.find((t) => t.id === 't1');

    expect(t0?.segments[0].time.start).toBe(0);
    expect(t1?.segments[0].time.start).toBe(2); // Should respect timelineStart on Layer 1
  });

  it('should use meta.segments when present on TimelineClip (override)', () => {
    // TimelineClip-level meta.segments overrides MediaClip clipData
    const clip = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 0,
      end: 0,
      order: 0,
      TimelineTrackRef: 'track1',
      meta: {
        segments: [
          { start: 0, end: 3 },
          { start: 5, end: 8 },
        ],
      },
    } as any;

    const tracks = generateTracks([clip], [{ id: 'track1', layer: 0 } as any]);
    const segments = tracks[0].segments;

    expect(segments).toHaveLength(2);
    expect(segments[0].time.sourceStart).toBe(0);
    expect(segments[0].time.duration).toBe(3);
    expect(segments[1].time.sourceStart).toBe(5);
    expect(segments[1].time.duration).toBe(3);
    expect(segments[1].time.start).toBe(3);
  });

  it('windows meta.segments by the clip start/end (non-destructive trim)', () => {
    // Full edit list [0,3] + [5,8]; window 1–6 renders [1,3] + [5,6] only
    const clip = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 1,
      end: 6,
      order: 0,
      TimelineTrackRef: 'track1',
      meta: {
        segments: [
          { start: 0, end: 3 },
          { start: 5, end: 8 },
        ],
      },
    } as any;

    const tracks = generateTracks([clip], [{ id: 'track1', layer: 0 } as any]);
    const segments = tracks[0].segments;

    expect(segments).toHaveLength(2);
    expect(segments[0].time.sourceStart).toBe(1);
    expect(segments[0].time.duration).toBe(2);
    expect(segments[0].time.start).toBe(0);
    expect(segments[1].time.sourceStart).toBe(5);
    expect(segments[1].time.duration).toBe(1);
    expect(segments[1].time.start).toBe(2);
  });

  it('windows the MediaClip edit list by the placement window', () => {
    const clip = {
      id: 'c1',
      order: 0,
      TimelineTrackRef: 't0',
      MediaRef: 'm1',
      start: 12,
      end: 15,
      expand: {
        MediaClipRef: {
          type: 'composite',
          MediaRef: 'm1',
          start: 0,
          end: 15,
          clipData: {
            segments: [
              { start: 0, end: 5 },
              { start: 10, end: 15 },
            ],
          },
        },
      },
    } as any;

    const tracks = generateTracks([clip], [{ id: 't0', layer: 0 } as any]);
    const segments = tracks[0].segments;

    expect(segments).toHaveLength(1);
    expect(segments[0].time.sourceStart).toBe(12);
    expect(segments[0].time.duration).toBe(3);
  });

  it('should handle composite with out-of-order segments in clipData', () => {
    // Segments stored in non-chronological order (e.g. from UI editing)
    const clip = {
      id: 'c1',
      order: 0,
      TimelineTrackRef: 't0',
      MediaRef: 'm1',
      start: 0,
      end: 0,
      expand: {
        MediaClipRef: {
          type: 'composite',
          MediaRef: 'm1',
          start: 0,
          end: 0,
          clipData: {
            segments: [
              { start: 10, end: 15 },
              { start: 0, end: 5 },
            ],
          },
        },
      },
    } as any;

    const tracks = generateTracks([clip], [{ id: 't0', layer: 0 } as any]);
    const segments = tracks[0].segments;

    // Should be expanded in chronological order (0-5 first, then 10-15)
    expect(segments).toHaveLength(2);
    expect(segments[0].time.sourceStart).toBe(0);
    expect(segments[0].time.duration).toBe(5);
    expect(segments[0].time.start).toBe(0);
    expect(segments[1].time.sourceStart).toBe(10);
    expect(segments[1].time.duration).toBe(5);
    expect(segments[1].time.start).toBe(5);
  });

  it('should allow gaps if timelineStart is valid (gap)', () => {
    const clip1 = {
      id: 'c1',
      order: 0,
      start: 0,
      end: 10,
      TimelineTrackRef: 't0',
    } as any;

    const clip2 = {
      id: 'c2',
      order: 1,
      start: 0,
      end: 5,
      TimelineTrackRef: 't0',
      timelineStart: 15,
    } as any;

    const tracks = generateTracks(
      [clip1, clip2],
      [{ id: 't0', layer: 0 } as any]
    );
    const segments = tracks[0].segments;

    expect(segments[0].time.duration).toBe(10);

    // Gap from 10 to 15
    expect(segments[1].time.start).toBe(15);
  });

  it('should generate image segment for image media type', () => {
    const clip = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 0,
      end: 5,
      order: 0,
      TimelineTrackRef: 'track1',
      expand: {
        MediaRef: {
          mediaType: 'image',
        },
      },
    } as any;

    const tracks = generateTracks([clip], [{ id: 'track1', layer: 0 } as any]);
    const segments = tracks[0].segments;

    expect(segments[0].type).toBe('image');
    expect(segments[0].time.duration).toBe(5);
  });

  it('should apply per-clip gain (meta.gain) to the generated audio segment', () => {
    const clip = {
      id: 'clip1',
      TimelineRef: 'timeline1',
      MediaRef: 'media1',
      start: 0,
      end: 5,
      order: 0,
      TimelineTrackRef: 'track1',
      meta: { gain: 0.5 },
    } as any;

    const tracks = generateTracks(
      [clip],
      [{ id: 'track1', layer: 0, volume: 1, isMuted: false } as any]
    );

    const audioTrack = tracks.find((t) => t.type === 'audio');
    expect(audioTrack).toBeDefined();
    expect(audioTrack!.segments[0].audio?.volume).toBe(0.5);
  });

  it('should default audio volume to track volume when no clip gain set', () => {
    const clip = {
      id: 'clip1',
      MediaRef: 'media1',
      start: 0,
      end: 5,
      order: 0,
      TimelineTrackRef: 'track1',
    } as any;

    const tracks = generateTracks(
      [clip],
      [{ id: 'track1', layer: 0, volume: 1, isMuted: false } as any]
    );

    const audioTrack = tracks.find((t) => t.type === 'audio');
    expect(audioTrack!.segments[0].audio?.volume).toBe(1);
  });

  it('should multiply per-clip gain with track volume', () => {
    const clip = {
      id: 'clip1',
      MediaRef: 'media1',
      start: 0,
      end: 5,
      order: 0,
      TimelineTrackRef: 'track1',
      meta: { gain: 0.5 },
    } as any;

    const tracks = generateTracks(
      [clip],
      [{ id: 'track1', layer: 0, volume: 0.5, isMuted: false } as any]
    );

    const audioTrack = tracks.find((t) => t.type === 'audio');
    expect(audioTrack!.segments[0].audio?.volume).toBe(0.25);
  });

  it('should apply per-clip gain on a composite (mediaClip) clip', () => {
    // Regression: the mediaClip-composite branch previously dropped clip gain.
    const clip = {
      id: 'clip1',
      MediaRef: 'media1',
      start: 0,
      end: 0,
      order: 0,
      TimelineTrackRef: 'track1',
      meta: { gain: 0.5 },
      expand: {
        MediaClipRef: {
          type: 'composite',
          MediaRef: 'media1',
          start: 0,
          end: 0,
          clipData: { segments: [{ start: 0, end: 5 }] },
        },
      },
    } as any;

    const tracks = generateTracks(
      [clip],
      [{ id: 'track1', layer: 0, volume: 1, isMuted: false } as any]
    );

    const audioTrack = tracks.find((t) => t.type === 'audio');
    expect(audioTrack!.segments[0].audio?.volume).toBe(0.5);
  });
});

describe('generateTracks legacy fallback (clips without a track)', () => {
  it('generates default video + audio tracks for orphan clips', () => {
    const clip = {
      id: 'clip1',
      MediaRef: 'media1',
      start: 0,
      end: 5,
      order: 0,
    } as any;

    const tracks = generateTracks([clip]); // no track entities

    const videoTrack = tracks.find((t) => t.id === 'default-video-track');
    const audioTrack = tracks.find((t) => t.id === 'default-audio-track');
    expect(videoTrack).toBeDefined();
    expect(audioTrack).toBeDefined();
    expect(videoTrack!.segments).toHaveLength(1);
    expect(audioTrack!.segments).toHaveLength(1);
    expect(audioTrack!.segments[0].id).toBe('clip1-audio');
    expect(audioTrack!.segments[0].assetId).toBe('media1');
  });

  it('applies per-clip gain to the legacy default audio track', () => {
    // Regression: this branch previously hardcoded volume 1.0, dropping gain.
    const clip = {
      id: 'clip1',
      MediaRef: 'media1',
      start: 0,
      end: 5,
      order: 0,
      meta: { gain: 0.25 },
    } as any;

    const tracks = generateTracks([clip]);

    const audioTrack = tracks.find((t) => t.id === 'default-audio-track');
    expect(audioTrack!.segments[0].audio?.volume).toBe(0.25);
  });

  it('places orphan clips on a high layer when layer 0 is already defined', () => {
    const trackedClip = {
      id: 'tracked',
      MediaRef: 'media1',
      start: 0,
      end: 5,
      order: 0,
      TimelineTrackRef: 'track1',
    } as any;
    const orphanClip = {
      id: 'orphan',
      MediaRef: 'media2',
      start: 0,
      end: 5,
      order: 0,
    } as any;

    const tracks = generateTracks(
      [trackedClip, orphanClip],
      [{ id: 'track1', layer: 0, volume: 1, isMuted: false } as any]
    );

    const orphanTrack = tracks.find((t) => t.id === 'orphan-clips-track');
    expect(orphanTrack).toBeDefined();
    expect(orphanTrack!.layer).toBe(999);
    expect(orphanTrack!.segments[0].id).toBe('orphan');
    // Orphan fallback is diagnostic only — no audio track is synthesized for it.
    expect(
      tracks.find((t) => t.id === 'orphan-clips-track-audio')
    ).toBeUndefined();
  });

  it('skips orphan clips without a media asset in the legacy audio track', () => {
    const clip = {
      id: 'clip1',
      start: 0,
      end: 5,
      order: 0,
    } as any; // no MediaRef

    const tracks = generateTracks([clip]);

    const audioTrack = tracks.find((t) => t.id === 'default-audio-track');
    expect(audioTrack!.segments).toHaveLength(0);
  });
});
