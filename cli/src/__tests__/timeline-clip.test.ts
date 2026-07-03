import { describe, expect, it, vi } from 'vitest';
import {
  moveTimelineClip,
  removeTimelineClip,
  reorderTimelineClips,
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

  it('clears the pin with --sequential', async () => {
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

    await moveTimelineClip(pb, 'a', { sequential: true });

    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      TimelineTrackRef: 'trk0',
      timelineStart: null,
    });
  });

  it('validates its flag combinations', async () => {
    const pb = fakePb(clipStubs());
    await expect(moveTimelineClip(pb, 'a', {})).rejects.toThrow(
      /--track, --at/i
    );
    await expect(
      moveTimelineClip(pb, 'a', { sequential: true, at: 2 })
    ).rejects.toThrow(/mutually exclusive/i);
    await expect(
      moveTimelineClip(pb, 'a', { overwrite: true })
    ).rejects.toThrow(/--overwrite requires --at/i);
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

  it('errors on an unknown clip', async () => {
    const pb = fakePb(clipStubs());
    await expect(removeTimelineClip(pb, 'nope')).rejects.toThrow(
      /clip not found/i
    );
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
