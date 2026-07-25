import { describe, expect, it, vi } from 'vitest';
import type { MediaClip, TimelineClip } from '@project/shared';
import {
  compositeMarker,
  mediaClipTimes,
  timelineClipTimes,
  timelineEditListOf,
} from '../lib/clip-times.js';
import { mapClipTime } from '../lib/timeline-inspect.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const tlClip = (over: Record<string, unknown>): TimelineClip =>
  ({
    id: 'tc1',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    order: 0,
    start: 0,
    end: 1,
    duration: 1,
    ...over,
  }) as unknown as TimelineClip;

const mClip = (over: Record<string, unknown>): MediaClip =>
  ({
    id: 'mc1',
    WorkspaceRef: 'ws1',
    MediaRef: 'm1',
    type: 'user',
    start: 0,
    end: 30,
    duration: 30,
    ...over,
  }) as unknown as MediaClip;

describe('timelineClipTimes', () => {
  it('reports a plain media clip as a 1-segment trim window', () => {
    const times = timelineClipTimes(tlClip({ start: 2, end: 9, duration: 7 }));
    expect(times).toEqual({
      source: { start: 2, end: 9, span: 7 },
      effective: { duration: 7 },
      segments: { count: 1, source: 'trim' },
      composite: false,
    });
  });

  it('adds the timeline domain when placement is known', () => {
    const times = timelineClipTimes(tlClip({ start: 2, end: 9, duration: 7 }), {
      timelineStart: 10,
      timelineEnd: 17,
    });
    expect(times.timeline).toEqual({ start: 10, end: 17, duration: 7 });
  });

  it('reports composite meta.segments with effective vs span', () => {
    const times = timelineClipTimes(
      tlClip({
        start: 0,
        end: 23,
        duration: 5,
        meta: {
          segments: [
            { start: 10, end: 12 },
            { start: 20, end: 23 },
          ],
        },
      })
    );
    expect(times).toEqual({
      source: { start: 0, end: 23, span: 23 },
      effective: { duration: 5 },
      segments: { count: 2, source: 'meta' },
      composite: true,
    });
  });

  it('resolves the expanded MediaClip edit list', () => {
    const clip = tlClip({
      start: 0,
      end: 30,
      duration: 20,
      MediaClipRef: 'mc1',
    });
    (clip as TimelineClip & { expand?: unknown }).expand = {
      MediaClipRef: {
        id: 'mc1',
        clipData: {
          segments: [
            { start: 0, end: 10 },
            { start: 20, end: 30 },
          ],
        },
      },
    };
    const times = timelineClipTimes(clip);
    expect(times.segments).toEqual({ count: 2, source: 'mediaClip' });
    expect(times.composite).toBe(true);
    expect(times.effective.duration).toBe(20);
  });

  it('reports a 1-segment meta mask as non-composite', () => {
    const clip = tlClip({
      start: 0,
      end: 30,
      duration: 5,
      MediaClipRef: 'mc1',
      meta: { segments: [{ start: 3, end: 8 }] },
    });
    (clip as TimelineClip & { expand?: unknown }).expand = {
      MediaClipRef: {
        id: 'mc1',
        clipData: {
          segments: [
            { start: 0, end: 10 },
            { start: 20, end: 30 },
          ],
        },
      },
    };
    const times = timelineClipTimes(clip);
    expect(times.segments).toEqual({ count: 1, source: 'meta' });
    expect(times.composite).toBe(false);
    expect(times.effective.duration).toBe(5);
  });

  it('omits the segments block for caption and nested clips', () => {
    const caption = timelineClipTimes(
      tlClip({ MediaRef: undefined, CaptionRef: 'cap1', start: 0, end: 4 })
    );
    expect(caption.segments).toBeUndefined();
    expect(caption.composite).toBe(false);
    expect(caption.effective.duration).toBe(4);

    const nested = timelineClipTimes(
      tlClip({
        MediaRef: undefined,
        SourceTimelineRef: 'child',
        start: 5,
        end: 15,
        // Stale data — nested windows are timeline-linear.
        meta: { segments: [{ start: 0, end: 2 }] },
      })
    );
    expect(nested.segments).toBeUndefined();
    expect(nested.composite).toBe(false);
    expect(nested.effective.duration).toBe(10);
  });
});

describe('mediaClipTimes', () => {
  it('reports plain clips as a trim window', () => {
    expect(mediaClipTimes(mClip({}))).toEqual({
      source: { start: 0, end: 30, span: 30 },
      effective: { duration: 30 },
      segments: { count: 1, source: 'trim' },
      composite: false,
    });
  });

  it('reports composite clipData with effective vs span', () => {
    const times = mediaClipTimes(
      mClip({
        duration: 20,
        clipData: {
          segments: [
            { start: 0, end: 10 },
            { start: 20, end: 30 },
          ],
        },
      })
    );
    expect(times).toEqual({
      source: { start: 0, end: 30, span: 30 },
      effective: { duration: 20 },
      segments: { count: 2, source: 'clipData' },
      composite: true,
    });
  });
});

describe('timelineEditListOf / compositeMarker', () => {
  it('falls back to the trim window when nothing is expanded', () => {
    const clip = tlClip({ start: 2, end: 9, MediaClipRef: 'mc1' });
    expect(timelineEditListOf(clip)).toEqual({
      segments: [{ start: 2, end: 9 }],
      source: 'trim',
    });
  });

  it('marks composites and nothing else', () => {
    const composite = timelineClipTimes(
      tlClip({
        start: 0,
        end: 23,
        meta: {
          segments: [
            { start: 10, end: 12 },
            { start: 20, end: 23 },
          ],
        },
      })
    );
    expect(compositeMarker(composite)).toBe(' ◆2');
    expect(compositeMarker(timelineClipTimes(tlClip({})))).toBe('');
  });
});

describe('mapClipTime', () => {
  // Composite: segments [10,12] + [20,23] (effective 5s), placed at 10–15.
  const composite = {
    id: 'comp',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    order: 0,
    start: 0,
    end: 23,
    duration: 5,
    timelineStart: 10,
    meta: {
      segments: [
        { start: 10, end: 12 },
        { start: 20, end: 23 },
      ],
    },
  };
  const plain = {
    id: 'plain',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    order: 1,
    start: 2,
    end: 9,
    duration: 7,
    timelineStart: 30,
  };

  function mapStubs(clips: Record<string, unknown>[]): Record<string, Stub> {
    return {
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          duration: 60,
          mediaType: 'video',
        })),
      },
      MediaClips: {
        getOne: vi.fn(async () => {
          throw notFound();
        }),
      },
      TimelineTracks: {
        getList: vi.fn(async () =>
          listResult([
            { id: 'trk0', layer: 0, name: 'Main', TimelineRef: 'tl1' },
          ])
        ),
      },
      TimelineClips: {
        getList: vi.fn(async () => listResult(clips)),
        getOne: vi.fn(async (id: string) => {
          const clip = clips.find((c) => c.id === id);
          if (!clip) throw notFound();
          return clip;
        }),
      },
    };
  }

  it('maps a timeline time through the edit list', async () => {
    const pb = fakePb(mapStubs([composite]));
    const result = await mapClipTime(pb, 'comp', {
      domain: 'timeline',
      value: 13,
    });
    expect(result.point).toEqual({
      timeline: 13,
      offset: 3,
      source: 21,
      segment: { index: 1, start: 20, end: 23 },
    });
    expect(result.inGap).toBe(false);
    expect(result.clamped).toBe(false);
    expect(result.composite).toBe(true);
    expect(result.layer).toBe(0);
  });

  it('maps an offset and round-trips with a source time', async () => {
    const pb = fakePb(mapStubs([composite]));
    const viaOffset = await mapClipTime(pb, 'comp', {
      domain: 'offset',
      value: 4,
    });
    expect(viaOffset.point.source).toBe(22);
    expect(viaOffset.point.timeline).toBe(14);

    const viaSource = await mapClipTime(pb, 'comp', {
      domain: 'source',
      value: 22,
    });
    expect(viaSource.point.offset).toBe(4);
    expect(viaSource.point.timeline).toBe(14);
    expect(viaSource.clamped).toBe(false);
  });

  it('reports cut-gap source times and collapses to the boundary', async () => {
    const pb = fakePb(mapStubs([composite]));
    const result = await mapClipTime(pb, 'comp', {
      domain: 'source',
      value: 15,
    });
    expect(result.inGap).toBe(true);
    expect(result.gap).toEqual({ start: 12, end: 20 });
    expect(result.point.offset).toBe(2);
    expect(result.point.timeline).toBe(12);
    expect(result.point.source).toBe(12);
    expect(result.clamped).toBe(false);
  });

  it('clamps inputs outside the played content', async () => {
    const pb = fakePb(mapStubs([composite]));

    // Source time before the first segment (window-trimmed, not a gap).
    const before = await mapClipTime(pb, 'comp', {
      domain: 'source',
      value: 5,
    });
    expect(before.inGap).toBe(false);
    expect(before.clamped).toBe(true);
    expect(before.point.offset).toBe(0);
    expect(before.point.source).toBe(10);

    // Offset past the effective end.
    const past = await mapClipTime(pb, 'comp', {
      domain: 'offset',
      value: 99,
    });
    expect(past.clamped).toBe(true);
    expect(past.point.offset).toBe(5);
    expect(past.point.timeline).toBe(15);
  });

  it('maps plain clips linearly with segment: null', async () => {
    const pb = fakePb(mapStubs([plain]));
    const result = await mapClipTime(pb, 'plain', {
      domain: 'source',
      value: 5,
    });
    expect(result.point).toEqual({
      timeline: 33,
      offset: 3,
      source: 5,
      segment: null,
    });
    expect(result.composite).toBe(false);
  });

  it('rejects caption/nested clips and validates -t', async () => {
    const caption = {
      id: 'cap',
      TimelineRef: 'tl1',
      CaptionRef: 'c1',
      order: 0,
      start: 0,
      end: 4,
    };
    const pb = fakePb(mapStubs([caption]));
    await expect(
      mapClipTime(pb, 'cap', { domain: 'offset', value: 1 })
    ).rejects.toThrow(/no source media/i);

    const pb2 = fakePb(mapStubs([composite]));
    await expect(
      mapClipTime(pb2, 'comp', {
        domain: 'offset',
        value: 1,
        timelineId: 'other',
      })
    ).rejects.toThrow(/belongs to timeline tl1/i);
  });
});
