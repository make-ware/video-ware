import { describe, expect, it, vi } from 'vitest';
import {
  createTrack,
  deleteTrack,
  parseLayer,
  resolveTrackArg,
  updateTrack,
  listTracks,
} from '../lib/timeline-track.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

interface StubOptions {
  tracks?: Record<string, unknown>[];
  clips?: Record<string, unknown>[];
  timeline?: Record<string, unknown>;
}

function trackStubs(opts: StubOptions = {}): Record<string, Stub> {
  const {
    tracks = [{ id: 'trk0', layer: 0, name: 'Main Track', TimelineRef: 'tl1' }],
    clips = [],
    timeline = { id: 'tl1', WorkspaceRef: 'ws1', duration: 0, version: 1 },
  } = opts;
  return {
    TimelineTracks: {
      getList: vi.fn(async () => listResult(tracks)),
      getOne: vi.fn(async (id: string) => {
        const track = tracks.find((t) => t.id === id);
        if (!track) throw notFound();
        return track;
      }),
      create: vi.fn(async (data) => ({ ...data, id: 'newtrack' })),
      update: vi.fn(async (id: string, data: object) => ({
        ...tracks.find((t) => t.id === id),
        ...data,
      })),
      delete: vi.fn(async () => true),
    },
    TimelineClips: {
      getList: vi.fn(async () => listResult(clips)),
      update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
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

describe('parseLayer', () => {
  it('accepts non-negative integers and rejects everything else', () => {
    expect(parseLayer('2')).toBe(2);
    expect(() => parseLayer('-1')).toThrow(/non-negative integer/i);
    expect(() => parseLayer('1.5')).toThrow(/non-negative integer/i);
    expect(() => parseLayer('abc')).toThrow(/non-negative integer/i);
  });
});

describe('createTrack', () => {
  it('creates on the next layer up with the default name', async () => {
    const stubs = trackStubs({
      tracks: [
        { id: 'trk0', layer: 0, TimelineRef: 'tl1' },
        { id: 'trk1', layer: 1, TimelineRef: 'tl1' },
      ],
    });
    const pb = fakePb(stubs);

    await createTrack(pb, { timelineId: 'tl1' });

    expect(stubs.TimelineTracks.create.mock.calls[0][0]).toMatchObject({
      TimelineRef: 'tl1',
      name: 'Track 2',
      layer: 2,
    });
  });

  it('passes settings through, mapping muted/locked to schema fields', async () => {
    const stubs = trackStubs({ tracks: [] });
    const pb = fakePb(stubs);

    await createTrack(pb, {
      timelineId: 'tl1',
      name: 'Music',
      label: 'Ambient bed',
      volume: 0.4,
      opacity: 0.8,
      muted: true,
      locked: true,
    });

    expect(stubs.TimelineTracks.create.mock.calls[0][0]).toMatchObject({
      name: 'Music',
      label: 'Ambient bed',
      layer: 0,
      volume: 0.4,
      opacity: 0.8,
      isMuted: true,
      isLocked: true,
    });
  });

  it('enforces the track cap', async () => {
    const tracks = [0, 1, 2, 3].map((layer) => ({
      id: `trk${layer}`,
      layer,
      TimelineRef: 'tl1',
    }));
    const stubs = trackStubs({ tracks });
    const pb = fakePb(stubs);

    await expect(createTrack(pb, { timelineId: 'tl1' })).rejects.toThrow(
      /max 4/i
    );
    expect(stubs.TimelineTracks.create).not.toHaveBeenCalled();
  });
});

describe('listTracks', () => {
  it('counts clips per track, attributing orphans to the layer-0 track', async () => {
    const stubs = trackStubs({
      tracks: [
        { id: 'trk0', layer: 0, TimelineRef: 'tl1' },
        { id: 'trk1', layer: 1, TimelineRef: 'tl1' },
      ],
      clips: [
        { id: 'c1', TimelineTrackRef: 'trk1', order: 0, start: 0, end: 1 },
        { id: 'c2', order: 1, start: 0, end: 1 }, // orphan → layer 0
      ],
    });
    const pb = fakePb(stubs);

    const result = await listTracks(pb, 'tl1');
    expect(result.items.map((r) => r.clipCount)).toEqual([1, 1]);
  });
});

describe('resolveTrackArg', () => {
  it('requires a timeline id for bare layer numbers', async () => {
    const pb = fakePb(trackStubs());
    await expect(resolveTrackArg(pb, '1')).rejects.toThrow(/-t <timelineId>/i);
  });

  it('resolves record ids without a timeline id', async () => {
    const pb = fakePb(trackStubs());
    const track = await resolveTrackArg(pb, 'trk0');
    expect(track.id).toBe('trk0');
  });
});

describe('updateTrack', () => {
  it('patches settings on the resolved track', async () => {
    const stubs = trackStubs();
    const pb = fakePb(stubs);

    await updateTrack(pb, {
      track: 'trk0',
      volume: 0.5,
      muted: true,
    });

    expect(stubs.TimelineTracks.update.mock.calls[0][0]).toBe('trk0');
    expect(stubs.TimelineTracks.update.mock.calls[0][1]).toEqual({
      volume: 0.5,
      isMuted: true,
    });
  });

  it('rejects an empty patch', async () => {
    const pb = fakePb(trackStubs());
    await expect(updateTrack(pb, { track: 'trk0' })).rejects.toThrow(
      /nothing to update/i
    );
  });

  it('swaps layers with the current holder', async () => {
    const stubs = trackStubs({
      tracks: [
        { id: 'trk0', layer: 0, TimelineRef: 'tl1' },
        { id: 'trk1', layer: 1, TimelineRef: 'tl1' },
      ],
    });
    const pb = fakePb(stubs);

    const result = await updateTrack(pb, { track: 'trk0', layer: 1 });

    const calls = stubs.TimelineTracks.update.mock.calls;
    expect(calls[0][0]).toBe('trk1');
    expect(calls[0][1]).toEqual({ layer: 0 });
    expect(calls[1][0]).toBe('trk0');
    expect(calls[1][1]).toEqual({ layer: 1 });
    expect(result.swappedWith?.id).toBe('trk1');
  });

  it('just sets the layer when it is unoccupied', async () => {
    const stubs = trackStubs();
    const pb = fakePb(stubs);

    const result = await updateTrack(pb, { track: 'trk0', layer: 3 });

    expect(stubs.TimelineTracks.update).toHaveBeenCalledTimes(1);
    expect(stubs.TimelineTracks.update.mock.calls[0][1]).toEqual({ layer: 3 });
    expect(result.swappedWith).toBeUndefined();
  });
});

describe('deleteTrack', () => {
  it('refuses when the track still has clips', async () => {
    const stubs = trackStubs({
      clips: [
        { id: 'c1', TimelineTrackRef: 'trk0', order: 0, start: 0, end: 1 },
      ],
    });
    const pb = fakePb(stubs);

    await expect(deleteTrack(pb, { track: 'trk0' })).rejects.toThrow(/--clips/);
    expect(stubs.TimelineTracks.delete).not.toHaveBeenCalled();
  });

  it('cascades with --clips, renumbers the rest, and re-syncs duration', async () => {
    const stubs = trackStubs({
      tracks: [
        { id: 'trk0', layer: 0, TimelineRef: 'tl1' },
        { id: 'trk1', layer: 1, TimelineRef: 'tl1' },
      ],
      clips: [
        {
          id: 'c1',
          TimelineTrackRef: 'trk1',
          MediaRef: 'm1',
          order: 0,
          start: 0,
          end: 2,
        },
        {
          id: 'c2',
          TimelineTrackRef: 'trk0',
          MediaRef: 'm1',
          order: 1,
          start: 0,
          end: 3,
        },
      ],
    });
    const pb = fakePb(stubs);

    const result = await deleteTrack(pb, { track: 'trk1', deleteClips: true });

    expect(stubs.TimelineClips.delete).toHaveBeenCalledWith('c1');
    expect(stubs.TimelineTracks.delete).toHaveBeenCalledWith('trk1');
    // c2 renumbered 1 → 0
    expect(stubs.TimelineClips.update.mock.calls[0][0]).toBe('c2');
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({ order: 0 });
    expect(result.deletedClipIds).toEqual(['c1']);
    // duration re-synced from the (stubbed) remaining clips
    expect(stubs.Timelines.getOne).toHaveBeenCalled();
  });

  it('deletes an empty track without touching clips', async () => {
    const stubs = trackStubs();
    const pb = fakePb(stubs);

    await deleteTrack(pb, { track: 'trk0' });

    expect(stubs.TimelineTracks.delete).toHaveBeenCalledWith('trk0');
    expect(stubs.TimelineClips.delete).not.toHaveBeenCalled();
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });
});
