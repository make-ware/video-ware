import { describe, it, expect } from 'vitest';
import { generateTracks } from '../edit-list';
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

    // Clip 2: Composite, 1 segment, duration 5s
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
              { start: 0, end: 5 }, // 5s
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
    expect(segments).toHaveLength(3); // 2 from clip1 + 1 from clip2

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
    expect(segments[2].time.duration).toBe(5);
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

    // Clip 2: Composite, duration 5
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
          type: 'composite',
          MediaRef: 'media2',
          start: 0,
          end: 0,
          clipData: {
            segments: [{ start: 0, end: 5 }],
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
    expect(segments[1].time.duration).toBe(5);
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

    const tracks = generateTracks(
      [clip],
      [{ id: 'track1', layer: 0 } as any]
    );
    const segments = tracks[0].segments;

    expect(segments).toHaveLength(2);
    expect(segments[0].time.sourceStart).toBe(0);
    expect(segments[0].time.duration).toBe(3);
    expect(segments[1].time.sourceStart).toBe(5);
    expect(segments[1].time.duration).toBe(3);
    expect(segments[1].time.start).toBe(3);
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
});
