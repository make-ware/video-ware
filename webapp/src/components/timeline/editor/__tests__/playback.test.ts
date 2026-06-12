import { describe, it, expect } from 'vitest';
import type { TimelineClip, TimelineTrackRecord } from '@project/shared';
import {
  buildPlaybackTracks,
  computeTimelineDuration,
  findActiveClip,
} from '../playback';

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
