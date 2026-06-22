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
