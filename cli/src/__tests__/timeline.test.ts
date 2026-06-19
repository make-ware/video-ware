import { describe, expect, it, vi } from 'vitest';
import { TaskStatus, type TypedPocketBase } from '@project/shared';
import { createRender, insertClip } from '../lib/timeline.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stub = Record<string, any>;

function fakePb(collections: Record<string, Stub>): TypedPocketBase {
  return {
    authStore: { record: { id: 'user1' }, token: 'tok' },
    autoCancellation: () => {},
    collection: (name: string) => {
      const c = collections[name];
      if (!c) throw new Error(`unexpected collection: ${name}`);
      return c;
    },
  } as unknown as TypedPocketBase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listResult(items: any[]) {
  return {
    page: 1,
    perPage: 500,
    totalItems: items.length,
    totalPages: 1,
    items,
  };
}

const OUTPUT = { resolution: '1920x1080', codec: 'h264', format: 'mp4' };

describe('insertClip', () => {
  it('appends a media clip with computed order and full-media duration', async () => {
    const create = vi.fn(async (data) => ({ ...data, id: 'clip1' }));
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          duration: 60,
          mediaType: 'video',
        })),
      },
      TimelineTracks: {
        getList: vi.fn(async () =>
          listResult([{ id: 'track1', layer: 0, TimelineRef: 'tl1' }])
        ),
      },
      TimelineClips: {
        getList: vi.fn(async () => listResult([])), // no clips → maxOrder -1
        create,
      },
    });

    const clip = await insertClip(pb, { timelineId: 'tl1', mediaId: 'm1' });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({
      TimelineRef: 'tl1',
      TimelineTrackRef: 'track1',
      MediaRef: 'm1',
      order: 0,
      start: 0,
      end: 60,
      duration: 60,
    });
    expect(clip.id).toBe('clip1');
  });

  it('rejects a time range beyond the media duration', async () => {
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          duration: 10,
          mediaType: 'video',
        })),
      },
      TimelineTracks: {
        getList: vi.fn(async () => listResult([{ id: 'track1', layer: 0 }])),
      },
      TimelineClips: { getList: vi.fn(async () => listResult([])) },
    });

    await expect(
      insertClip(pb, { timelineId: 'tl1', mediaId: 'm1', start: 0, end: 99 })
    ).rejects.toThrow(/invalid time range/i);
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
