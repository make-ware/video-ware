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

  const tasksCollection = createGenericMockCollection<any>('Tasks');
  const mediaClipsCollection = createGenericMockCollection<any>('MediaClips');

  const pb = {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'Timelines') return timelinesCollection;
      if (name === 'TimelineClips') return timelineClipsCollection;
      if (name === 'TimelineTracks') return timelineTracksCollection;
      if (name === 'Media') return mediaCollection;
      if (name === 'Tasks') return tasksCollection;
      if (name === 'MediaClips') return mediaClipsCollection;
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

  return { pb, timelineClipsCollection, addMockMedia };
}

describe('TimelineService.bulkRemoveClipsFromTimeline', () => {
  let service: TimelineService;
  let pb: TypedPocketBase;
  let clipsCollection: ReturnType<
    typeof createGenericMockCollection<TimelineClip>
  >;
  let addMockMedia: (id: string, duration: number) => void;

  beforeEach(() => {
    const mock = createMockPocketBase();
    pb = mock.pb;
    clipsCollection = mock.timelineClipsCollection;
    addMockMedia = mock.addMockMedia;
    service = new TimelineService(pb);
  });

  /** Helper: create a timeline, add media, add N clips, return clip IDs */
  async function seedTimeline(clipCount: number) {
    addMockMedia('media-1', 100);
    const timeline = await service.createTimeline('ws-1', 'Test TL');
    const clipIds: string[] = [];
    for (let i = 0; i < clipCount; i++) {
      const clip = await service.addClipToTimeline(
        timeline.id,
        'media-1',
        i * 10,
        (i + 1) * 10
      );
      clipIds.push(clip.id);
    }
    return { timeline, clipIds };
  }

  it('removes a single clip successfully', async () => {
    const { clipIds } = await seedTimeline(3);
    const result = await service.bulkRemoveClipsFromTimeline([clipIds[1]]);
    expect(result.succeeded).toEqual([clipIds[1]]);
    expect(result.failed).toEqual([]);
  });

  it('removes multiple clips successfully', async () => {
    const { clipIds } = await seedTimeline(4);
    const toRemove = [clipIds[0], clipIds[2]];
    const result = await service.bulkRemoveClipsFromTimeline(toRemove);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  // The mutator's delete() catches errors internally and returns false,
  // so bulkRemoveClipsFromTimeline's Promise.allSettled always sees fulfilled
  // promises. The tests below mock the mutator to throw, simulating a raw error.

  it('reports failure when mutator throws on delete', async () => {
    const { clipIds } = await seedTimeline(2);
    const mutator = (service as any).timelineClipMutator;
    const realDelete = mutator.delete.bind(mutator);
    vi.spyOn(mutator, 'delete').mockImplementation(
      async (...args: unknown[]) => {
        const id = args[0] as string;
        if (id === 'bad-id') throw new Error('Not found');
        return realDelete(id);
      }
    );

    const result = await service.bulkRemoveClipsFromTimeline([
      clipIds[0],
      'bad-id',
    ]);
    expect(result.succeeded).toContain(clipIds[0]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('bad-id');
    expect(result.failed[0].error).toBe('Not found');
  });

  it('handles partial failure with correct split', async () => {
    const { clipIds } = await seedTimeline(3);
    const mutator = (service as any).timelineClipMutator;
    const realDelete = mutator.delete.bind(mutator);
    vi.spyOn(mutator, 'delete').mockImplementation(
      async (...args: unknown[]) => {
        const id = args[0] as string;
        if (id === 'bad-id') throw new Error('Not found');
        return realDelete(id);
      }
    );

    const result = await service.bulkRemoveClipsFromTimeline([
      clipIds[0],
      'bad-id',
      clipIds[2],
    ]);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
  });

  it('returns empty result for empty input', async () => {
    const result = await service.bulkRemoveClipsFromTimeline([]);
    expect(result).toEqual({ succeeded: [], failed: [] });
  });

  it('removes all clips from a timeline', async () => {
    const { timeline, clipIds } = await seedTimeline(3);
    const result = await service.bulkRemoveClipsFromTimeline(clipIds);
    expect(result.succeeded).toHaveLength(3);
    expect(result.failed).toHaveLength(0);

    // Verify no clips remain
    const remaining = await (pb.collection('TimelineClips') as any).getFullList(
      {
        filter: `TimelineRef = "${timeline.id}"`,
      }
    );
    expect(remaining).toHaveLength(0);
  });

  it('remaining clips have sequential order after removal', async () => {
    const { timeline, clipIds } = await seedTimeline(5);
    // Remove clips at indices 1 and 3
    await service.bulkRemoveClipsFromTimeline([clipIds[1], clipIds[3]]);

    // Get remaining clips sorted by order
    const remaining = await (pb.collection('TimelineClips') as any).getFullList(
      {
        filter: `TimelineRef = "${timeline.id}"`,
        sort: 'order',
      }
    );

    expect(remaining).toHaveLength(3);
    // Orders should be sequential: 0, 1, 2
    const orders = remaining.map((c: any) => c.order);
    expect(orders).toEqual([0, 1, 2]);
  });
});
