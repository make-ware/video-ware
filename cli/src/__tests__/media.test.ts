import { describe, expect, it, vi } from 'vitest';
import { ClipType } from '@project/shared';
import {
  createMediaClip,
  deleteMediaClip,
  fetchMediaPage,
  mediaClipListSpec,
  mediaColumns,
  mediaListSpec,
  moveMedia,
  parseClipType,
  updateMedia,
  updateMediaClip,
} from '../lib/media.js';
import { mediaLabel, type MediaWithUpload } from '../lib/select.js';
import { resolveListQuery } from '../lib/list/index.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

describe('mediaListSpec', () => {
  const directories = (
    rows = [{ id: 'd1', name: 'trips', WorkspaceRef: 'ws1' }]
  ) => ({ getList: vi.fn(async () => listResult(rows)) });

  /** Resolve the spec's query, returning the composed filter string. */
  async function filterFor(
    opts: Record<string, unknown>,
    collections: Record<string, Stub> = {}
  ) {
    const pb = fakePb({ Directories: directories(), ...collections });
    const query = await resolveListQuery(mediaListSpec, opts, {
      pb,
      workspaceId: 'ws1',
    });
    return query;
  }

  it('scopes to the workspace with no filters applied', async () => {
    const query = await filterFor({});
    expect(query.filter).toBe('WorkspaceRef = ws1');
    expect(query.applied).toEqual([]);
  });

  it('binds a search over label, description, and source filename', async () => {
    const query = await filterFor({ search: 'beach' });
    expect(query.filter).toContain('WorkspaceRef = ws1');
    expect(query.filter).toContain('label ~ beach');
    expect(query.filter).toContain('description ~ beach');
    expect(query.filter).toContain('name ~ beach');
    expect(query.filter).not.toContain('UploadRef');
    expect(query.filter).not.toContain('DirectoryRef');
  });

  it('resolves a directory name to its id', async () => {
    const query = await filterFor({ directory: 'trips' });
    expect(query.filter).toContain('DirectoryRef = d1');
  });

  it('narrows to unfiled media for the root ref', async () => {
    const query = await filterFor({ directory: '/' });
    expect(query.filter).toContain('DirectoryRef = ""');
  });

  it('combines a directory, a type, and a search', async () => {
    const query = await filterFor({
      directory: 'trips',
      type: 'video',
      search: 'beach',
    });
    expect(query.filter).toContain('DirectoryRef = d1');
    expect(query.filter).toContain('mediaType = video');
    expect(query.filter).toContain('label ~ beach');
    expect(query.applied).toEqual(['directory', 'type', 'search']);
  });

  it('rejects an unknown media type', async () => {
    await expect(filterFor({ type: 'hologram' })).rejects.toThrow(
      /Invalid media type "hologram". Valid types: video, audio, image/
    );
  });

  it('defaults to the pre-pagination 200 rows, newest first', async () => {
    const query = await filterFor({});
    expect(query.perPage).toBe(200);
    expect(query.page).toBe(1);
    expect(query.sort).toBe('-created');
  });

  it('offers the webapp’s sort names', async () => {
    expect((await filterFor({ sort: 'name' })).sort).toBe('name,-created');
    expect((await filterFor({ sort: 'duration' })).sort).toBe(
      '-duration,-created'
    );
    expect((await filterFor({ sort: 'media_time' })).sort).toBe(
      '-mediaDate,-created'
    );
  });
});

describe('fetchMediaPage', () => {
  it('passes the resolved query through to the mutator with expands', async () => {
    const getList = vi.fn(
      async (
        _page: number,
        _perPage: number,
        _opts: { filter?: string; sort?: string; expand?: string }
      ) => listResult([{ id: 'm1' }])
    );
    const pb = fakePb({ Media: { getList } });

    await fetchMediaPage(pb, {
      page: 3,
      perPage: 25,
      filter: 'WorkspaceRef = ws1',
      sort: '-duration,-created',
    });

    const [page, perPage, options] = getList.mock.calls[0];
    expect(page).toBe(3);
    expect(perPage).toBe(25);
    expect(options.filter).toBe('WorkspaceRef = ws1');
    expect(options.sort).toBe('-duration,-created');
    expect(options.expand).toContain('DirectoryRef');
  });
});

describe('mediaClipListSpec', () => {
  it('reaches through the media relation for a directory filter', async () => {
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () =>
          listResult([{ id: 'd1', name: 'trips', WorkspaceRef: 'ws1' }])
        ),
      },
    });
    const query = await resolveListQuery(
      mediaClipListSpec,
      { directory: 'trips' },
      { pb, workspaceId: 'ws1' }
    );
    expect(query.filter).toContain('MediaRef.DirectoryRef = d1');
  });

  it('filters to one source media', async () => {
    const query = await resolveListQuery(
      mediaClipListSpec,
      { media: 'm1' },
      { pb: fakePb({}), workspaceId: 'ws1' }
    );
    expect(query.filter).toContain('MediaRef = m1');
  });

  it('searches the clip and its source filename', async () => {
    const query = await resolveListQuery(
      mediaClipListSpec,
      { search: 'hero' },
      { pb: fakePb({}), workspaceId: 'ws1' }
    );
    expect(query.filter).toContain('label ~ hero');
    expect(query.filter).toContain('MediaRef.name ~ hero');
  });
});

describe('moveMedia', () => {
  const directories = () => ({
    getList: vi.fn(async () =>
      listResult([
        { id: 'd1', name: 'trips', WorkspaceRef: 'ws1' },
        { id: 'd2', name: 'hawaii', WorkspaceRef: 'ws1' },
      ])
    ),
  });

  it('moves several media into a name-resolved directory', async () => {
    const update = vi.fn(async (id: string, data: object) => ({ id, ...data }));
    const pb = fakePb({
      Directories: directories(),
      Media: {
        getOne: vi.fn(async (id: string) => ({ id, WorkspaceRef: 'ws1' })),
        update,
      },
    });

    const result = await moveMedia(pb, 'ws1', 'hawaii', ['m1', 'm2']);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0].slice(0, 2)).toEqual([
      'm1',
      { DirectoryRef: 'd2' },
    ]);
    expect(result.directory?.id).toBe('d2');
    expect(result.moved).toHaveLength(2);
  });

  it('re-files media at the workspace root for a root ref', async () => {
    const update = vi.fn(async (id: string, data: object) => ({ id, ...data }));
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async (id: string) => ({
          id,
          WorkspaceRef: 'ws1',
          DirectoryRef: 'd2',
        })),
        update,
      },
    });

    const result = await moveMedia(pb, 'ws1', '/', ['m1']);

    expect(update.mock.calls[0].slice(0, 2)).toEqual([
      'm1',
      { DirectoryRef: '' },
    ]);
    expect(result.directory).toBeNull();
  });

  it('validates every media before writing anything', async () => {
    const update = vi.fn();
    const pb = fakePb({
      Directories: directories(),
      Media: {
        getOne: vi.fn(async (id: string) =>
          id === 'm1' ? { id, WorkspaceRef: 'ws1' } : null
        ),
        update,
      },
    });

    await expect(
      moveMedia(pb, 'ws1', 'hawaii', ['m1', 'missing'])
    ).rejects.toThrow(/media not found: missing.*nothing was moved/is);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects media from another workspace', async () => {
    const update = vi.fn();
    const pb = fakePb({
      Directories: directories(),
      Media: {
        getOne: vi.fn(async (id: string) => ({ id, WorkspaceRef: 'ws2' })),
        update,
      },
    });

    await expect(moveMedia(pb, 'ws1', 'hawaii', ['m1'])).rejects.toThrow(
      /another workspace/i
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('mediaLabel', () => {
  const media = (extra: Partial<MediaWithUpload>): MediaWithUpload =>
    ({ id: 'm1', ...extra }) as MediaWithUpload;

  it('reads the denormalized name, no Uploads expand required', () => {
    expect(mediaLabel(media({ name: 'beach.mp4' }))).toBe('beach.mp4');
  });

  it('prefers the denormalized name over a stale upload expand', () => {
    const row = media({
      name: 'beach.mp4',
      expand: { UploadRef: { id: 'u1', name: 'old.mp4' } },
    } as Partial<MediaWithUpload>);
    expect(mediaLabel(row)).toBe('beach.mp4');
  });

  it('falls back to the upload expand when the backfill left name empty', () => {
    const row = media({
      name: '',
      expand: { UploadRef: { id: 'u1', name: 'beach.mp4' } },
    } as Partial<MediaWithUpload>);
    expect(mediaLabel(row)).toBe('beach.mp4');
  });

  it('falls back to the id when neither is available', () => {
    expect(mediaLabel(media({ name: '' }))).toBe('m1');
    expect(mediaLabel(media({}))).toBe('m1');
  });
});

describe('mediaColumns', () => {
  const media = (extra: Partial<MediaWithUpload>): MediaWithUpload =>
    ({
      id: 'm1',
      mediaType: 'video',
      duration: 10,
      width: 1920,
      height: 1080,
      ...extra,
    }) as MediaWithUpload;

  it('shows the media name in NAME and keeps LABEL separate', () => {
    const rows = [media({ name: 'beach.mp4', label: 'Opening shot' })];
    const columns = mediaColumns(rows);
    const value = (header: string) =>
      columns.find((c) => c.header === header)!.value(rows[0]);
    expect(value('NAME')).toBe('beach.mp4');
    expect(value('LABEL')).toBe('Opening shot');
  });

  it('omits the DIRECTORY column when no row has a directory', () => {
    const columns = mediaColumns([media({}), media({ id: 'm2' })]);
    expect(columns.map((c) => c.header)).not.toContain('DIRECTORY');
  });

  it('adds DIRECTORY when any row has one, showing the expanded name', () => {
    const rows = [
      media({}),
      media({
        id: 'm2',
        DirectoryRef: 'd1',
        expand: { DirectoryRef: { id: 'd1', name: 'Hawaii' } },
      } as Partial<MediaWithUpload>),
    ];
    const columns = mediaColumns(rows);
    const directory = columns.find((c) => c.header === 'DIRECTORY');
    expect(directory).toBeDefined();
    expect(directory!.value(rows[1])).toBe('Hawaii');
    expect(directory!.value(rows[0])).toBe('');
  });

  it('falls back to the directory id when the expand is missing', () => {
    const rows = [media({ DirectoryRef: 'd1' } as Partial<MediaWithUpload>)];
    const columns = mediaColumns(rows);
    const directory = columns.find((c) => c.header === 'DIRECTORY');
    expect(directory!.value(rows[0])).toBe('d1');
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

  it('resolves --directory (name or path) to a DirectoryRef in the media workspace', async () => {
    const update = vi.fn(async (id: string, data) => ({ id, ...data }));
    const pb = fakePb({
      Media: {
        getOne: vi.fn(async () => ({ id: 'm1', WorkspaceRef: 'ws1' })),
        update,
      },
      Directories: {
        getList: vi.fn(async () =>
          listResult([{ id: 'd1', name: 'Hawaii', WorkspaceRef: 'ws1' }])
        ),
      },
    });

    await updateMedia(pb, 'm1', { directory: '/hawaii' });

    expect(update.mock.calls[0][1]).toEqual({ DirectoryRef: 'd1' });
  });

  it("clears the directory when --directory is 'none' or '/'", async () => {
    for (const ref of ['none', '/']) {
      const update = vi.fn(async (id: string, data) => ({ id, ...data }));
      const pb = fakePb({
        Media: {
          getOne: vi.fn(async () => ({
            id: 'm1',
            WorkspaceRef: 'ws1',
            DirectoryRef: 'd1',
          })),
          update,
        },
      });

      await updateMedia(pb, 'm1', { directory: ref });

      expect(update.mock.calls[0][1]).toEqual({ DirectoryRef: '' });
    }
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
