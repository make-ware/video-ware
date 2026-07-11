import { describe, expect, it, vi } from 'vitest';
import { ClipType, type TypedPocketBase } from '@project/shared';
import {
  createMediaClip,
  deleteMediaClip,
  parseClipType,
  searchMedia,
  updateMedia,
  updateMediaClip,
} from '../lib/media.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stub = Record<string, any>;

function fakePb(collections: Record<string, Stub>): TypedPocketBase {
  return {
    authStore: { record: { id: 'user1' }, token: 'tok' },
    autoCancellation: () => {},
    // Echo a deterministic, already-substituted filter string for assertions.
    filter: (tpl: string, params: Record<string, unknown>) =>
      Object.entries(params).reduce(
        (acc, [k, v]) => acc.replaceAll(`{:${k}}`, String(v)),
        tpl
      ),
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
    perPage: 200,
    totalItems: items.length,
    totalPages: 1,
    items,
  };
}

describe('searchMedia', () => {
  it('filters media by workspace and bound label/description/filename', async () => {
    const getList = vi.fn(
      async (_page: number, _perPage: number, _opts: { filter?: string }) =>
        listResult([{ id: 'm1' }])
    );
    const pb = fakePb({ Media: { getList } });

    const result = await searchMedia(pb, 'ws1', 'beach', 25);

    expect(result.items).toHaveLength(1);
    expect(getList).toHaveBeenCalledOnce();
    const [page, perPage, options] = getList.mock.calls[0];
    expect(page).toBe(1);
    expect(perPage).toBe(25);
    expect(options.filter).toContain('WorkspaceRef = ws1');
    expect(options.filter).toContain('label ~ beach');
    expect(options.filter).toContain('description ~ beach');
    expect(options.filter).toContain('UploadRef.name ~ beach');
  });
});

describe('updateMedia', () => {
  it('patches only the fields provided and leaves others untouched', async () => {
    const update = vi.fn(async (id: string, data) => ({ id, ...data }));
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          label: 'old',
          description: '',
        })),
        update,
      },
    });

    const result = await updateMedia(pb, 'm1', { label: 'Beach intro' });

    expect(update).toHaveBeenCalledOnce();
    const [id, patch] = update.mock.calls[0];
    expect(id).toBe('m1');
    expect(patch).toEqual({ label: 'Beach intro' });
    expect(patch).not.toHaveProperty('description');
    expect(result.label).toBe('Beach intro');
  });

  it('throws when the media does not exist', async () => {
    const pb = fakePb({
      Media: { getOne: vi.fn(async () => null), update: vi.fn() },
    });

    await expect(updateMedia(pb, 'missing', { label: 'x' })).rejects.toThrow(
      /media not found/i
    );
  });
});

describe('createMediaClip', () => {
  it('creates a full-media USER clip with workspace derived from media', async () => {
    const create = vi.fn(async (data) => ({ ...data, id: 'clip1' }));
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          WorkspaceRef: 'ws1',
          duration: 60,
          mediaType: 'video',
        })),
      },
      MediaClips: { create },
    });

    const clip = await createMediaClip(pb, { mediaId: 'm1' });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({
      WorkspaceRef: 'ws1',
      MediaRef: 'm1',
      type: ClipType.USER,
      start: 0,
      end: 60,
      duration: 60,
    });
    expect(clip.id).toBe('clip1');
  });

  it('honors an explicit range and clip type', async () => {
    const create = vi.fn(async (data) => ({ ...data, id: 'clip2' }));
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          WorkspaceRef: 'ws1',
          duration: 60,
          mediaType: 'video',
        })),
      },
      MediaClips: { create },
    });

    await createMediaClip(pb, {
      mediaId: 'm1',
      start: 5,
      end: 12.5,
      type: ClipType.RANGE,
    });

    expect(create.mock.calls[0][0]).toMatchObject({
      type: ClipType.RANGE,
      start: 5,
      end: 12.5,
      duration: 7.5,
    });
  });

  it('passes label and description through to the created clip', async () => {
    const create = vi.fn(async (data) => ({ ...data, id: 'clip3' }));
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          WorkspaceRef: 'ws1',
          duration: 60,
          mediaType: 'video',
        })),
      },
      MediaClips: { create },
    });

    await createMediaClip(pb, {
      mediaId: 'm1',
      label: 'Beach intro',
      description: 'Opening shot of the beach',
    });

    expect(create.mock.calls[0][0]).toMatchObject({
      label: 'Beach intro',
      description: 'Opening shot of the beach',
    });
  });

  it('rejects a range beyond the media duration', async () => {
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          WorkspaceRef: 'ws1',
          duration: 10,
          mediaType: 'video',
        })),
      },
      MediaClips: { create: vi.fn() },
    });

    await expect(
      createMediaClip(pb, { mediaId: 'm1', start: 0, end: 99 })
    ).rejects.toThrow(/invalid time range/i);
  });
});

describe('updateMediaClip', () => {
  it('patches label and description without touching the trim', async () => {
    const update = vi.fn(async (id: string, data) => ({ id, ...data }));
    const pb = fakePb({
      MediaClips: {
        getOne: vi.fn(async () => ({
          id: 'clip1',
          MediaRef: 'm1',
          start: 5,
          end: 10,
          duration: 5,
          label: 'old',
        })),
        update,
      },
    });

    const result = await updateMediaClip(pb, 'clip1', { label: 'New label' });

    expect(update).toHaveBeenCalledOnce();
    const [id, patch] = update.mock.calls[0];
    expect(id).toBe('clip1');
    expect(patch).toEqual({ label: 'New label' });
    expect(patch).not.toHaveProperty('start');
    expect(result.label).toBe('New label');
  });

  it('revalidates against the source media and recomputes duration when the trim changes', async () => {
    const update = vi.fn(async (id: string, data) => ({ id, ...data }));
    const pb = fakePb({
      MediaClips: {
        getOne: vi.fn(async () => ({
          id: 'clip1',
          MediaRef: 'm1',
          start: 5,
          end: 10,
          duration: 5,
        })),
        update,
      },
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          duration: 60,
          mediaType: 'video',
        })),
      },
    });

    await updateMediaClip(pb, 'clip1', { start: 2, end: 8 });

    expect(update.mock.calls[0][1]).toMatchObject({
      start: 2,
      end: 8,
      duration: 6,
    });
  });

  it('rejects a trim beyond the media duration', async () => {
    const pb = fakePb({
      MediaClips: {
        getOne: vi.fn(async () => ({
          id: 'clip1',
          MediaRef: 'm1',
          start: 0,
          end: 10,
          duration: 10,
        })),
        update: vi.fn(),
      },
      Media: {
        getOne: vi.fn(async () => ({
          id: 'm1',
          duration: 10,
          mediaType: 'video',
        })),
      },
    });

    await expect(updateMediaClip(pb, 'clip1', { end: 99 })).rejects.toThrow(
      /invalid time range/i
    );
  });

  it('throws when the clip does not exist', async () => {
    const pb = fakePb({
      MediaClips: { getOne: vi.fn(async () => null), update: vi.fn() },
    });

    await expect(
      updateMediaClip(pb, 'missing', { label: 'x' })
    ).rejects.toThrow(/media clip not found/i);
  });

  it('throws when no fields are passed', async () => {
    const pb = fakePb({
      MediaClips: {
        getOne: vi.fn(async () => ({
          id: 'clip1',
          MediaRef: 'm1',
          start: 0,
          end: 10,
          duration: 10,
        })),
        update: vi.fn(),
      },
    });

    await expect(updateMediaClip(pb, 'clip1', {})).rejects.toThrow(
      /nothing to update/i
    );
  });
});

describe('deleteMediaClip', () => {
  it('deletes the clip and reports no referencing timeline clips', async () => {
    const del = vi.fn(async () => true);
    const pb = fakePb({
      MediaClips: {
        getOne: vi.fn(async () => ({ id: 'clip1' })),
        delete: del,
      },
      TimelineClips: {
        getList: vi.fn(async () => listResult([])),
      },
    });

    const result = await deleteMediaClip(pb, 'clip1');

    expect(del).toHaveBeenCalledWith('clip1');
    expect(result.clip.id).toBe('clip1');
    expect(result.referencingClipIds).toEqual([]);
  });

  it('deletes the clip even when timeline clips still reference it (provenance only)', async () => {
    const del = vi.fn(async () => true);
    const pb = fakePb({
      MediaClips: {
        getOne: vi.fn(async () => ({ id: 'clip1' })),
        delete: del,
      },
      TimelineClips: {
        getList: vi.fn(async () => listResult([{ id: 'tc1' }, { id: 'tc2' }])),
      },
    });

    const result = await deleteMediaClip(pb, 'clip1');

    expect(del).toHaveBeenCalledWith('clip1');
    expect(result.referencingClipIds).toEqual(['tc1', 'tc2']);
  });

  it('throws when the clip does not exist', async () => {
    const pb = fakePb({
      MediaClips: { getOne: vi.fn(async () => null) },
    });

    await expect(deleteMediaClip(pb, 'missing')).rejects.toThrow(
      /media clip not found/i
    );
  });
});

describe('parseClipType', () => {
  it('accepts a valid clip type', () => {
    expect(parseClipType('range')).toBe(ClipType.RANGE);
  });

  it('rejects an unknown clip type', () => {
    expect(() => parseClipType('bogus')).toThrow(/invalid clip type/i);
  });
});

describe('updateMediaClip on a composite clip', () => {
  const composite = {
    id: 'clip1',
    MediaRef: 'm1',
    type: 'composite',
    start: 0,
    end: 30,
    duration: 20,
    clipData: {
      gapThreshold: 2,
      segments: [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
    },
  };
  const stubs = () => ({
    Media: {
      getOne: vi.fn(async () => ({
        id: 'm1',
        duration: 60,
        mediaType: 'video',
      })),
    },
    MediaClips: {
      getOne: vi.fn(async () => composite),
      update: vi.fn(async (id: string, data: object) => ({
        ...composite,
        ...data,
      })),
    },
  });

  it('intersects the edit list with the trim window (effective duration)', async () => {
    const collections = stubs();
    const pb = fakePb(collections);

    await updateMediaClip(pb, 'clip1', { start: 5, end: 25 });

    const [, patch] = collections.MediaClips.update.mock.calls[0];
    expect(patch).toEqual({
      start: 5,
      end: 25,
      duration: 10,
      clipData: {
        gapThreshold: 2,
        segments: [
          { start: 5, end: 10 },
          { start: 20, end: 25 },
        ],
      },
    });
  });

  it('rejects a trim window with no segment content', async () => {
    const collections = stubs();
    const pb = fakePb(collections);

    await expect(
      updateMediaClip(pb, 'clip1', { start: 12, end: 18 })
    ).rejects.toThrow(/no segment content/i);
    expect(collections.MediaClips.update).not.toHaveBeenCalled();
  });
});
