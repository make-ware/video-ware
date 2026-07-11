import { describe, expect, it, vi } from 'vitest';
import {
  moveTimelineClip,
  removeTimelineClip,
  reorderTimelineClips,
  rippleTimelineClips,
  timelineClipLabelHint,
  updateTimelineClip,
  type TimelineClipExpanded,
} from '../lib/timeline-clip.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

interface StubOptions {
  media?: Record<string, unknown>;
  tracks?: Record<string, unknown>[];
  clips?: Record<string, unknown>[];
  timeline?: Record<string, unknown>;
}

function clipStubs(opts: StubOptions = {}): Record<string, Stub> {
  const {
    media = { id: 'm1', duration: 60, mediaType: 'video' },
    tracks = [
      { id: 'trk0', layer: 0, name: 'Main', TimelineRef: 'tl1' },
      { id: 'trk1', layer: 1, name: 'B-Roll', TimelineRef: 'tl1' },
    ],
    clips = [],
    timeline = { id: 'tl1', WorkspaceRef: 'ws1', duration: 0, version: 1 },
  } = opts;
  return {
    Media: { getOne: vi.fn(async () => media) },
    TimelineTracks: {
      getList: vi.fn(async () => listResult(tracks)),
      getOne: vi.fn(async (id: string) => {
        const track = tracks.find((t) => t.id === id);
        if (!track) throw notFound();
        return track;
      }),
      create: vi.fn(async (data) => ({ ...data, id: 'newtrack' })),
    },
    TimelineClips: {
      getList: vi.fn(async () => listResult(clips)),
      getOne: vi.fn(async (id: string) => {
        const clip = clips.find((c) => c.id === id);
        if (!clip) throw notFound();
        return clip;
      }),
      update: vi.fn(async (id: string, data: object) => ({
        ...clips.find((c) => c.id === id),
        ...data,
      })),
      delete: vi.fn(async () => true),
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

describe('timelineClipLabelHint', () => {
  const base = { id: 'tc1', TimelineRef: 'tl1', order: 0, start: 0, end: 1 };

  it('prefers the timeline clip label', () => {
    const clip = {
      ...base,
      label: 'Own label',
      expand: { MediaClipRef: { label: 'Clip label' } },
    } as unknown as TimelineClipExpanded;
    expect(timelineClipLabelHint(clip)).toBe('Own label');
  });

  it('falls back to the source MediaClip label', () => {
    const clip = {
      ...base,
      expand: { MediaClipRef: { label: 'Clip label' } },
    } as unknown as TimelineClipExpanded;
    expect(timelineClipLabelHint(clip)).toBe('Clip label');
  });

  it('falls back to the media upload name', () => {
    const clip = {
      ...base,
      MediaRef: 'm1',
      expand: {
        MediaRef: { id: 'm1', expand: { UploadRef: { name: 'shoot.mp4' } } },
      },
    } as unknown as TimelineClipExpanded;
    expect(timelineClipLabelHint(clip)).toBe('shoot.mp4');
  });

  it('labels caption clips as Caption and defaults to the id', () => {
    const caption = {
      ...base,
      CaptionRef: 'cap1',
    } as unknown as TimelineClipExpanded;
    expect(timelineClipLabelHint(caption)).toBe('Caption');
    const bare = { ...base } as unknown as TimelineClipExpanded;
    expect(timelineClipLabelHint(bare)).toBe('tc1');
  });
});

describe('updateTimelineClip', () => {
  const clip = {
    id: 'tc1',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    order: 0,
    start: 0,
    end: 5,
    duration: 5,
    meta: { title: 'Keep me' },
  };

  it('re-validates trims against the source media', async () => {
    const pb = fakePb(
      clipStubs({
        clips: [clip],
        media: { id: 'm1', duration: 10, mediaType: 'video' },
      })
    );

    await expect(updateTimelineClip(pb, 'tc1', { end: 99 })).rejects.toThrow(
      /invalid time range/i
    );
  });

  it('applies a valid trim with recomputed duration and syncs', async () => {
    const stubs = clipStubs({ clips: [clip] });
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { start: 2, end: 8 });

    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      start: 2,
      end: 8,
      duration: 6,
    });
    // trim changed → timeline duration re-synced
    expect(stubs.Timelines.getOne).toHaveBeenCalled();
  });

  it('merges gain into existing meta without a duration sync', async () => {
    const stubs = clipStubs({ clips: [clip] });
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { gain: 0.5 });

    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      meta: { title: 'Keep me', gain: 0.5 },
    });
    expect(stubs.Timelines.getOne).not.toHaveBeenCalled();
  });

  it('updates label/description without touching the media', async () => {
    const stubs = clipStubs({ clips: [clip] });
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { label: 'Renamed' });

    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      label: 'Renamed',
    });
    expect(stubs.Media.getOne).not.toHaveBeenCalled();
  });

  it('rejects an empty patch', async () => {
    const pb = fakePb(clipStubs({ clips: [clip] }));
    await expect(updateTimelineClip(pb, 'tc1', {})).rejects.toThrow(
      /nothing to update/i
    );
  });
});

describe('moveTimelineClip', () => {
  it('keeps the computed position when only changing tracks', async () => {
    // a and b flow sequentially on trk0; b starts at 3
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
        duration: 3,
      },
      {
        id: 'b',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 1,
        start: 0,
        end: 2,
        duration: 2,
      },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'b', { track: '1' });

    expect(stubs.TimelineClips.update.mock.calls[0][0]).toBe('b');
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      TimelineTrackRef: 'trk1',
      timelineStart: 3,
    });
    expect(result.track.id).toBe('trk1');
    expect(result.nudged).toBe(false);
  });

  it('excludes the clip itself from same-track collision checks', async () => {
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 5,
        duration: 5,
        timelineStart: 5,
      },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'a', { at: 6 });

    expect(result.placedAt).toBe(6);
    expect(result.nudged).toBe(false);
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      TimelineTrackRef: 'trk0',
      timelineStart: 6,
    });
  });

  it('nudges past other clips on the destination track', async () => {
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 10,
      },
      {
        id: 'blocker',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk1',
        MediaRef: 'm1',
        order: 1,
        start: 0,
        end: 4,
        duration: 4,
        timelineStart: 0,
      },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'a', { track: 'trk1', at: 2 });

    expect(result.requestedAt).toBe(2);
    expect(result.placedAt).toBe(4);
    expect(result.nudged).toBe(true);
  });

  it('overwrites the destination slot when asked', async () => {
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 10,
      },
      {
        id: 'b',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 1,
        start: 0,
        end: 4,
        duration: 4,
        timelineStart: 0,
      },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    // move a (3s) onto [2,5]: b keeps its head [0,2]
    const result = await moveTimelineClip(pb, 'a', {
      at: 2,
      overwrite: true,
    });

    expect(stubs.TimelineClips.update.mock.calls[0][0]).toBe('b');
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      start: 0,
      end: 2,
      duration: 2,
      timelineStart: 0,
    });
    expect(result.placedAt).toBe(2);
    expect(result.trimmedClipIds).toEqual(['b']);
  });

  it('dry-run computes the placement without writing', async () => {
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 7,
      },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'a', { at: 2, dryRun: true });

    expect(result.clip).toBeNull();
    expect(result.dryRun).toBe(true);
    expect(result.placedAt).toBe(2);
    expect(result.placedEnd).toBe(5);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('validates its flag combinations and -t expectations', async () => {
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 0,
      },
    ];
    const pb = fakePb(clipStubs({ clips }));
    await expect(moveTimelineClip(pb, 'a', {})).rejects.toThrow(
      /--track and\/or --at/i
    );
    await expect(
      moveTimelineClip(pb, 'a', { overwrite: true })
    ).rejects.toThrow(/--overwrite requires --at/i);
    await expect(
      moveTimelineClip(pb, 'a', { at: 2, timelineId: 'other' })
    ).rejects.toThrow(/belongs to timeline tl1/i);
  });
});

describe('rippleTimelineClips', () => {
  const clips = [
    {
      id: 'a',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk0',
      MediaRef: 'm1',
      order: 0,
      start: 0,
      end: 3,
      duration: 3,
      timelineStart: 0,
    },
    {
      id: 'b',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk0',
      MediaRef: 'm1',
      order: 1,
      start: 0,
      end: 4,
      duration: 4,
      timelineStart: 5,
    },
    {
      id: 'c',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk0',
      MediaRef: 'm1',
      order: 2,
      start: 0,
      end: 2,
      duration: 2,
      timelineStart: 9,
    },
    // other track: must not move
    {
      id: 'x',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk1',
      MediaRef: 'm1',
      order: 3,
      start: 0,
      end: 8,
      duration: 8,
      timelineStart: 6,
    },
  ];

  it('shifts the clip and everything after it on its track', async () => {
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await rippleTimelineClips(pb, 'b', { by: 2.5 });

    expect(result.by).toBe(2.5);
    expect(result.shifted).toEqual([
      { clipId: 'b', from: 5, to: 7.5 },
      { clipId: 'c', from: 9, to: 11.5 },
    ]);
    type UpdateCall = [string, Record<string, unknown>];
    const calls = stubs.TimelineClips.update.mock.calls as UpdateCall[];
    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['b', { timelineStart: 7.5 }],
      ['c', { timelineStart: 11.5 }],
    ]);
  });

  it('clamps a leftward shift at the previous clip end', async () => {
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await rippleTimelineClips(pb, 'b', { by: -10 });

    expect(result.requestedBy).toBe(-10);
    expect(result.by).toBe(-2); // a ends at 3s; b sits at 5s
    expect(result.shifted).toEqual([
      { clipId: 'b', from: 5, to: 3 },
      { clipId: 'c', from: 9, to: 7 },
    ]);
  });

  it('dry-run computes the shifts without writing', async () => {
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await rippleTimelineClips(pb, 'b', { by: 1, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.shifted).toHaveLength(2);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('rejects a zero shift and validates -t', async () => {
    const pb = fakePb(clipStubs({ clips }));
    await expect(rippleTimelineClips(pb, 'b', { by: 0 })).rejects.toThrow(
      /non-zero/i
    );
    await expect(
      rippleTimelineClips(pb, 'b', { by: 1, timelineId: 'other' })
    ).rejects.toThrow(/belongs to timeline tl1/i);
  });
});

describe('removeTimelineClip', () => {
  it('deletes, renumbers densely, and re-syncs duration', async () => {
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
      },
      {
        id: 'b',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 2,
        start: 0,
        end: 2,
      },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    await removeTimelineClip(pb, 'a');

    expect(stubs.TimelineClips.delete).toHaveBeenCalledWith('a');
    // remaining list is the static stub; a keeps order 0, b (2) renumbers to 1
    type UpdateCall = [string, Record<string, unknown>];
    const orderCalls = (
      stubs.TimelineClips.update.mock.calls as UpdateCall[]
    ).filter((call) => 'order' in call[1]);
    expect(orderCalls.map((call) => [call[0], call[1]])).toEqual([
      ['b', { order: 1 }],
    ]);
    expect(stubs.Timelines.getOne).toHaveBeenCalled();
  });

  it('ripple-delete shifts later clips left by the removed length', async () => {
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 0,
      },
      {
        id: 'b',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 1,
        start: 0,
        end: 4,
        duration: 4,
        timelineStart: 3,
      },
      // 2s intentional gap before c — ripple preserves it
      {
        id: 'c',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 2,
        start: 0,
        end: 2,
        duration: 2,
        timelineStart: 9,
      },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await removeTimelineClip(pb, 'a', { ripple: true });

    expect(stubs.TimelineClips.delete).toHaveBeenCalledWith('a');
    expect(result.shifted).toEqual([
      { clipId: 'b', from: 3, to: 0 },
      { clipId: 'c', from: 9, to: 6 },
    ]);
    type UpdateCall = [string, Record<string, unknown>];
    const positionWrites = (
      stubs.TimelineClips.update.mock.calls as UpdateCall[]
    ).filter((call) => 'timelineStart' in call[1]);
    expect(positionWrites.map((call) => [call[0], call[1]])).toEqual([
      ['b', { timelineStart: 0 }],
      ['c', { timelineStart: 6 }],
    ]);
  });

  it('errors on an unknown clip and validates -t', async () => {
    const pb = fakePb(clipStubs());
    await expect(removeTimelineClip(pb, 'nope')).rejects.toThrow(
      /clip not found/i
    );
    const clips = [
      {
        id: 'a',
        TimelineRef: 'tl1',
        TimelineTrackRef: 'trk0',
        MediaRef: 'm1',
        order: 0,
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 0,
      },
    ];
    const pb2 = fakePb(clipStubs({ clips }));
    await expect(
      removeTimelineClip(pb2, 'a', { timelineId: 'other' })
    ).rejects.toThrow(/belongs to timeline tl1/i);
  });
});

describe('reorderTimelineClips', () => {
  const clips = [
    { id: 'a', TimelineRef: 'tl1', order: 0, start: 0, end: 1 },
    { id: 'b', TimelineRef: 'tl1', order: 1, start: 0, end: 1 },
  ];

  it('applies the complete new sequence', async () => {
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    await reorderTimelineClips(pb, 'tl1', ['b', 'a']);

    const calls = stubs.TimelineClips.update.mock.calls as [
      string,
      Record<string, unknown>,
    ][];
    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      ['b', { order: 0 }],
      ['a', { order: 1 }],
    ]);
  });

  it('rejects incomplete, foreign, or duplicated id sets', async () => {
    const pb = fakePb(clipStubs({ clips }));
    await expect(reorderTimelineClips(pb, 'tl1', ['a'])).rejects.toThrow(
      /missing: b/i
    );
    await expect(
      reorderTimelineClips(pb, 'tl1', ['a', 'b', 'zzz'])
    ).rejects.toThrow(/not on this timeline: zzz/i);
    await expect(reorderTimelineClips(pb, 'tl1', ['a', 'a'])).rejects.toThrow(
      /more than once/i
    );
  });
});

describe('updateTimelineClip on a clip with an edit list', () => {
  const clip = {
    id: 'tc1',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    order: 0,
    start: 0,
    end: 30,
    duration: 20,
    meta: {
      title: 'Keep me',
      segments: [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
    },
  };

  it('windows the trim over meta.segments without modifying the list', async () => {
    const stubs = clipStubs({ clips: [clip] });
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { start: 5, end: 25 });

    // Non-destructive: only the window and its effective duration persist —
    // meta.segments is untouched, so the trim can be widened back later.
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      start: 5,
      end: 25,
      duration: 10,
    });
  });

  it('untrims: widening the window restores content up to the full list', async () => {
    const trimmed = { ...clip, start: 5, end: 25, duration: 10 };
    const stubs = clipStubs({ clips: [trimmed] });
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { start: 0, end: 30 });

    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      start: 0,
      end: 30,
      duration: 20,
    });
  });

  it('clamps a wider-than-list window to the edit list span', async () => {
    const stubs = clipStubs({ clips: [clip] });
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { start: 0, end: 45 });

    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      start: 0,
      end: 30,
      duration: 20,
    });
  });

  it('rejects a trim window with no segment content', async () => {
    const stubs = clipStubs({ clips: [clip] });
    const pb = fakePb(stubs);

    await expect(
      updateTimelineClip(pb, 'tc1', { start: 12, end: 18 })
    ).rejects.toThrow(/no segment content/i);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });
});
