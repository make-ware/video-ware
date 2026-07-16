import { describe, expect, it, vi } from 'vitest';
import {
  editMediaClipSegments,
  editTimelineClipSegments,
  inspectMediaClipSegments,
  inspectTimelineClipSegments,
} from '../lib/clip-segments.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

interface SegStubOptions {
  media?: Record<string, unknown>;
  mediaClips?: Record<string, unknown>[];
  tracks?: Record<string, unknown>[];
  timelineClips?: Record<string, unknown>[];
  timeline?: Record<string, unknown>;
}

/** In-memory Media/MediaClips/TimelineTracks/TimelineClips/Timelines stubs. */
function segStubs(opts: SegStubOptions = {}): Record<string, Stub> {
  const {
    media = { id: 'm1', duration: 60, mediaType: 'video' },
    mediaClips = [],
    tracks = [{ id: 'trk0', layer: 0, name: 'Main', TimelineRef: 'tl1' }],
    timelineClips = [],
    timeline = { id: 'tl1', WorkspaceRef: 'ws1', duration: 0, version: 1 },
  } = opts;
  return {
    Media: { getOne: vi.fn(async () => media) },
    MediaClips: {
      getOne: vi.fn(async (id: string) => {
        const clip = mediaClips.find((c) => c.id === id);
        if (!clip) throw notFound();
        return clip;
      }),
      update: vi.fn(async (id: string, data: object) => ({
        ...mediaClips.find((c) => c.id === id),
        ...data,
      })),
    },
    TimelineTracks: {
      getList: vi.fn(async () => listResult(tracks)),
      create: vi.fn(async (data) => ({ ...data, id: 'newtrack' })),
    },
    TimelineClips: {
      getList: vi.fn(async () => listResult(timelineClips)),
      getOne: vi.fn(async (id: string) => {
        const clip = timelineClips.find((c) => c.id === id);
        if (!clip) throw notFound();
        return clip;
      }),
      update: vi.fn(async (id: string, data: object) => ({
        ...timelineClips.find((c) => c.id === id),
        ...data,
      })),
    },
    Timelines: {
      getOne: vi.fn(async () => timeline),
      update: vi.fn(async (id: string, data: object) => ({
        ...timeline,
        ...data,
      })),
    },
  };
}

const userClip = {
  id: 'mc1',
  MediaRef: 'm1',
  WorkspaceRef: 'ws1',
  type: 'user',
  start: 0,
  end: 30,
  duration: 30,
};

const compositeClip = {
  id: 'mc2',
  MediaRef: 'm1',
  WorkspaceRef: 'ws1',
  type: 'composite',
  start: 0,
  end: 30,
  duration: 20,
  clipData: {
    gapThreshold: 2,
    segments: [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ],
  },
};

describe('editMediaClipSegments', () => {
  it('auto-converts a plain clip on its first cut', async () => {
    const stubs = segStubs({ mediaClips: [{ ...userClip }] });
    const pb = fakePb(stubs);

    const result = await editMediaClipSegments(pb, 'mc1', {
      kind: 'cut',
      from: 10,
      to: 12,
    });

    expect(result.converted).toBe(true);
    expect(stubs.MediaClips.update).toHaveBeenCalledOnce();
    const [id, patch] = stubs.MediaClips.update.mock.calls[0];
    expect(id).toBe('mc1');
    expect(patch).toEqual({
      type: 'composite',
      start: 0,
      end: 30,
      duration: 28,
      clipData: {
        segments: [
          { start: 0, end: 10 },
          { start: 12, end: 30 },
        ],
      },
    });
  });

  it('preserves unrelated clipData keys and does not re-set type on composites', async () => {
    const stubs = segStubs({ mediaClips: [{ ...compositeClip }] });
    const pb = fakePb(stubs);

    const result = await editMediaClipSegments(pb, 'mc2', {
      kind: 'cut',
      from: 5,
      to: 8,
    });

    expect(result.converted).toBe(false);
    const [, patch] = stubs.MediaClips.update.mock.calls[0];
    expect(patch).not.toHaveProperty('type');
    expect(patch.clipData.gapThreshold).toBe(2);
    expect(patch.clipData.segments).toEqual([
      { start: 0, end: 5 },
      { start: 8, end: 10 },
      { start: 20, end: 30 },
    ]);
    expect(patch.duration).toBe(17);
  });

  it('splits without changing the effective duration', async () => {
    const stubs = segStubs({ mediaClips: [{ ...compositeClip }] });
    const pb = fakePb(stubs);

    await editMediaClipSegments(pb, 'mc2', { kind: 'split', at: [5] });

    const [, patch] = stubs.MediaClips.update.mock.calls[0];
    expect(patch.clipData.segments).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
      { start: 20, end: 30 },
    ]);
    expect(patch.duration).toBe(20);
  });

  it('rejects a split point in a gap and writes nothing', async () => {
    const stubs = segStubs({ mediaClips: [{ ...compositeClip }] });
    const pb = fakePb(stubs);

    await expect(
      editMediaClipSegments(pb, 'mc2', { kind: 'split', at: [15] })
    ).rejects.toThrow(/not inside any segment/i);
    expect(stubs.MediaClips.update).not.toHaveBeenCalled();
  });

  it('rejects a cut that removes everything and writes nothing', async () => {
    const stubs = segStubs({ mediaClips: [{ ...userClip }] });
    const pb = fakePb(stubs);

    await expect(
      editMediaClipSegments(pb, 'mc1', { kind: 'cut', from: 0, to: 30 })
    ).rejects.toThrow(/remove all remaining content/i);
    expect(stubs.MediaClips.update).not.toHaveBeenCalled();
  });

  it('dry-run reports the result without writing', async () => {
    const stubs = segStubs({ mediaClips: [{ ...userClip }] });
    const pb = fakePb(stubs);

    const result = await editMediaClipSegments(
      pb,
      'mc1',
      { kind: 'cut', from: 10, to: 12 },
      { dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.clip).toBeNull();
    expect(result.after).toEqual([
      { start: 0, end: 10 },
      { start: 12, end: 30 },
    ]);
    expect(stubs.MediaClips.update).not.toHaveBeenCalled();
  });

  it('rejects a trim past the media duration', async () => {
    const stubs = segStubs({
      mediaClips: [{ ...userClip }],
      media: { id: 'm1', duration: 30, mediaType: 'video' },
    });
    const pb = fakePb(stubs);

    await expect(
      editMediaClipSegments(pb, 'mc1', { kind: 'trim', end: 40 })
    ).rejects.toThrow(/exceeds the media duration/i);
    expect(stubs.MediaClips.update).not.toHaveBeenCalled();
  });

  it('requires --segment when trimming a multi-segment clip', async () => {
    const stubs = segStubs({ mediaClips: [{ ...compositeClip }] });
    const pb = fakePb(stubs);

    await expect(
      editMediaClipSegments(pb, 'mc2', { kind: 'trim', end: 9 })
    ).rejects.toThrow(/pass --segment/i);
  });

  it('allows extending past the duration of image media (duration 0)', async () => {
    const stubs = segStubs({
      mediaClips: [{ ...userClip, end: 5, duration: 5 }],
      media: { id: 'm1', duration: 0, mediaType: 'image' },
    });
    const pb = fakePb(stubs);

    await editMediaClipSegments(pb, 'mc1', { kind: 'trim', end: 500 });

    const [, patch] = stubs.MediaClips.update.mock.calls[0];
    expect(patch.end).toBe(500);
    expect(patch.duration).toBe(500);
  });

  it('clamps a slip and reports requested vs applied', async () => {
    const stubs = segStubs({
      mediaClips: [
        {
          ...compositeClip,
          clipData: { segments: [{ start: 2, end: 5 }] },
          start: 2,
          end: 5,
          duration: 3,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await editMediaClipSegments(pb, 'mc2', {
      kind: 'slip',
      by: -3.5,
    });

    expect(result.requestedBy).toBe(-3.5);
    expect(result.appliedBy).toBe(-2);
    const [, patch] = stubs.MediaClips.update.mock.calls[0];
    expect(patch.clipData.segments).toEqual([{ start: 0, end: 3 }]);
    expect(patch.start).toBe(0);
    expect(patch.end).toBe(3);
  });

  it('writes nothing when a slip is fully clamped', async () => {
    const stubs = segStubs({
      mediaClips: [
        {
          ...compositeClip,
          clipData: { segments: [{ start: 0, end: 5 }] },
          start: 0,
          end: 5,
          duration: 5,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await editMediaClipSegments(pb, 'mc2', {
      kind: 'slip',
      by: -2,
    });

    expect(result.appliedBy).toBe(0);
    expect(result.clip).toBeNull();
    expect(stubs.MediaClips.update).not.toHaveBeenCalled();
  });
});

/** A media-backed timeline clip pinned at a timeline position. */
const baseTimelineClip = {
  id: 'tc1',
  TimelineRef: 'tl1',
  TimelineTrackRef: 'trk0',
  MediaRef: 'm1',
  order: 0,
  start: 0,
  end: 30,
  duration: 30,
  timelineStart: 0,
};

describe('editTimelineClipSegments', () => {
  it('initializes the edit list from the clip trim window (copy-on-write)', async () => {
    const stubs = segStubs({ timelineClips: [{ ...baseTimelineClip }] });
    const pb = fakePb(stubs);

    const result = await editTimelineClipSegments(pb, 'tc1', {
      kind: 'cut',
      from: 10,
      to: 12,
    });

    expect(result.segmentsSource).toBe('trim');
    expect(result.effectiveDelta).toBe(-2);
    const clipPatch = stubs.TimelineClips.update.mock.calls.find(
      ([id]: [string]) => id === 'tc1'
    )![1];
    expect(clipPatch).toEqual({
      start: 0,
      end: 30,
      duration: 28,
      meta: {
        segments: [
          { start: 0, end: 10 },
          { start: 12, end: 30 },
        ],
      },
    });
    // duration changed → timeline re-synced
    expect(stubs.Timelines.getOne).toHaveBeenCalled();
  });

  it('copies the edit list from the expanded composite MediaClip', async () => {
    const clip = {
      ...baseTimelineClip,
      MediaClipRef: 'mc2',
      meta: { gain: 0.5, title: 'Keep me' },
      expand: { MediaClipRef: compositeClip },
    };
    const stubs = segStubs({ timelineClips: [clip] });
    const pb = fakePb(stubs);

    const result = await editTimelineClipSegments(pb, 'tc1', {
      kind: 'cut',
      from: 22,
      to: 24,
    });

    expect(result.segmentsSource).toBe('mediaClip');
    // expand was used — no MediaClips fetch needed
    expect(stubs.MediaClips.getOne).not.toHaveBeenCalled();
    const clipPatch = stubs.TimelineClips.update.mock.calls[0][1];
    expect(clipPatch.meta).toEqual({
      gain: 0.5,
      title: 'Keep me',
      segments: [
        { start: 0, end: 10 },
        { start: 20, end: 22 },
        { start: 24, end: 30 },
      ],
    });
    expect(clipPatch.duration).toBe(18);
  });

  it('falls back to fetching the MediaClip when expand is absent', async () => {
    const clip = { ...baseTimelineClip, MediaClipRef: 'mc2' };
    const stubs = segStubs({
      timelineClips: [clip],
      mediaClips: [{ ...compositeClip }],
    });
    const pb = fakePb(stubs);

    const result = await editTimelineClipSegments(pb, 'tc1', {
      kind: 'split',
      at: [5],
    });

    expect(result.segmentsSource).toBe('mediaClip');
    expect(stubs.MediaClips.getOne).toHaveBeenCalledWith(
      'mc2',
      expect.anything()
    );
  });

  it('prefers existing meta.segments over the MediaClip edit list', async () => {
    const clip = {
      ...baseTimelineClip,
      MediaClipRef: 'mc2',
      meta: { segments: [{ start: 0, end: 8 }] },
      expand: { MediaClipRef: compositeClip },
    };
    const stubs = segStubs({ timelineClips: [clip] });
    const pb = fakePb(stubs);

    const result = await editTimelineClipSegments(pb, 'tc1', {
      kind: 'split',
      at: [4],
    });

    expect(result.segmentsSource).toBe('meta');
    expect(result.after).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
    ]);
  });

  it('ripples only downstream clips with explicit timelineStart writes', async () => {
    const tc1 = { ...baseTimelineClip, end: 42, duration: 42 };
    const tc2 = {
      id: 'tc2',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk0',
      MediaRef: 'm1',
      order: 1,
      start: 0,
      end: 10,
      duration: 10,
      timelineStart: 42,
    };
    const before = {
      id: 'tc0',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk0',
      MediaRef: 'm1',
      order: 2,
      start: 0,
      end: 1,
      duration: 1,
      timelineStart: 0,
    };
    // tc0 overlaps the anchor's lane start but sits before its end — it must
    // never be shifted.
    const stubs = segStubs({
      timelineClips: [tc1, tc2, before],
      media: { id: 'm1', duration: 60, mediaType: 'video' },
    });
    const pb = fakePb(stubs);

    const result = await editTimelineClipSegments(
      pb,
      'tc1',
      { kind: 'cut', from: 14.3, to: 15.5 },
      { ripple: true }
    );

    expect(result.effectiveDelta).toBe(-1.2);
    expect(result.rippled).toEqual([{ clipId: 'tc2', from: 42, to: 40.8 }]);
    const updates = stubs.TimelineClips.update.mock.calls;
    const tc2Update = updates.find(([id]: [string]) => id === 'tc2');
    expect(tc2Update![1]).toEqual({ timelineStart: 40.8 });
    expect(updates.find(([id]: [string]) => id === 'tc0')).toBeUndefined();
  });

  it('leaves downstream clips alone without --ripple', async () => {
    const tc1 = { ...baseTimelineClip, end: 42, duration: 42 };
    const tc2 = { ...baseTimelineClip, id: 'tc2', order: 1, timelineStart: 42 };
    const stubs = segStubs({ timelineClips: [tc1, tc2] });
    const pb = fakePb(stubs);

    await editTimelineClipSegments(pb, 'tc1', {
      kind: 'cut',
      from: 14.3,
      to: 15.5,
    });

    const updatedIds = stubs.TimelineClips.update.mock.calls.map(
      ([id]: [string]) => id
    );
    expect(updatedIds).toEqual(['tc1']);
  });

  it('dry-run with --ripple plans shifts but writes nothing', async () => {
    const tc1 = { ...baseTimelineClip, end: 42, duration: 42 };
    const tc2 = { ...baseTimelineClip, id: 'tc2', order: 1, timelineStart: 42 };
    const stubs = segStubs({ timelineClips: [tc1, tc2] });
    const pb = fakePb(stubs);

    const result = await editTimelineClipSegments(
      pb,
      'tc1',
      { kind: 'cut', from: 14.3, to: 15.5 },
      { ripple: true, dryRun: true }
    );

    expect(result.rippled).toEqual([{ clipId: 'tc2', from: 42, to: 40.8 }]);
    expect(result.clip).toBeNull();
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
    expect(stubs.Timelines.update).not.toHaveBeenCalled();
  });

  it('rejects caption clips (no source media)', async () => {
    const caption = {
      id: 'tcap',
      TimelineRef: 'tl1',
      CaptionRef: 'cap1',
      order: 0,
      start: 0,
      end: 5,
      duration: 5,
    };
    const pb = fakePb(segStubs({ timelineClips: [caption] }));

    await expect(
      editTimelineClipSegments(pb, 'tcap', { kind: 'cut', from: 1, to: 2 })
    ).rejects.toThrow(/no source media/i);
  });

  it('rejects a -t mismatch', async () => {
    const pb = fakePb(segStubs({ timelineClips: [{ ...baseTimelineClip }] }));

    await expect(
      editTimelineClipSegments(
        pb,
        'tc1',
        { kind: 'cut', from: 1, to: 2 },
        { timelineId: 'tl2' }
      )
    ).rejects.toThrow(/belongs to timeline tl1/i);
  });
});

describe('inspectMediaClipSegments', () => {
  it('reports segments, gaps, and the clipData source for composites', async () => {
    const pb = fakePb(segStubs({ mediaClips: [{ ...compositeClip }] }));

    const inspection = await inspectMediaClipSegments(pb, 'mc2');

    expect(inspection.source).toBe('clipData');
    expect(inspection.segments).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
    expect(inspection.gaps).toEqual([{ afterIndex: 0, seconds: 10 }]);
    expect(inspection.times).toEqual({ start: 0, end: 30, duration: 20 });
    expect(inspection.mediaDuration).toBe(60);
  });

  it('reports the trim window for plain clips', async () => {
    const pb = fakePb(segStubs({ mediaClips: [{ ...userClip }] }));

    const inspection = await inspectMediaClipSegments(pb, 'mc1');

    expect(inspection.source).toBe('trim');
    expect(inspection.segments).toEqual([{ start: 0, end: 30 }]);
    expect(inspection.gaps).toEqual([]);
  });
});

describe('inspectTimelineClipSegments', () => {
  it('reports the meta source and validates -t', async () => {
    const clip = {
      ...baseTimelineClip,
      meta: { segments: [{ start: 2, end: 6 }] },
    };
    const pb = fakePb(segStubs({ timelineClips: [clip] }));

    const inspection = await inspectTimelineClipSegments(pb, 'tc1', 'tl1');

    expect(inspection.source).toBe('meta');
    expect(inspection.segments).toEqual([{ start: 2, end: 6 }]);

    await expect(inspectTimelineClipSegments(pb, 'tc1', 'tl2')).rejects.toThrow(
      /belongs to timeline tl1/i
    );
  });
});

describe('segment-edit no-ops and warnings', () => {
  it('a trim to the same edges is a noop and writes nothing', async () => {
    const stubs = segStubs({ mediaClips: [{ ...compositeClip }] });
    const pb = fakePb(stubs);

    // segment 0 already spans 0–10s — the edit list comes back identical
    const result = await editMediaClipSegments(pb, 'mc2', {
      kind: 'trim',
      segment: 0,
      start: 0,
      end: 10,
    });

    expect(result.noop).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['noop']);
    expect(stubs.MediaClips.update).not.toHaveBeenCalled();
  });

  it('a trim to the same edges is a noop for timeline clips too', async () => {
    const clip = {
      ...baseTimelineClip,
      meta: { segments: [{ start: 0, end: 30 }] },
    };
    const stubs = segStubs({ timelineClips: [clip] });
    const pb = fakePb(stubs);

    const result = await editTimelineClipSegments(pb, 'tc1', {
      kind: 'trim',
      start: 0,
      end: 30,
    });

    expect(result.noop).toBe(true);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
    // no write → no duration re-sync
    expect(stubs.Timelines.getOne).not.toHaveBeenCalled();
  });

  it('a clamped slip carries a warning-level clamped entry', async () => {
    const clip = { ...userClip, start: 0, end: 55, duration: 55 };
    const stubs = segStubs({ mediaClips: [clip] });
    const pb = fakePb(stubs);

    // only 5s of headroom before the 60s media end
    const result = await editMediaClipSegments(pb, 'mc1', {
      kind: 'slip',
      by: 20,
    });

    expect(result.appliedBy).toBe(5);
    const clamp = result.warnings.find((w) => w.code === 'clamped');
    expect(clamp?.level).toBe('warning');
    expect(clamp?.data).toEqual({ requestedBy: 20, appliedBy: 5 });
  });
});
