import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineService } from '../timeline';
import type { TypedPocketBase } from '@project/shared/types';
import type {
  ClipDropPlan,
  Media,
  Timeline,
  TimelineClip,
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

const emptyPlan = (
  mode: ClipDropPlan['mode'],
  timelineStart: number
): ClipDropPlan => ({
  mode,
  timelineStart,
  moves: [],
  trims: [],
  removals: [],
});

describe('TimelineService.applyClipDrop', () => {
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

  it('applies insert-mode shifts and places the dragged clip', async () => {
    // mover [0,4), b [6,9), c [10,12) — drop mover at 5, pushing b and c
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 4 },
      { timelineStart: 6, duration: 3 },
      { timelineStart: 10, duration: 2 },
    ]);
    const [moverId, bId, cId] = clipIds;

    const result = await service.applyClipDrop(moverId, 'track-a', {
      mode: 'insert',
      timelineStart: 5,
      moves: [
        { clipId: bId, timelineStart: 9 },
        { clipId: cId, timelineStart: 13 },
      ],
      trims: [],
      removals: [],
    });

    expect(result.placedClip.timelineStart).toBe(5);
    expect(result.movedClips.map((c) => c.id)).toEqual([bId, cId]);
    expect(result.trimmedClips).toEqual([]);
    expect(result.removedIds).toEqual([]);
    expect((await getClip(moverId)).timelineStart).toBe(5);
    expect((await getClip(bId)).timelineStart).toBe(9);
    expect((await getClip(cId)).timelineStart).toBe(13);
  });

  it('moves the clip to the target track on a cross-track drop', async () => {
    const { timeline, clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 4 },
    ]);
    const trackB = await (service as any).timelineTrackMutator.create({
      TimelineRef: timeline.id,
      name: 'Track B',
      layer: 1,
    });

    const result = await service.applyClipDrop(
      clipIds[0],
      trackB.id,
      emptyPlan('insert', 2)
    );

    expect(result.placedClip.TimelineTrackRef).toBe(trackB.id);
    expect(result.placedClip.timelineStart).toBe(2);
  });

  it('never destroys victims when the dragged clip placement fails', async () => {
    // The damage-ordering guarantee: trims and removals run only after the
    // dragged clip is safely placed. A placement failure (network blip,
    // concurrently deleted track) must leave every victim intact.
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 6 },
      { timelineStart: 6, duration: 3 },
      { timelineStart: 10, duration: 2 },
    ]);
    const [moverId, bId, cId] = clipIds;

    const mutator = (service as any).timelineClipMutator;
    const realUpdate = mutator.update.bind(mutator);
    vi.spyOn(mutator, 'update').mockImplementation(
      async (...args: unknown[]) => {
        if (args[0] === moverId) throw new Error('Simulated network failure');
        return realUpdate(...(args as [string, Record<string, unknown>]));
      }
    );
    const deleteSpy = vi.spyOn(mutator, 'delete');

    await expect(
      service.applyClipDrop(moverId, 'track-a', {
        mode: 'overwrite',
        timelineStart: 5,
        moves: [],
        trims: [
          { clipId: bId, start: 0, end: 2, duration: 2, timelineStart: 6 },
        ],
        removals: [cId],
      })
    ).rejects.toThrow('Simulated network failure');

    expect(deleteSpy).not.toHaveBeenCalled();
    const b = await getClip(bId);
    expect(b.end).toBe(3);
    expect(b.timelineStart).toBe(6);
    await expect(getClip(cId)).resolves.toBeTruthy();
    expect((await getClip(moverId)).timelineStart).toBe(0);
  });

  it('throws on a partial bulk removal, after the dragged clip landed', async () => {
    // mover (6s) dropped at 6 covers v1 [6,8) and v2 [8,10) entirely
    const { clipIds } = await seedTimeline([
      { timelineStart: 0, duration: 6 },
      { timelineStart: 6, duration: 2 },
      { timelineStart: 8, duration: 2 },
    ]);
    const [moverId, v1, v2] = clipIds;

    const mutator = (service as any).timelineClipMutator;
    const realDelete = mutator.delete.bind(mutator);
    vi.spyOn(mutator, 'delete').mockImplementation(
      async (...args: unknown[]) => {
        if (args[0] === v1) throw new Error('Simulated delete failure');
        return realDelete(args[0] as string);
      }
    );

    await expect(
      service.applyClipDrop(moverId, 'track-a', {
        mode: 'overwrite',
        timelineStart: 6,
        moves: [],
        trims: [],
        removals: [v1, v2],
      })
    ).rejects.toThrow(/Failed to remove 1 of 2/);

    // The failure is surfaced (so callers re-sync), but the writes that
    // landed before it stand: the placement and the successful removal.
    expect((await getClip(moverId)).timelineStart).toBe(6);
    await expect(getClip(v1)).resolves.toBeTruthy();
    await expect(getClip(v2)).rejects.toThrow();
  });

  it('clears followSource when overwrite trims a nested-timeline victim', async () => {
    addMockMedia('media-1', 100);

    // Source timeline with 10s of content (its own auto-created track)
    const source = await service.createTimeline('ws-1', 'Source');
    await service.addClipToTimeline(source.id, 'media-1', 0, 10);

    // Parent: mover [0,4) and a full-span nested clip [6,16)
    const parent = await service.createTimeline('ws-1', 'Parent');
    const mover = await service.addClipToTimeline(
      parent.id,
      'media-1',
      0,
      4,
      undefined,
      'track-a',
      0
    );
    const nestedClip = await service.addTimelineToTimeline(
      parent.id,
      source.id,
      'track-a',
      6
    );
    expect(nestedClip.meta?.followSource).toBe(true);

    // Drop mover at 4, covering [4,8): the nested victim loses its head and
    // keeps [2,10) pinned at the drop end
    await service.applyClipDrop(mover.id, 'track-a', {
      mode: 'overwrite',
      timelineStart: 4,
      moves: [],
      trims: [
        {
          clipId: nestedClip.id,
          start: 2,
          end: 10,
          duration: 8,
          timelineStart: 8,
        },
      ],
      removals: [],
    });

    // Routed through updateClipTimes: a real trim stops following the
    // source's live duration, so reflow can never re-expand it and undo
    // the overwrite
    const trimmed = await getClip(nestedClip.id);
    expect(trimmed.meta.followSource).toBe(false);
    expect(trimmed.start).toBe(2);
    expect(trimmed.end).toBe(10);
    expect(trimmed.duration).toBe(8);
    expect(trimmed.timelineStart).toBe(8);
  });
});
