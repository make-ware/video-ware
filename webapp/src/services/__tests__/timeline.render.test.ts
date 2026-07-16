import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineService } from '../timeline';
import type { TypedPocketBase } from '@project/shared/types';
import {
  type Timeline,
  type TimelineClip,
  type Media,
  MediaType,
  RenderFlowConfig,
} from '@project/shared';
import { createGenericMockCollection } from '@/test/__tests__/fixtures/pocketbase';

// Mock generateTracks since it's an imported utility that might be hard to mock via pb alone
// But actually `TimelineService` calls `this.generateTracks`.
// If I use the real `TimelineService`, it calls the real `generateTracks` helper.
// I should rely on the real behavior if possible.

function createMockPocketBase(): TypedPocketBase {
  let timelineIdCounter = 0;
  let clipIdCounter = 0;
  let taskIdCounter = 0;
  let renderIdCounter = 0;

  const timelinesCollection = createGenericMockCollection<Timeline>(
    'Timelines',
    () => `timeline-${++timelineIdCounter}`
  );

  const timelineClipsCollection = createGenericMockCollection<TimelineClip>(
    'TimelineClips',
    () => `clip-${++clipIdCounter}`
  );

  const timelineTracksCollection = createGenericMockCollection<any>(
    'TimelineTracks',
    () => `track-${Math.random().toString(36).substring(7)}`
  );

  const mediaCollection = createGenericMockCollection<Media>(
    'Media',
    () => `media-${Math.random().toString(36).substring(7)}`
  );

  const tasksCollection = createGenericMockCollection<any>(
    'Tasks',
    () => `task-${++taskIdCounter}`
  );

  const timelineRendersCollection = createGenericMockCollection<any>(
    'TimelineRenders',
    () => `render-${++renderIdCounter}`
  );

  const pb = {
    authStore: {
      record: { id: 'user-1' },
    },
    collection: (name: string) => {
      if (name === 'Timelines') return timelinesCollection;
      if (name === 'TimelineClips') return timelineClipsCollection;
      if (name === 'TimelineTracks') return timelineTracksCollection;
      if (name === 'Media') return mediaCollection;
      if (name === 'Tasks') return tasksCollection;
      if (name === 'TimelineRenders') return timelineRendersCollection;
      return createGenericMockCollection(name);
    },
  } as unknown as TypedPocketBase;

  (pb as any).addMockMedia = (id: string, duration: number) => {
    const media: any = {
      id,
      collectionId: 'media',
      collectionName: 'Media',
      duration,
      mediaType: MediaType.VIDEO,
      width: 1920,
      height: 1080,
      hasAudio: true,
      mediaData: { video: {}, audio: {} },
    };
    mediaCollection._storage.set(id, media);
  };

  return pb;
}

describe('TimelineService.createRenderTask (creates a TimelineRender entity)', () => {
  let service: TimelineService;
  let pb: TypedPocketBase;

  beforeEach(() => {
    pb = createMockPocketBase();
    service = new TimelineService(pb);
  });

  it('should create a TimelineRender entity for a valid timeline', async () => {
    // 1. Create Timeline
    const timeline = await service.createTimeline('ws-1', 'My Timeline');

    // 2. Add Media
    (pb as any).addMockMedia('media-1', 100);

    // 3. Add Clip
    await service.addClipToTimeline(timeline.id, 'media-1', 0, 10);

    // 4. Create the render (entity-first; a PB hook spawns the task)
    const config: RenderFlowConfig = {
      format: 'mp4',
      resolution: '1920x1080',
      codec: 'h264',
    };

    const render = await service.createRenderTask(timeline.id, config);

    expect(render).toBeDefined();
    expect(render.id).toContain('render-');

    // The render input lives on the TimelineRender record (the source of truth);
    // no task is created by the client.
    const renders = pb.collection('TimelineRenders') as any;
    const renderRecord = renders._storage.get(render.id);
    expect(renderRecord).toBeDefined();
    expect(renderRecord.TimelineRef).toBe(timeline.id);
    expect(renderRecord.WorkspaceRef).toBe('ws-1');
    expect(renderRecord.status).toBe('queued');
    expect(renderRecord.outputSettings).toEqual(config);
    expect(renderRecord.timelineData).toHaveLength(2); // Layer 0 Video + Layer 0 Audio

    // The client does NOT create a task — the hook does.
    const tasks = pb.collection('Tasks') as any;
    expect(tasks._storage.size).toBe(0);
  });

  it('heals a nested clip whose source timeline shrank instead of failing the render', async () => {
    // Child timeline with a single 10s media clip → playback extent 10s
    const child = await service.createTimeline('ws-1', 'Imported');
    (pb as any).addMockMedia('media-1', 100);
    const childClip = await service.addClipToTimeline(
      child.id,
      'media-1',
      0,
      10
    );

    // Parent imports the child at its full span (follow-source)
    const parent = await service.createTimeline('ws-1', 'Main');
    const nestedClip = await service.addTimelineToTimeline(parent.id, child.id);
    expect(nestedClip.start).toBe(0);
    expect(nestedClip.end).toBe(10);
    expect((nestedClip.meta as any)?.followSource).toBe(true);

    // The child is later shortened to 6s in its own editor — the parent's
    // stored window (end=10) now exceeds the live child extent.
    await service.updateClipTimes(childClip.id, 0, 6);

    const config: RenderFlowConfig = {
      format: 'mp4',
      resolution: '1920x1080',
      codec: 'h264',
    };

    // This used to throw 'Timeline validation failed: Timeline clip time
    // range exceeds source timeline duration'; reflow now heals before
    // validation and the render is created.
    const render = await service.createRenderTask(parent.id, config);
    expect(render).toBeDefined();
    expect(render.id).toContain('render-');

    // Healing is in-memory only: the render is built from healed data while
    // the stored clip stays untouched. Rendering reads a timeline — it must
    // never write to it (persistence belongs to save / `vw timeline reflow`).
    const clipsStorage = (pb.collection('TimelineClips') as any)._storage;
    const stored = clipsStorage.get(nestedClip.id);
    expect(stored.end).toBe(10);
    expect(stored.duration).toBe(10);
  });

  it('loads healed placements without persisting them (getTimeline is a pure read)', async () => {
    const child = await service.createTimeline('ws-1', 'Imported');
    (pb as any).addMockMedia('media-1', 100);
    const childClip = await service.addClipToTimeline(
      child.id,
      'media-1',
      0,
      10
    );

    const parent = await service.createTimeline('ws-1', 'Main');
    const nestedClip = await service.addTimelineToTimeline(parent.id, child.id);
    await service.updateClipTimes(childClip.id, 0, 6);

    const loaded = await service.getTimeline(parent.id);
    const healed = loaded?.clips.find((c) => c.id === nestedClip.id);
    expect(healed?.end).toBe(6);
    expect(healed?.duration).toBe(6);

    // The returned view is healed; the stored clip is not written to.
    const clipsStorage = (pb.collection('TimelineClips') as any)._storage;
    const stored = clipsStorage.get(nestedClip.id);
    expect(stored.end).toBe(10);
    expect(stored.duration).toBe(10);
  });

  it('persists healed clips of the saved timeline only — never nested children', async () => {
    // Grandchild shrinks; both the child's window over it and the parent's
    // window over the child are stale. Saving the parent heals and persists
    // the parent's own clip, but the child's clip (another timeline's data)
    // is healed in memory only.
    const leaf = await service.createTimeline('ws-1', 'Leaf');
    (pb as any).addMockMedia('media-1', 100);
    const leafClip = await service.addClipToTimeline(leaf.id, 'media-1', 0, 10);

    const child = await service.createTimeline('ws-1', 'Child');
    const childNested = await service.addTimelineToTimeline(child.id, leaf.id);

    const parent = await service.createTimeline('ws-1', 'Main');
    const parentNested = await service.addTimelineToTimeline(
      parent.id,
      child.id
    );

    await service.updateClipTimes(leafClip.id, 0, 6);

    await service.saveTimeline(parent.id);

    const clipsStorage = (pb.collection('TimelineClips') as any)._storage;
    // Parent's own clip: healed against the child's healed 6s extent and
    // persisted at the save touchpoint.
    const storedParentClip = clipsStorage.get(parentNested.id);
    expect(storedParentClip.end).toBe(6);
    expect(storedParentClip.duration).toBe(6);
    // Child's clip belongs to the child timeline: left untouched.
    const storedChildClip = clipsStorage.get(childNested.id);
    expect(storedChildClip.end).toBe(10);
    expect(storedChildClip.duration).toBe(10);
  });

  it('clears and restores followSource as the user trims and untrims a nested clip', async () => {
    const child = await service.createTimeline('ws-1', 'Imported');
    (pb as any).addMockMedia('media-1', 100);
    await service.addClipToTimeline(child.id, 'media-1', 0, 10);

    const parent = await service.createTimeline('ws-1', 'Main');
    const nestedClip = await service.addTimelineToTimeline(parent.id, child.id);
    expect((nestedClip.meta as any)?.followSource).toBe(true);

    // Trimming away from the full span stops following the source.
    const trimmed = await service.updateClipTimes(nestedClip.id, 2, 8);
    expect((trimmed.meta as any)?.followSource).toBe(false);
    expect((trimmed.meta as any)?.sourceOutOfRange).toBeUndefined();

    // Untrimming back out to the full span follows it again.
    const untrimmed = await service.updateClipTimes(nestedClip.id, 0, 10);
    expect((untrimmed.meta as any)?.followSource).toBe(true);
  });

  it('should throw error if timeline has no clips', async () => {
    const timeline = await service.createTimeline('ws-1', 'Empty Timeline');

    const config: RenderFlowConfig = {
      format: 'mp4',
      resolution: '1920x1080',
      codec: 'h264',
    };

    await expect(service.createRenderTask(timeline.id, config)).rejects.toThrow(
      'Timeline validation failed: Timeline has no clips'
    );
  });

  it('should throw if user is not authenticated', async () => {
    // Clear user
    (pb.authStore as any).record = null;

    // Setup valid timeline
    const timeline = await service.createTimeline('ws-1', 'My Timeline');
    (pb as any).addMockMedia('media-1', 100);
    await service.addClipToTimeline(timeline.id, 'media-1', 0, 10);

    const config: RenderFlowConfig = {
      format: 'mp4',
      resolution: '1920x1080',
      codec: 'h264',
    };

    await expect(service.createRenderTask(timeline.id, config)).rejects.toThrow(
      'User must be authenticated'
    );
  });
});

describe('TimelineService.saveTimeline / validateTimeline (reflow + duration policy)', () => {
  let service: TimelineService;
  let pb: TypedPocketBase;

  beforeEach(() => {
    pb = createMockPocketBase();
    service = new TimelineService(pb);
  });

  /** Parent with a follow-source clip over a child that shrank 10s → 6s. */
  async function makeDriftedParent() {
    const child = await service.createTimeline('ws-1', 'Imported');
    (pb as any).addMockMedia('media-1', 100);
    const childClip = await service.addClipToTimeline(
      child.id,
      'media-1',
      0,
      10
    );
    const parent = await service.createTimeline('ws-1', 'Main');
    const nestedClip = await service.addTimelineToTimeline(parent.id, child.id);
    await service.updateClipTimes(childClip.id, 0, 6);
    return { parent, child, childClip, nestedClip };
  }

  it('saves duration as the furthest placed clip end, not the sum of clip durations', async () => {
    const timeline = await service.createTimeline('ws-1', 'Gapped');
    (pb as any).addMockMedia('media-1', 100);
    await service.addClipToTimeline(timeline.id, 'media-1', 0, 10);
    const second = await service.addClipToTimeline(
      timeline.id,
      'media-1',
      0,
      5
    );
    // Pin the second clip at 20s: 10s clip, 10s gap, 5s clip → length 25.
    await service.applyClipShifts([{ clipId: second.id, timelineStart: 20 }]);

    const saved = await service.saveTimeline(timeline.id);

    expect(saved.duration).toBe(25);
  });

  it('validateTimeline heals drift in memory and agrees with createRenderTask', async () => {
    const { parent, nestedClip } = await makeDriftedParent();

    // The stored window [0,10] over a 6s child would fail a raw validation
    // with OFFSET_OUT_OF_BOUNDS, but the render path heals before
    // validating — the public gate must give the same verdict.
    const result = await service.validateTimeline(parent.id);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    // Still a pure read: nothing was persisted.
    const stored = (pb.collection('TimelineClips') as any)._storage.get(
      nestedClip.id
    );
    expect(stored.end).toBe(10);
  });

  it('reports a sub-epsilon source timeline as empty rather than out-of-bounds', async () => {
    const child = await service.createTimeline('ws-1', 'Imported');
    (pb as any).addMockMedia('media-1', 100);
    const childClip = await service.addClipToTimeline(
      child.id,
      'media-1',
      0,
      10
    );
    const parent = await service.createTimeline('ws-1', 'Main');
    await service.addTimelineToTimeline(parent.id, child.id);
    // Shrink the child into reflow's abstain band (extent <= REFLOW_EPSILON):
    // reflow leaves the parent's window alone, so validation must classify
    // the source as empty instead of failing the window as out-of-bounds.
    await service.updateClipTimes(childClip.id, 0, 0.005);

    const result = await service.validateTimeline(parent.id);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['EMPTY_SOURCE_TIMELINE']);
  });

  it('fails the save when a heal write fails, leaving the stored snapshot untouched', async () => {
    const { parent, nestedClip } = await makeDriftedParent();

    const clipsCollection = pb.collection('TimelineClips') as any;
    clipsCollection.update.mockRejectedValueOnce(new Error('403'));

    await expect(service.saveTimeline(parent.id)).rejects.toThrow('403');

    // Nothing half-written: no snapshot, no version bump, no healed clip.
    const storedTimeline = (pb.collection('Timelines') as any)._storage.get(
      parent.id
    );
    expect(storedTimeline.timelineData).toBeUndefined();
    expect(storedTimeline.version).toBe(1);
    const storedClip = clipsCollection._storage.get(nestedClip.id);
    expect(storedClip.end).toBe(10);
  });
});
