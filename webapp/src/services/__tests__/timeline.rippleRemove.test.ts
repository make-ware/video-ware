import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineService } from '../timeline';
import type { TypedPocketBase } from '@project/shared/types';
import type {
  Timeline,
  TimelineClip,
  Media,
  TimelineTrackRecord,
} from '@project/shared';
import { MediaType } from '@project/shared';
import { createGenericMockCollection } from '@/test/__tests__/fixtures/pocketbase';

function createMockPocketBase() {
  let clipIdCounter = 0;

  const timelinesCollection = createGenericMockCollection<Timeline>(
    'Timelines',
    () => `tl-${Math.random().toString(36).substring(7)}`
  );

  const timelineClipsCollection = createGenericMockCollection<TimelineClip>(
    'TimelineClips',
    () => `clip-${++clipIdCounter}`
  );

  const timelineTracksCollection =
    createGenericMockCollection<TimelineTrackRecord>(
      'TimelineTracks',
      () => `track-${Math.random().toString(36).substring(7)}`
    );

  const mediaCollection = createGenericMockCollection<Media>(
    'Media',
    () => `media-${Math.random().toString(36).substring(7)}`
  );

  const pb = {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'Timelines') return timelinesCollection;
      if (name === 'TimelineClips') return timelineClipsCollection;
      if (name === 'TimelineTracks') return timelineTracksCollection;
      if (name === 'Media') return mediaCollection;
      return createGenericMockCollection(name);
    },
  } as unknown as TypedPocketBase;

  const addMockMedia = (id: string, duration: number) => {
    mediaCollection._storage.set(id, {
      id,
      collectionId: 'media',
      collectionName: 'Media',
      duration,
      mediaType: MediaType.VIDEO,
      width: 1920,
      height: 1080,
      hasAudio: true,
      mediaData: { video: {}, audio: {} },
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    } as any);
  };

  return { pb, addMockMedia };
}

describe('TimelineService.rippleRemoveClipsFromTimeline', () => {
  let service: TimelineService;
  let pb: TypedPocketBase;
  let addMockMedia: (id: string, duration: number) => void;

  beforeEach(() => {
    const mock = createMockPocketBase();
    pb = mock.pb;
    addMockMedia = mock.addMockMedia;
    service = new TimelineService(pb);
  });

  /**
   * Helper: create a timeline and add pinned clips at the given timeline
   * positions (each with the given duration), all on one track unless a
   * per-clip trackId is provided. Returns clip IDs in seed order.
   */
  async function seedTimeline(
    placements: Array<{
      timelineStart: number;
      duration: number;
      trackId?: string;
    }>
  ) {
    addMockMedia('media-1', 100);
    const timeline = await service.createTimeline('ws-1', 'Test TL');
    const clipIds: string[] = [];
    for (const { timelineStart, duration, trackId } of placements) {
      const clip = await service.addClipToTimeline(
        timeline.id,
        'media-1',
        0,
        duration,
        undefined,
        trackId ?? 'track-a',
        timelineStart
      );
      clipIds.push(clip.id);
    }
    return { timeline, clipIds };
  }

  async function getClip(clipId: string) {
    return (pb.collection('TimelineClips') as any).getOne(clipId);
  }

  it('shifts following clips left to close the gap', async () => {
    // [0,3], [3,8], [8,10] — delete the middle 5s clip
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 3 },
      { timelineStart: 3, duration: 5 },
      { timelineStart: 8, duration: 2 },
    ]);

    const result = await service.rippleRemoveClipsFromTimeline([clipIds[1]]);
    expect(result.succeeded).toEqual([clipIds[1]]);
    expect(result.failed).toEqual([]);

    expect((await getClip(clipIds[0])).timelineStart).toBe(0);
    expect((await getClip(clipIds[2])).timelineStart).toBe(3);
  });

  it('preserves gaps that existed before the deleted clip range', async () => {
    // [0,3], gap, [5,8], gap, [10,12] — delete the middle clip; the last
    // clip closes only the deleted 3s extent
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 3 },
      { timelineStart: 5, duration: 3 },
      { timelineStart: 10, duration: 2 },
    ]);

    await service.rippleRemoveClipsFromTimeline([clipIds[1]]);

    expect((await getClip(clipIds[2])).timelineStart).toBe(7);
  });

  it('accumulates shifts across multiple deleted clips', async () => {
    // [0,2], [2,5], [5,6], [6,10] — delete clips 0 and 2
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 2 },
      { timelineStart: 2, duration: 3 },
      { timelineStart: 5, duration: 1 },
      { timelineStart: 6, duration: 4 },
    ]);

    await service.rippleRemoveClipsFromTimeline([clipIds[0], clipIds[2]]);

    expect((await getClip(clipIds[1])).timelineStart).toBe(0);
    expect((await getClip(clipIds[3])).timelineStart).toBe(3);
  });

  it('does not move clips on other tracks', async () => {
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 3, trackId: 'track-a' },
      { timelineStart: 3, duration: 3, trackId: 'track-a' },
      { timelineStart: 4, duration: 2, trackId: 'track-b' },
    ]);

    await service.rippleRemoveClipsFromTimeline([clipIds[0]]);

    expect((await getClip(clipIds[1])).timelineStart).toBe(0);
    expect((await getClip(clipIds[2])).timelineStart).toBe(4);
  });

  it('only shifts for clips that actually got deleted on partial failure', async () => {
    // [0,2], [2,4], [4,6] — deleting clips 0 and 1, but clip 0 fails
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 2 },
      { timelineStart: 2, duration: 2 },
      { timelineStart: 4, duration: 2 },
    ]);

    const mutator = (service as any).timelineClipMutator;
    const realDelete = mutator.delete.bind(mutator);
    vi.spyOn(mutator, 'delete').mockImplementation(
      async (...args: unknown[]) => {
        const id = args[0] as string;
        if (id === clipIds[0]) throw new Error('Not found');
        return realDelete(id);
      }
    );

    const result = await service.rippleRemoveClipsFromTimeline([
      clipIds[0],
      clipIds[1],
    ]);
    expect(result.succeeded).toEqual([clipIds[1]]);
    expect(result.failed).toHaveLength(1);

    // Only clip 1's 2s extent collapses; the surviving clip 0 stays put
    expect((await getClip(clipIds[0])).timelineStart).toBe(0);
    expect((await getClip(clipIds[2])).timelineStart).toBe(2);
  });

  it('returns empty result for empty input', async () => {
    const result = await service.rippleRemoveClipsFromTimeline([]);
    expect(result).toEqual({ succeeded: [], failed: [] });
  });
});
