import { describe, expect, it, vi } from 'vitest';
import { TaskStatus } from '@project/shared';
import {
  createRender,
  createTimeline,
  insertClip,
  insertClips,
  resolveTrackRef,
  syncTimelineDuration,
} from '../lib/timeline.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const OUTPUT = { resolution: '1920x1080', codec: 'h264', format: 'mp4' };

interface StubOptions {
  media?: Record<string, unknown>;
  mediaClip?: Record<string, unknown>;
  caption?: Record<string, unknown>;
  tracks?: Record<string, unknown>[];
  clips?: Record<string, unknown>[];
  timeline?: Record<string, unknown>;
}

/** Collection stubs for the common insert/sync flow (override per test). */
function timelineStubs(opts: StubOptions = {}): Record<string, Stub> {
  const {
    media = { id: 'm1', duration: 60, mediaType: 'video' },
    mediaClip,
    caption,
    tracks = [{ id: 'track1', layer: 0, TimelineRef: 'tl1' }],
    clips = [],
    timeline = { id: 'tl1', WorkspaceRef: 'ws1', duration: 0, version: 1 },
  } = opts;
  return {
    Media: { getOne: vi.fn(async () => media) },
    MediaClips: {
      getOne: vi.fn(async () => {
        if (!mediaClip) throw notFound();
        return mediaClip;
      }),
    },
    Captions: {
      getOne: vi.fn(async () => {
        if (!caption) throw notFound();
        return caption;
      }),
    },
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
      create: vi.fn(async (data) => ({ ...data, id: 'newclip' })),
      update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
      delete: vi.fn(async () => true),
    },
    Timelines: {
      getOne: vi.fn(async () => timeline),
      create: vi.fn(async (data) => ({ ...data, id: 'tl1' })),
      update: vi.fn(async (id: string, data: object) => ({
        ...timeline,
        ...data,
      })),
    },
  };
}

describe('insertClip', () => {
  it('appends a media clip with an explicit position and computed order', async () => {
    const stubs = timelineStubs();
    const pb = fakePb(stubs);

    const result = await insertClip(pb, { timelineId: 'tl1', media: 'm1' });

    expect(stubs.TimelineClips.create).toHaveBeenCalledOnce();
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      TimelineRef: 'tl1',
      TimelineTrackRef: 'track1',
      MediaRef: 'm1',
      order: 0,
      start: 0,
      end: 60,
      duration: 60,
      // always written: PB number fields coerce an omitted value to 0, so
      // "unset = sequential flow" cannot survive a round-trip
      timelineStart: 0,
    });
    expect(result.clip?.id).toBe('newclip');
    expect(result.mode).toBe('append');
    expect(result.placedAt).toBe(0);
    expect(result.placedEnd).toBe(60);
    expect(result.nudged).toBe(false);
  });

  it('appends after the furthest clip end on the target track', async () => {
    const stubs = timelineStubs({
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 10,
          duration: 10,
          timelineStart: 0,
        },
        {
          id: 'c2',
          TimelineTrackRef: 'track1',
          order: 1,
          start: 0,
          end: 5,
          duration: 5,
          timelineStart: 12,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
    });

    expect(result.mode).toBe('append');
    expect(result.placedAt).toBe(17);
    expect(result.afterClip?.id).toBe('c2');
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      timelineStart: 17,
      order: 2,
    });
  });

  it('places --after right at that clip end when the slot is free', async () => {
    const stubs = timelineStubs({
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 10,
          duration: 10,
          timelineStart: 0,
        },
        {
          id: 'c2',
          TimelineTrackRef: 'track1',
          order: 1,
          start: 0,
          end: 5,
          duration: 5,
          timelineStart: 30,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
      after: 'c1',
    });

    expect(result.mode).toBe('after');
    expect(result.placedAt).toBe(10);
    expect(result.nudged).toBe(false);
    expect(result.afterClip?.id).toBe('c1');
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      timelineStart: 10,
    });
  });

  it('nudges an --after insert past a too-small gap', async () => {
    const stubs = timelineStubs({
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 10,
          duration: 10,
          timelineStart: 0,
        },
        {
          id: 'c2',
          TimelineTrackRef: 'track1',
          order: 1,
          start: 0,
          end: 5,
          duration: 5,
          timelineStart: 12,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
      after: 'c1',
    });

    expect(result.requestedAt).toBe(10);
    expect(result.placedAt).toBe(17);
    expect(result.nudged).toBe(true);
  });

  it('uses the --after clip track as the target track', async () => {
    const stubs = timelineStubs({
      tracks: [
        { id: 'track1', layer: 0, TimelineRef: 'tl1' },
        { id: 'track2', layer: 1, TimelineRef: 'tl1' },
      ],
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track2',
          order: 0,
          start: 0,
          end: 10,
          duration: 10,
          timelineStart: 0,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
      after: 'c1',
    });

    expect(result.track.id).toBe('track2');
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      TimelineTrackRef: 'track2',
      timelineStart: 10,
    });
  });

  it('rejects --after with --at, a conflicting --track, or an unknown clip', async () => {
    const stubs = timelineStubs({
      tracks: [
        { id: 'track1', layer: 0, TimelineRef: 'tl1' },
        { id: 'track2', layer: 1, TimelineRef: 'tl1' },
      ],
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 10,
          duration: 10,
          timelineStart: 0,
        },
      ],
    });
    const pb = fakePb(stubs);

    await expect(
      insertClip(pb, { timelineId: 'tl1', media: 'm1', at: 3, after: 'c1' })
    ).rejects.toThrow(/mutually exclusive/i);
    await expect(
      insertClip(pb, { timelineId: 'tl1', media: 'm1', after: 'zzz' })
    ).rejects.toThrow(/not on timeline/i);
    await expect(
      insertClip(pb, {
        timelineId: 'tl1',
        media: 'm1',
        after: 'c1',
        track: '1',
      })
    ).rejects.toThrow(/lives on track layer 0/i);
  });

  it('rejects a time range beyond the media duration', async () => {
    const pb = fakePb(
      timelineStubs({ media: { id: 'm1', duration: 10, mediaType: 'video' } })
    );

    await expect(
      insertClip(pb, { timelineId: 'tl1', media: 'm1', start: 0, end: 99 })
    ).rejects.toThrow(/invalid time range/i);
  });

  it('tells the caller image media needs an explicit end', async () => {
    const pb = fakePb(
      timelineStubs({ media: { id: 'm1', duration: 0, mediaType: 'image' } })
    );

    await expect(
      insertClip(pb, { timelineId: 'tl1', media: 'm1' })
    ).rejects.toThrow(/explicit --end/i);
  });

  it('requires exactly one of media, clip, caption, and source timeline', async () => {
    const pb = fakePb(timelineStubs());
    await expect(insertClip(pb, { timelineId: 'tl1' })).rejects.toThrow(
      /--media <id>, --clip <mediaClipId>, --caption <captionId>, or --source-timeline/i
    );
    await expect(
      insertClip(pb, { timelineId: 'tl1', media: 'm1', clip: 'mc1' })
    ).rejects.toThrow(/mutually exclusive/i);
  });

  it('rejects --overwrite without --at', async () => {
    const pb = fakePb(timelineStubs());
    await expect(
      insertClip(pb, { timelineId: 'tl1', media: 'm1', overwrite: true })
    ).rejects.toThrow(/--overwrite requires --at/i);
  });

  it('places at the requested time when the slot is free', async () => {
    const stubs = timelineStubs({
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 5,
          duration: 5,
          timelineStart: 0,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
      at: 10,
    });

    expect(result.placedAt).toBe(10);
    expect(result.nudged).toBe(false);
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      timelineStart: 10,
      order: 1,
    });
  });

  it('nudges past a collision and reports the actual placement', async () => {
    const stubs = timelineStubs({
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 10,
          duration: 10,
          timelineStart: 0,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
      at: 3,
    });

    expect(result.placedAt).toBe(10);
    expect(result.requestedAt).toBe(3);
    expect(result.nudged).toBe(true);
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      timelineStart: 10,
    });
  });

  it('overwrite trims and removes overlapped clips, then places exactly', async () => {
    const stubs = timelineStubs({
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 4,
          duration: 4,
          timelineStart: 0,
        },
        {
          id: 'c2',
          TimelineTrackRef: 'track1',
          order: 1,
          start: 0,
          end: 2,
          duration: 2,
          timelineStart: 4,
        },
      ],
    });
    const pb = fakePb(stubs);

    // insert [3,8]: c1 keeps its head [0,3], c2 is fully covered
    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
      at: 3,
      overwrite: true,
    });

    expect(stubs.TimelineClips.update.mock.calls[0][0]).toBe('c1');
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      start: 0,
      end: 3,
      duration: 3,
      timelineStart: 0,
    });
    expect(stubs.TimelineClips.delete).toHaveBeenCalledWith('c2');
    expect(result.placedAt).toBe(3);
    expect(result.trimmedClipIds).toEqual(['c1']);
    expect(result.removedClipIds).toEqual(['c2']);
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      timelineStart: 3,
      order: 1, // dense renumber after removal
    });
  });

  it('dry-run reports the overwrite plan without writing anything', async () => {
    const stubs = timelineStubs({
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'track1',
          order: 0,
          start: 0,
          end: 4,
          duration: 4,
          timelineStart: 0,
        },
        {
          id: 'c2',
          TimelineTrackRef: 'track1',
          order: 1,
          start: 0,
          end: 2,
          duration: 2,
          timelineStart: 4,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
      at: 3,
      overwrite: true,
      dryRun: true,
    });

    expect(result.clip).toBeNull();
    expect(result.dryRun).toBe(true);
    expect(result.placedAt).toBe(3);
    expect(result.trims).toEqual([
      { clipId: 'c1', start: 0, end: 3, duration: 3, timelineStart: 0 },
    ]);
    expect(result.removedClipIds).toEqual(['c2']);
    expect(stubs.TimelineClips.create).not.toHaveBeenCalled();
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
    expect(stubs.TimelineClips.delete).not.toHaveBeenCalled();
    expect(stubs.Timelines.update).not.toHaveBeenCalled();
  });

  it('inherits trim window, label, and provenance from a MediaClip', async () => {
    const stubs = timelineStubs({
      mediaClip: {
        id: 'mc1',
        MediaRef: 'm1',
        start: 5,
        end: 15,
        label: 'Interview A1',
        description: 'best take',
      },
    });
    const pb = fakePb(stubs);

    await insertClip(pb, { timelineId: 'tl1', clip: 'mc1' });

    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      MediaRef: 'm1',
      MediaClipRef: 'mc1',
      start: 5,
      end: 15,
      duration: 10,
      label: 'Interview A1',
      description: 'best take',
    });
  });

  it('lets explicit flags override the MediaClip values', async () => {
    const stubs = timelineStubs({
      mediaClip: {
        id: 'mc1',
        MediaRef: 'm1',
        start: 5,
        end: 15,
        label: 'Interview A1',
      },
    });
    const pb = fakePb(stubs);

    await insertClip(pb, {
      timelineId: 'tl1',
      clip: 'mc1',
      start: 6,
      label: 'Best take',
    });

    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      start: 6,
      end: 15,
      label: 'Best take',
    });
  });

  it('resolves --track as a layer number', async () => {
    const stubs = timelineStubs({
      tracks: [
        { id: 'track1', layer: 0, TimelineRef: 'tl1' },
        { id: 'track2', layer: 1, TimelineRef: 'tl1' },
      ],
    });
    const pb = fakePb(stubs);

    await insertClip(pb, { timelineId: 'tl1', media: 'm1', track: '1' });

    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      TimelineTrackRef: 'track2',
    });
  });
});

describe('insertClip with a caption', () => {
  const caption = {
    id: 'cap1',
    duration: 3,
    text: 'Welcome',
    name: 'Intro title',
    captionType: 'title',
  };

  it('appends a caption clip with CaptionRef and a title in meta', async () => {
    const stubs = timelineStubs({ caption });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, { timelineId: 'tl1', caption: 'cap1' });

    const input = stubs.TimelineClips.create.mock.calls[0][0];
    expect(input).toMatchObject({
      TimelineRef: 'tl1',
      TimelineTrackRef: 'track1',
      CaptionRef: 'cap1',
      order: 0,
      start: 0,
      end: 3,
      duration: 3,
      timelineStart: 0,
      meta: { title: 'Intro title' },
    });
    // caption clips carry no media reference
    expect(input.MediaRef).toBeUndefined();
    expect(input.MediaClipRef).toBeUndefined();
    expect(result.placedAt).toBe(0);
    expect(result.placedEnd).toBe(3);
    expect(result.mode).toBe('append');
  });

  it('places a caption at an exact time on a chosen track', async () => {
    const stubs = timelineStubs({
      caption,
      tracks: [
        { id: 'track1', layer: 0, TimelineRef: 'tl1' },
        { id: 'track2', layer: 1, TimelineRef: 'tl1' },
      ],
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      caption: 'cap1',
      track: '1',
      at: 8,
    });

    expect(result.placedAt).toBe(8);
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      TimelineTrackRef: 'track2',
      CaptionRef: 'cap1',
      timelineStart: 8,
    });
  });

  it('trims the caption cue timeline with --start/--end', async () => {
    const stubs = timelineStubs({ caption });
    const pb = fakePb(stubs);

    await insertClip(pb, {
      timelineId: 'tl1',
      caption: 'cap1',
      start: 1,
      end: 2,
    });

    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      start: 1,
      end: 2,
      duration: 1,
    });
  });

  it('falls back to the text when the caption has no name', async () => {
    const stubs = timelineStubs({
      caption: { id: 'cap1', duration: 2, text: 'Just text' },
    });
    const pb = fakePb(stubs);

    await insertClip(pb, { timelineId: 'tl1', caption: 'cap1' });

    expect(stubs.TimelineClips.create.mock.calls[0][0].meta).toEqual({
      title: 'Just text',
    });
  });

  it('rejects an invalid caption time range', async () => {
    const pb = fakePb(timelineStubs({ caption }));
    await expect(
      insertClip(pb, { timelineId: 'tl1', caption: 'cap1', start: 2, end: 2 })
    ).rejects.toThrow(/invalid caption time range/i);
  });

  it('errors when the caption does not exist', async () => {
    const pb = fakePb(timelineStubs());
    await expect(
      insertClip(pb, { timelineId: 'tl1', caption: 'nope' })
    ).rejects.toThrow(/caption not found/i);
  });

  it('rejects combining --caption with --media or --clip', async () => {
    const pb = fakePb(timelineStubs({ caption }));
    await expect(
      insertClip(pb, { timelineId: 'tl1', caption: 'cap1', media: 'm1' })
    ).rejects.toThrow(/mutually exclusive/i);
  });
});

describe('insertClip after a PocketBase round-trip', () => {
  /**
   * PocketBase number fields cannot represent "unset": an omitted
   * timelineStart is stored and returned as 0. These stubs persist created
   * clips with that coercion applied, so each insert reads back exactly
   * what a real PB would serve. The original bug: flag-less inserts
   * relied on unset-means-flow and every clip came back pinned at 0s.
   */
  function roundTripStubs(mediaClips: Record<string, unknown>[] = []) {
    const stored: Record<string, unknown>[] = [];
    let seq = 0;
    const stubs: Record<string, Stub> = {
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          duration: 60,
          mediaType: 'video',
        })),
      },
      MediaClips: {
        getOne: vi.fn(async (id: string) => {
          const found = mediaClips.find((c) => c.id === id);
          if (!found) throw notFound();
          return found;
        }),
      },
      TimelineTracks: {
        getList: vi.fn(async () =>
          listResult([{ id: 'track1', layer: 0, TimelineRef: 'tl1' }])
        ),
      },
      TimelineClips: {
        getList: vi.fn(async () => listResult([...stored])),
        create: vi.fn(async (data: Record<string, unknown>) => {
          const record = {
            ...data,
            id: `c${++seq}`,
            timelineStart: data.timelineStart ?? 0, // PB zero-coercion
          };
          stored.push(record);
          return record;
        }),
      },
      Timelines: {
        getOne: vi.fn(async () => ({
          id: 'tl1',
          WorkspaceRef: 'ws1',
          duration: 0,
          version: 1,
        })),
        update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
      },
    };
    return stubs;
  }

  it('lands flag-less inserts back-to-back instead of stacking at 0s', async () => {
    const stubs = roundTripStubs();
    const pb = fakePb(stubs);

    const first = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 10,
    });
    const second = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 0,
      end: 5,
    });
    const third = await insertClip(pb, {
      timelineId: 'tl1',
      media: 'm1',
      start: 20,
      end: 28,
    });

    expect(first.placedAt).toBe(0);
    expect(second.placedAt).toBe(10);
    expect(second.afterClip?.id).toBe(first.clip?.id);
    expect(third.placedAt).toBe(15);
    expect(third.placedEnd).toBe(23);
  });

  it('appends a --clips batch in order, each after the previous', async () => {
    const stubs = roundTripStubs([
      { id: 'mc1', MediaRef: 'm1', start: 0, end: 10 },
      { id: 'mc2', MediaRef: 'm1', start: 5, end: 12 },
      { id: 'mc3', MediaRef: 'm1', start: 30, end: 33 },
    ]);
    const pb = fakePb(stubs);

    const results = await insertClips(pb, {
      timelineId: 'tl1',
      clipIds: ['mc1', 'mc2', 'mc3'],
    });

    expect(results.map((r) => r.placedAt)).toEqual([0, 10, 17]);
    expect(results.map((r) => r.placedEnd)).toEqual([10, 17, 20]);
    expect(results.map((r) => r.clip?.order)).toEqual([0, 1, 2]);
  });
});

describe('resolveTrackRef', () => {
  it('errors on a layer with no track', async () => {
    const pb = fakePb(timelineStubs());
    await expect(resolveTrackRef(pb, 'tl1', '3')).rejects.toThrow(
      /no track with layer 3/i
    );
  });

  it('errors on an ambiguous layer', async () => {
    const pb = fakePb(
      timelineStubs({
        tracks: [
          { id: 'a', layer: 1, TimelineRef: 'tl1' },
          { id: 'b', layer: 1, TimelineRef: 'tl1' },
        ],
      })
    );
    await expect(resolveTrackRef(pb, 'tl1', '1')).rejects.toThrow(
      /multiple tracks have layer 1/i
    );
  });

  it('resolves a record id and verifies its timeline', async () => {
    const pb = fakePb(
      timelineStubs({
        tracks: [{ id: 'trackxyz', layer: 0, TimelineRef: 'other' }],
      })
    );
    await expect(resolveTrackRef(pb, 'tl1', 'trackxyz')).rejects.toThrow(
      /different timeline/i
    );
  });

  it('errors on a missing record id', async () => {
    const pb = fakePb(timelineStubs({ tracks: [] }));
    await expect(resolveTrackRef(pb, 'tl1', 'nosuchtrack')).rejects.toThrow(
      /track not found/i
    );
  });
});

describe('createTimeline', () => {
  it('creates a timeline with a default Main Track at layer 0', async () => {
    const stubs = timelineStubs();
    const pb = fakePb(stubs);

    const result = await createTimeline(pb, {
      workspaceId: 'ws1',
      name: 'My Cut',
      label: 'Rough cut',
    });

    expect(stubs.Timelines.create.mock.calls[0][0]).toMatchObject({
      name: 'My Cut',
      WorkspaceRef: 'ws1',
      duration: 0,
      version: 1,
      label: 'Rough cut',
    });
    expect(stubs.TimelineTracks.create).toHaveBeenCalledOnce();
    expect(stubs.TimelineTracks.create.mock.calls[0][0]).toMatchObject({
      TimelineRef: 'tl1',
      name: 'Main Track',
      layer: 0,
    });
    expect(result.tracks).toHaveLength(1);
  });

  it('creates named tracks layered bottom-up from 0', async () => {
    const stubs = timelineStubs();
    const pb = fakePb(stubs);

    await createTimeline(pb, {
      workspaceId: 'ws1',
      name: 'Ep 4',
      tracks: ['Music', 'Interview', 'B-Roll'],
    });

    const calls = stubs.TimelineTracks.create.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][0]).toMatchObject({ name: 'Music', layer: 0 });
    expect(calls[1][0]).toMatchObject({ name: 'Interview', layer: 1 });
    expect(calls[2][0]).toMatchObject({ name: 'B-Roll', layer: 2 });
  });

  it('rejects more than MAX_TIMELINE_TRACKS tracks before creating anything', async () => {
    const stubs = timelineStubs();
    const pb = fakePb(stubs);

    await expect(
      createTimeline(pb, {
        workspaceId: 'ws1',
        name: 'Too many',
        tracks: ['a', 'b', 'c', 'd', 'e'],
      })
    ).rejects.toThrow(/at most 4 tracks/i);
    expect(stubs.Timelines.create).not.toHaveBeenCalled();
  });
});

describe('syncTimelineDuration', () => {
  it('persists the computed duration (furthest end), not the clip sum', async () => {
    const stubs = timelineStubs({
      tracks: [
        { id: 't0', layer: 0, TimelineRef: 'tl1' },
        { id: 't1', layer: 1, TimelineRef: 'tl1' },
      ],
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 't0',
          MediaRef: 'm1',
          order: 0,
          start: 0,
          end: 10,
          duration: 10,
          timelineStart: 0,
        },
        // overlapping overlay: sum would be 14, computed max end is 10
        {
          id: 'c2',
          TimelineTrackRef: 't1',
          MediaRef: 'm1',
          order: 1,
          start: 0,
          end: 4,
          duration: 4,
          timelineStart: 2,
        },
      ],
      timeline: { id: 'tl1', WorkspaceRef: 'ws1', duration: 14, version: 1 },
    });
    const pb = fakePb(stubs);

    const duration = await syncTimelineDuration(pb, 'tl1');

    expect(duration).toBe(10);
    expect(stubs.Timelines.update.mock.calls[0][0]).toBe('tl1');
    expect(stubs.Timelines.update.mock.calls[0][1]).toEqual({ duration: 10 });
  });

  it('skips the write when the stored duration is already accurate', async () => {
    const stubs = timelineStubs({
      timeline: { id: 'tl1', WorkspaceRef: 'ws1', duration: 0, version: 1 },
    });
    const pb = fakePb(stubs);

    await syncTimelineDuration(pb, 'tl1');
    expect(stubs.Timelines.update).not.toHaveBeenCalled();
  });
});

describe('createRender', () => {
  it('rejects rendering an empty timeline', async () => {
    const pb = fakePb({
      TimelineClips: { getList: vi.fn(async () => listResult([])) },
    });

    await expect(
      createRender(pb, { timelineId: 'tl1', outputSettings: OUTPUT })
    ).rejects.toThrow(/no clips/i);
  });

  it('creates a queued TimelineRender with generated tracks', async () => {
    const clip = {
      id: 'clip1',
      TimelineRef: 'tl1',
      TimelineTrackRef: 'track1',
      MediaRef: 'm1',
      order: 0,
      start: 0,
      end: 60,
      duration: 60,
    };
    const create = vi.fn(async (data) => ({ ...data, id: 'render1' }));
    const pb = fakePb({
      TimelineClips: { getList: vi.fn(async () => listResult([clip])) },
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          duration: 60,
          mediaType: 'video',
        })),
      },
      Timelines: {
        getOne: vi.fn(async () => ({
          id: 'tl1',
          WorkspaceRef: 'ws1',
          version: 2,
        })),
      },
      TimelineTracks: {
        getList: vi.fn(async () =>
          listResult([
            { id: 'track1', layer: 0, opacity: 1, isMuted: false, volume: 1 },
          ])
        ),
      },
      TimelineRenders: { create },
    });

    const render = await createRender(pb, {
      timelineId: 'tl1',
      outputSettings: OUTPUT,
    });

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0][0];
    expect(arg).toMatchObject({
      TimelineRef: 'tl1',
      WorkspaceRef: 'ws1',
      UserRef: 'user1',
      version: 2,
      status: TaskStatus.QUEUED,
    });
    expect(Array.isArray(arg.timelineData)).toBe(true);
    expect(arg.timelineData[0].segments).toHaveLength(1);
    expect(render.id).toBe('render1');
  });
});

/**
 * Stubs routed by timeline for nested-timeline tests: TimelineClips /
 * TimelineTracks lists answer per the filter's timeline id, Timelines
 * getOne per record id.
 */
function nestedTimelineStubs(args: {
  timelines: Record<string, Record<string, unknown>>;
  clipsByTimeline: Record<string, Record<string, unknown>[]>;
  tracksByTimeline: Record<string, Record<string, unknown>[]>;
}): Record<string, Stub> {
  const idFromFilter = (filter?: string): string => {
    const match = /"([^"]+)"/.exec(filter ?? '');
    if (!match) throw new Error(`unexpected filter: ${filter}`);
    return match[1];
  };
  return {
    Media: {
      getOne: vi.fn(async () => ({
        id: 'm1',
        duration: 60,
        mediaType: 'video',
      })),
    },
    Timelines: {
      getOne: vi.fn(async (id: string) => {
        const timeline = args.timelines[id];
        if (!timeline) throw notFound();
        return timeline;
      }),
      update: vi.fn(async (id: string, data: object) => ({
        ...args.timelines[id],
        ...data,
      })),
    },
    TimelineClips: {
      getList: vi.fn(
        async (_p: number, _pp: number, options: { filter?: string }) =>
          listResult(args.clipsByTimeline[idFromFilter(options?.filter)] ?? [])
      ),
      create: vi.fn(async (data) => ({ ...data, id: 'newclip' })),
      update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
    },
    TimelineTracks: {
      getList: vi.fn(
        async (_p: number, _pp: number, options: { filter?: string }) =>
          listResult(args.tracksByTimeline[idFromFilter(options?.filter)] ?? [])
      ),
      create: vi.fn(async (data) => ({ ...data, id: 'newtrack' })),
    },
    TimelineRenders: {
      create: vi.fn(async (data) => ({ ...data, id: 'render1' })),
    },
  };
}

const nestedTrack = (id: string, timelineId: string) => ({
  id,
  layer: 0,
  name: 'Main',
  TimelineRef: timelineId,
  volume: 1,
  opacity: 1,
  isMuted: false,
  isLocked: false,
});

describe('insertClip with a nested timeline', () => {
  // Child tl2: one 8s media clip → live extent 8s. Its stored duration (6)
  // is stale on purpose: inserts must trust the live extent, never the field.
  const baseArgs = () => ({
    timelines: {
      tl1: {
        id: 'tl1',
        name: 'Main',
        WorkspaceRef: 'ws1',
        duration: 0,
        version: 1,
      },
      tl2: {
        id: 'tl2',
        name: 'Intro',
        label: 'Intro sequence',
        WorkspaceRef: 'ws1',
        duration: 6,
      },
    },
    clipsByTimeline: {
      tl1: [] as Record<string, unknown>[],
      tl2: [
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
      ] as Record<string, unknown>[],
    },
    tracksByTimeline: {
      tl1: [nestedTrack('trk1', 'tl1')],
      tl2: [nestedTrack('trk2', 'tl2')],
    },
  });

  it('inserts a full-span clip that follows the live source duration', async () => {
    const stubs = nestedTimelineStubs(baseArgs());
    const pb = fakePb(stubs);

    const result = await insertClip(pb, {
      timelineId: 'tl1',
      sourceTimeline: 'tl2',
    });

    expect(stubs.TimelineClips.create).toHaveBeenCalledOnce();
    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      TimelineRef: 'tl1',
      TimelineTrackRef: 'trk1',
      SourceTimelineRef: 'tl2',
      order: 0,
      start: 0,
      end: 8,
      duration: 8,
      timelineStart: 0,
      meta: { title: 'Intro sequence', followSource: true },
    });
    expect(result.placedEnd).toBe(8);
    expect(result.mode).toBe('append');
  });

  it('trims the source time axis with start/end and stops following', async () => {
    const stubs = nestedTimelineStubs(baseArgs());
    const pb = fakePb(stubs);

    await insertClip(pb, {
      timelineId: 'tl1',
      sourceTimeline: 'tl2',
      start: 2,
      end: 6,
    });

    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      SourceTimelineRef: 'tl2',
      start: 2,
      end: 6,
      duration: 4,
      meta: { followSource: false },
    });
  });

  it('rejects a trim beyond the live source duration', async () => {
    const pb = fakePb(nestedTimelineStubs(baseArgs()));

    await expect(
      insertClip(pb, {
        timelineId: 'tl1',
        sourceTimeline: 'tl2',
        end: 9,
      })
    ).rejects.toThrow(/invalid time range/i);
  });

  it('rejects inserting a timeline into itself', async () => {
    const pb = fakePb(nestedTimelineStubs(baseArgs()));

    await expect(
      insertClip(pb, { timelineId: 'tl2', sourceTimeline: 'tl2' })
    ).rejects.toThrow(/contain itself/i);
  });

  it('rejects a transitive cycle (child already contains the parent)', async () => {
    const args = baseArgs();
    // tl2 nests tl1, so inserting tl2 into tl1 closes the loop.
    args.clipsByTimeline.tl2 = [
      {
        id: 'n1',
        TimelineRef: 'tl2',
        TimelineTrackRef: 'trk2',
        SourceTimelineRef: 'tl1',
        order: 0,
        start: 0,
        end: 5,
        duration: 5,
        timelineStart: 0,
      },
    ];
    const pb = fakePb(nestedTimelineStubs(args));

    await expect(
      insertClip(pb, { timelineId: 'tl1', sourceTimeline: 'tl2' })
    ).rejects.toThrow(/contain itself/i);
  });

  it('rejects an empty source timeline', async () => {
    const args = baseArgs();
    args.clipsByTimeline.tl2 = [];
    const pb = fakePb(nestedTimelineStubs(args));

    await expect(
      insertClip(pb, { timelineId: 'tl1', sourceTimeline: 'tl2' })
    ).rejects.toThrow(/no placed clips/i);
  });

  it('rejects combining sourceTimeline with media', async () => {
    const pb = fakePb(nestedTimelineStubs(baseArgs()));

    await expect(
      insertClip(pb, { timelineId: 'tl1', media: 'm1', sourceTimeline: 'tl2' })
    ).rejects.toThrow(/mutually exclusive/);
  });
});

describe('createRender with nested timelines', () => {
  const renderArgs = () => ({
    timelines: {
      tl1: { id: 'tl1', name: 'Main', WorkspaceRef: 'ws1', version: 3 },
      tl2: { id: 'tl2', name: 'Intro', WorkspaceRef: 'ws1', duration: 8 },
    },
    clipsByTimeline: {
      tl1: [
        {
          id: 'n1',
          TimelineRef: 'tl1',
          TimelineTrackRef: 'trk1',
          SourceTimelineRef: 'tl2',
          order: 0,
          start: 0,
          end: 8,
          duration: 8,
          timelineStart: 0,
          meta: { title: 'Intro', followSource: true },
        },
      ] as Record<string, unknown>[],
      tl2: [
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
      ] as Record<string, unknown>[],
    },
    tracksByTimeline: {
      tl1: [nestedTrack('trk1', 'tl1')],
      tl2: [nestedTrack('trk2', 'tl2')],
    },
  });

  it("flattens a nested clip's media into the render snapshot", async () => {
    const stubs = nestedTimelineStubs(renderArgs());
    const pb = fakePb(stubs);

    const render = await createRender(pb, {
      timelineId: 'tl1',
      outputSettings: OUTPUT,
    });

    expect(render.id).toBe('render1');
    const arg = stubs.TimelineRenders.create.mock.calls[0][0];
    const segments = arg.timelineData.flatMap(
      (t: { segments: { assetId?: string }[] }) => t.segments
    );
    expect(segments.some((s: { assetId?: string }) => s.assetId === 'm1')).toBe(
      true
    );
  });

  it('rejects a nested clip whose source timeline is gone', async () => {
    const args = renderArgs();
    delete (args.timelines as Record<string, unknown>).tl2;
    const pb = fakePb(nestedTimelineStubs(args));

    await expect(
      createRender(pb, { timelineId: 'tl1', outputSettings: OUTPUT })
    ).rejects.toThrow(/missing timeline tl2/);
  });
});

describe('insertClip with a composite MediaClip', () => {
  it('stores the effective (gap-skipping) duration and places by it', async () => {
    const stubs = timelineStubs({
      mediaClip: {
        id: 'mc1',
        MediaRef: 'm1',
        type: 'composite',
        start: 0,
        end: 30,
        duration: 20,
        clipData: {
          segments: [
            { start: 0, end: 10 },
            { start: 20, end: 30 },
          ],
        },
      },
    });
    const pb = fakePb(stubs);

    const result = await insertClip(pb, { timelineId: 'tl1', clip: 'mc1' });

    expect(stubs.TimelineClips.create.mock.calls[0][0]).toMatchObject({
      MediaClipRef: 'mc1',
      start: 0,
      end: 30,
      // effective duration (segment sum), not end - start
      duration: 20,
      timelineStart: 0,
    });
    expect(result.placedEnd).toBe(20);
  });
});
