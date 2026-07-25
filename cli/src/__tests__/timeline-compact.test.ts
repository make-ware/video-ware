import { describe, expect, it, vi } from 'vitest';
import { RecordConflictError } from '@project/shared';
import { compactTimeline } from '../lib/timeline-compact.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

interface StubOptions {
  tracks?: Record<string, unknown>[];
  clips?: Record<string, unknown>[];
}

function compactStubs(opts: StubOptions = {}): Record<string, Stub> {
  const {
    tracks = [
      { id: 'trk0', layer: 0, name: 'Main', TimelineRef: 'tl1' },
      { id: 'trk1', layer: 1, name: 'B-Roll', TimelineRef: 'tl1' },
    ],
    clips = [],
  } = opts;
  return {
    Timelines: {
      getOne: vi.fn(async () => ({
        id: 'tl1',
        WorkspaceRef: 'ws1',
        duration: 0,
      })),
      update: vi.fn(async (_id: string, data: object) => ({ ...data })),
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
      getOne: vi.fn(async (id: string) => {
        const clip = clips.find((c) => c.id === id);
        if (!clip) throw notFound();
        return clip;
      }),
      update: vi.fn(async (id: string, data: object) => ({
        ...clips.find((c) => c.id === id),
        ...data,
      })),
    },
  };
}

const clip = (over: Record<string, unknown>) => ({
  TimelineRef: 'tl1',
  TimelineTrackRef: 'trk0',
  MediaRef: 'm1',
  order: 0,
  start: 0,
  end: 5,
  duration: 5,
  updated: 'v1',
  ...over,
});

describe('compactTimeline', () => {
  it('closes gaps using composite effective footprints', async () => {
    const clips = [
      // Composite: span 16s, effective 10s — the next clip must land at 10.
      clip({
        id: 'a',
        start: 0,
        end: 16,
        duration: 10,
        timelineStart: 0,
        meta: {
          segments: [
            { start: 0, end: 4 },
            { start: 10, end: 16 },
          ],
        },
      }),
      // Sits at 20 — a 10s gap after the composite's effective end.
      clip({ id: 'b', order: 1, timelineStart: 20 }),
      // Flush after b's new position once b moves to 10.
      clip({ id: 'c', order: 2, timelineStart: 25 }),
    ];
    const stubs = compactStubs({ clips });
    const pb = fakePb(stubs);

    const result = await compactTimeline(pb, 'tl1');

    expect(result.applied).toBe(true);
    expect(result.moveCount).toBe(2);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].moves).toEqual([
      { clipId: 'b', from: 20, to: 10 },
      { clipId: 'c', from: 25, to: 15 },
    ]);
    expect(result.tracks[0].closedGapSeconds).toBe(10);
    const updates = stubs.TimelineClips.update.mock.calls;
    expect(updates.map((c: unknown[]) => c[0])).toEqual(['b', 'c']);
    expect(updates[0][1]).toEqual({ timelineStart: 10 });
  });

  it('is idempotent — a flush layout is a no-op', async () => {
    const clips = [
      clip({ id: 'a', timelineStart: 0 }),
      clip({ id: 'b', order: 1, timelineStart: 5 }),
    ];
    const stubs = compactStubs({ clips });
    const pb = fakePb(stubs);

    const result = await compactTimeline(pb, 'tl1');

    expect(result.moveCount).toBe(0);
    expect(result.applied).toBe(false);
    expect(result.warnings[0].message).toMatch(/already flush/i);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('scopes to one track with --track', async () => {
    const clips = [
      clip({ id: 'a', timelineStart: 3 }),
      clip({
        id: 'broll',
        order: 1,
        TimelineTrackRef: 'trk1',
        timelineStart: 8,
      }),
    ];
    const stubs = compactStubs({ clips });
    const pb = fakePb(stubs);

    const result = await compactTimeline(pb, 'tl1', { track: '0' });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].layer).toBe(0);
    expect(result.tracks[0].moves).toEqual([{ clipId: 'a', from: 3, to: 0 }]);
    // The other lane's clip was never touched.
    const touched = stubs.TimelineClips.update.mock.calls.map(
      (c: unknown[]) => c[0]
    );
    expect(touched).toEqual(['a']);
  });

  it('dry-run reports the plan without writing', async () => {
    const clips = [clip({ id: 'a', timelineStart: 7 })];
    const stubs = compactStubs({ clips });
    const pb = fakePb(stubs);

    const result = await compactTimeline(pb, 'tl1', { dryRun: true });

    expect(result.applied).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.moveCount).toBe(1);
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('pins legacy clips even when they do not move', async () => {
    const clips = [
      // Sequential (no explicit position, no track ref) — already at 0.
      clip({
        id: 'legacy',
        TimelineTrackRef: undefined,
        timelineStart: undefined,
      }),
    ];
    const stubs = compactStubs({ clips });
    const pb = fakePb(stubs);

    const result = await compactTimeline(pb, 'tl1');

    expect(result.moveCount).toBe(1);
    expect(stubs.TimelineClips.update.mock.calls[0][1]).toEqual({
      timelineStart: 0,
      TimelineTrackRef: 'trk0',
    });
  });

  it('aborts before any write when a planned clip changed concurrently', async () => {
    const clips = [
      clip({ id: 'a', timelineStart: 7 }),
      clip({ id: 'b', order: 1, timelineStart: 20 }),
    ];
    const stubs = compactStubs({ clips });
    // The pre-write re-read sees a fresher `b`.
    stubs.TimelineClips.getList = vi
      .fn()
      .mockResolvedValueOnce(listResult(clips))
      .mockResolvedValueOnce(
        listResult([clips[0], { ...clips[1], updated: 'v2' }])
      );
    const pb = fakePb(stubs);

    await expect(compactTimeline(pb, 'tl1')).rejects.toThrow(
      RecordConflictError
    );
    expect(stubs.TimelineClips.update).not.toHaveBeenCalled();
  });
});
