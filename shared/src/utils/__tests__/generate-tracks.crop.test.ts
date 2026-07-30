import { describe, it, expect } from 'vitest';
import { generateTracks } from '../generate-tracks';
import type { TimelineClip } from '../../schema/timeline-clip';
import type { Media } from '../../schema/media';
import type { TimelineTrackRecord } from '../../schema';
import type { NestedTimelineMap } from '../nested-timeline';
import type { CropRect } from '../../types/crop';

// Crop resolution through the flattener: media default vs clip override,
// composite expansion, and nested-timeline projection. Time math is covered
// by generate-tracks.test.ts — these fixtures keep timing trivial.

const mediaCrop: CropRect = { left: 0, top: 0.12, width: 1, height: 0.76 };
const clipCrop: CropRect = { left: 0.3, top: 0, width: 0.4, height: 1 };

const makeMedia = (crop?: CropRect): Media =>
  ({
    id: 'media1',
    mediaType: 'video',
    width: 1920,
    height: 1080,
    ...(crop ? { crop } : {}),
  }) as unknown as Media;

const makeTrack = (
  id = 'track1',
  timelineRef = 'timeline1'
): TimelineTrackRecord =>
  ({
    id,
    layer: 0,
    TimelineRef: timelineRef,
    opacity: 1,
    isMuted: false,
    volume: 1,
    isLocked: false,
  }) as unknown as TimelineTrackRecord;

const makeClip = (
  overrides: Record<string, unknown>,
  media?: Media
): TimelineClip =>
  ({
    id: 'clip1',
    TimelineRef: 'timeline1',
    MediaRef: media ? media.id : 'media1',
    TimelineTrackRef: 'track1',
    start: 0,
    end: 10,
    order: 0,
    ...(media ? { expand: { MediaRef: media } } : {}),
    ...overrides,
  }) as unknown as TimelineClip;

const videoSegments = (tracks: ReturnType<typeof generateTracks>) =>
  tracks.find((t) => t.type === 'video')!.segments;

describe('generateTracks crop resolution', () => {
  it('carries the media default crop onto standard segments', () => {
    const tracks = generateTracks(
      [makeClip({}, makeMedia(mediaCrop))],
      [makeTrack()]
    );
    const [seg] = videoSegments(tracks);
    expect(seg.video?.crop).toEqual(mediaCrop);
    expect(seg.video?.opacity).toBe(1);
  });

  it('lets a clip meta.crop override the media default', () => {
    const tracks = generateTracks(
      [makeClip({ meta: { crop: clipCrop } }, makeMedia(mediaCrop))],
      [makeTrack()]
    );
    expect(videoSegments(tracks)[0].video?.crop).toEqual(clipCrop);
  });

  it('emits no crop without media expand or clip meta', () => {
    const tracks = generateTracks([makeClip({})], [makeTrack()]);
    expect(videoSegments(tracks)[0].video?.crop).toBeUndefined();
  });

  it('applies one shared rect to every expanded composite segment, none to audio', () => {
    const tracks = generateTracks(
      [
        makeClip(
          {
            meta: {
              crop: clipCrop,
              segments: [
                { start: 0, end: 5 },
                { start: 10, end: 15 },
              ],
            },
            end: 15,
          },
          makeMedia(mediaCrop)
        ),
      ],
      [makeTrack()]
    );
    const segs = videoSegments(tracks);
    expect(segs).toHaveLength(2);
    for (const seg of segs) {
      expect(seg.video?.crop).toEqual(clipCrop);
    }
    const audioTrack = tracks.find((t) => t.type === 'audio')!;
    for (const seg of audioTrack.segments) {
      expect(seg.video).toBeUndefined();
    }
  });

  it('projects child clip crops through nested timelines and ignores the parent crop', () => {
    const childMedia = makeMedia(undefined);
    const nestedTimelines: NestedTimelineMap = {
      child1: {
        clips: [
          makeClip(
            {
              id: 'childClip',
              TimelineRef: 'child1',
              TimelineTrackRef: 'childTrack',
              meta: { crop: clipCrop },
            },
            childMedia
          ),
        ],
        tracks: [makeTrack('childTrack', 'child1')],
      },
    };
    const parentClip = makeClip({
      id: 'parentClip',
      MediaRef: undefined,
      SourceTimelineRef: 'child1',
      // A crop on the nested-timeline clip itself is ignored in v1.
      meta: { crop: mediaCrop },
    });

    const tracks = generateTracks([parentClip], [makeTrack()], {
      nestedTimelines,
      rootTimelineId: 'timeline1',
    });

    const projected = tracks.filter(
      (t) => t.type === 'video' && t.segments.length > 0
    );
    expect(projected).toHaveLength(1);
    expect(projected[0].id).toContain('parentClip');
    const [seg] = projected[0].segments;
    // The child's own crop survives projection; the parent's rect (which
    // would be mediaCrop) never appears.
    expect(seg.video?.crop).toEqual(clipCrop);
  });
});
