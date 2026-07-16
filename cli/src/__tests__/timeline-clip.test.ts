import { describe, expect, it, vi } from 'vitest';
import { RecordConflictError } from '@project/shared';
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

describe('updateTimelineClip on a nested-timeline clip', () => {
  // Parent tl1 holds a nested clip playing tl2; tl2's live extent is 8s.
  const nestedClip = {
    id: 'tc1',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    SourceTimelineRef: 'tl2',
    order: 0,
    start: 0,
    end: 8,
    duration: 8,
    timelineStart: 0,
    meta: { title: 'Intro', followSource: true, sourceOutOfRange: true },
  };
  const childClips = [
    {
      id: 'c1',
      TimelineRef: 'tl2',
      TimelineTrackRef: 'trk2',
      MediaRef: 'm1',
      order: 0,
      start: 0,
      end: 8,
      duration: 8,
      timelineStart: 0,
    },
  ];

  /** clipStubs, but with clip/track lists routed by the filter's timeline. */
  function nestedClipStubs(): Record<string, Stub> {
    const stubs = clipStubs({ clips: [nestedClip] });
    const idFromFilter = (filter?: string): string =>
      /"([^"]+)"/.exec(filter ?? '')?.[1] ?? '';
    stubs.TimelineClips.getList = vi.fn(
      async (_p: number, _pp: number, options: { filter?: string }) =>
        listResult(
          idFromFilter(options?.filter) === 'tl2' ? childClips : [nestedClip]
        )
    );
    stubs.TimelineTracks.getList = vi.fn(
      async (_p: number, _pp: number, options: { filter?: string }) =>
        listResult(
          idFromFilter(options?.filter) === 'tl2'
            ? [{ id: 'trk2', layer: 0, name: 'Main', TimelineRef: 'tl2' }]
            : [{ id: 'trk0', layer: 0, name: 'Main', TimelineRef: 'tl1' }]
        )
    );
    return stubs;
  }

  it('trims against the live source duration and stops following', async () => {
    const stubs = nestedClipStubs();
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { start: 2, end: 6 });

    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      start: 2,
      end: 6,
      duration: 4,
      // narrower trim opts out of following; the stale clamp flag clears
      meta: { title: 'Intro', followSource: false },
    });
  });

  it('re-follows the source on an untrim back to the full span', async () => {
    const stubs = nestedClipStubs();
    const pb = fakePb(stubs);

    await updateTimelineClip(pb, 'tc1', { start: 0, end: 8 });

    // start/end/duration already match the stored clip, so no-op elision
    // drops them; only the followSource flip is written
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      meta: { title: 'Intro', followSource: true },
    });
  });

  it('rejects a trim beyond the live source duration', async () => {
    const pb = fakePb(nestedClipStubs());

    await expect(
      updateTimelineClip(pb, 'tc1', { start: 0, end: 9 })
    ).rejects.toThrow(/invalid time range/i);
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
    // start from a trimmed window so the clamped result differs from the
    // stored values (an identical result would be elided as a no-op)
    const trimmed = { ...clip, start: 5, end: 25, duration: 10 };
    const stubs = clipStubs({ clips: [trimmed] });
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

describe('no-op elision', () => {
  const placedClip = {
    id: 'a',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    order: 0,
    start: 0,
    end: 3,
    duration: 3,
    timelineStart: 5,
  };

  it('move to the exact current position skips the write', async () => {
    const stubs = clipStubs({ clips: [placedClip] });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'a', { at: 5 });

    expect(result.noop).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['noop']);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
    // no write → no duration re-sync either (updated stays meaningful)
    expect(stubs.Timelines.getOne).not.toHaveBeenCalled();
  });

  it('still writes when healing a legacy clip without explicit placement', async () => {
    const legacy = { ...placedClip, timelineStart: undefined };
    const stubs = clipStubs({ clips: [legacy] });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'a', { track: '0' });

    expect(result.noop).toBe(false);
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      TimelineTrackRef: 'trk0',
      timelineStart: 0,
    });
  });

  it('update with values identical to the stored clip skips the write', async () => {
    const stubs = clipStubs({ clips: [placedClip] });
    const pb = fakePb(stubs);

    const result = await updateTimelineClip(pb, 'a', { start: 0, end: 3 });

    expect(result.noop).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['noop']);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('reorder matching the stored order skips the writes', async () => {
    const clips = [
      { ...placedClip, id: 'a', order: 0 },
      { ...placedClip, id: 'b', order: 1, timelineStart: 10 },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await reorderTimelineClips(pb, 'tl1', ['a', 'b']);

    expect(result.noop).toBe(true);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('ripple clamped to zero reports noop without writing', async () => {
    const clips = [
      { ...placedClip, id: 'a', timelineStart: 0, end: 5, duration: 5 },
      { ...placedClip, id: 'b', order: 1, timelineStart: 5 },
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await rippleTimelineClips(pb, 'b', { by: -2 });

    expect(result.noop).toBe(true);
    expect(result.by).toBe(0);
    expect(result.warnings.map((w) => w.code)).toEqual(['noop']);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });
});

describe('edit warnings', () => {
  const trackClip = (overrides: Record<string, unknown>) => ({
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    start: 0,
    end: 5,
    duration: 5,
    ...overrides,
  });

  it('a nudged move carries a warning-level nudged entry', async () => {
    const clips = [
      trackClip({
        id: 'blocker',
        order: 0,
        end: 10,
        duration: 10,
        timelineStart: 0,
      }),
      trackClip({ id: 'mover', order: 1, timelineStart: 20 }),
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'mover', { at: 3 });

    expect(result.nudged).toBe(true);
    expect(result.placedAt).toBe(10);
    const nudge = result.warnings.find((w) => w.code === 'nudged');
    expect(nudge?.level).toBe('warning');
    expect(nudge?.data).toEqual({ requestedAt: 3, placedAt: 10 });
  });

  it('move --ripple lands exactly at --at and shifts later clips right', async () => {
    const clips = [
      trackClip({
        id: 'blocker',
        order: 0,
        end: 10,
        duration: 10,
        timelineStart: 0,
      }),
      trackClip({ id: 'mover', order: 1, timelineStart: 20 }),
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'mover', {
      at: 3,
      ripple: true,
    });

    expect(result.placedAt).toBe(3);
    expect(result.nudged).toBe(false);
    // blocker straddles 3s, so it clears the whole inserted range: 0 → 8
    expect(result.shifted).toEqual([{ clipId: 'blocker', from: 0, to: 8 }]);
    expect(stubs.TimelineClips.update).toHaveBeenCalledWith(
      'blocker',
      { timelineStart: 8 },
      expect.anything()
    );
    const notice = result.warnings.find((w) => w.code === 'shifted-others');
    expect(notice?.level).toBe('notice');
    expect(notice?.clipIds).toEqual(['blocker']);
  });

  it('a clamped ripple carries a warning-level clamped entry', async () => {
    const clips = [
      trackClip({ id: 'a', order: 0, timelineStart: 0 }),
      trackClip({ id: 'b', order: 1, timelineStart: 8, end: 3, duration: 3 }),
    ];
    const stubs = clipStubs({ clips });
    const pb = fakePb(stubs);

    const result = await rippleTimelineClips(pb, 'b', { by: -5 });

    expect(result.by).toBe(-3); // clamped at a's end (5s)
    const clamp = result.warnings.find((w) => w.code === 'clamped');
    expect(clamp?.level).toBe('warning');
    expect(clamp?.data).toEqual({ requestedBy: -5, appliedBy: -3 });
  });

  it('surfaces a post-write overlap left by a concurrent editor', async () => {
    const mover = trackClip({ id: 'mover', order: 0, timelineStart: 0 });
    // the post-write re-fetch sees a clip another editor landed on [10,15)
    const intruder = trackClip({
      id: 'intruder',
      order: 1,
      timelineStart: 12,
    });
    const stubs = clipStubs({ clips: [mover] });
    stubs.TimelineClips.getList = vi
      .fn()
      .mockResolvedValueOnce(listResult([mover]))
      .mockResolvedValue(
        listResult([{ ...mover, timelineStart: 10 }, intruder])
      );
    const pb = fakePb(stubs);

    const result = await moveTimelineClip(pb, 'mover', { at: 10 });

    const overlap = result.warnings.find(
      (w) => w.code === 'post-write-overlap'
    );
    expect(overlap?.level).toBe('warning');
    expect(overlap?.clipIds).toContain('mover');
    expect(overlap?.message).toMatch(/vw timeline doctor/);
  });
});

describe('concurrent-edit guard', () => {
  it('aborts the write when the clip changed between read and write', async () => {
    const stored = {
      id: 'tc1',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk0',
      MediaRef: 'm1',
      order: 0,
      start: 0,
      end: 5,
      duration: 5,
      timelineStart: 0,
      label: '',
      updated: '2026-07-16 10:00:00.000Z',
    };
    const stubs = clipStubs({ clips: [stored] });
    stubs.TimelineClips.getOne = vi
      .fn()
      // the op's initial read
      .mockResolvedValueOnce(stored)
      // the guard's re-read: another editor wrote in between
      .mockResolvedValue({
        ...stored,
        updated: '2026-07-16 10:00:04.000Z',
        label: 'remote rename',
      });
    const pb = fakePb(stubs);

    await expect(
      updateTimelineClip(pb, 'tc1', { label: 'my rename' })
    ).rejects.toThrow(RecordConflictError);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });
});
