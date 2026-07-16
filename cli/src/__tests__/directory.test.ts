import { describe, expect, it, vi } from 'vitest';
import type { Directory } from '@project/shared';
import {
  assertValidDirectoryName,
  createDirectory,
  deleteDirectory,
  isRootDirRef,
  listDirectories,
  mediaCountsByDirectory,
  renameDirectory,
  resolveDirectory,
  resolveDirectoryIn,
} from '../lib/directory.js';
import { fakePb, listResult } from './fake-pb.js';

const dir = (id: string, name: string): Directory =>
  ({
    id,
    name,
    WorkspaceRef: 'ws1',
  }) as Directory;

describe('isRootDirRef', () => {
  it('accepts every spelling of "no directory"', () => {
    for (const ref of ['/', '//', 'root', 'none', 'NONE', ' / ', '']) {
      expect(isRootDirRef(ref)).toBe(true);
    }
  });

  it('rejects actual directory refs', () => {
    for (const ref of ['hawaii', '/trips', 'rooted', 'd1']) {
      expect(isRootDirRef(ref)).toBe(false);
    }
  });
});

describe('listDirectories', () => {
  it('lists the workspace directories with a bound filter', async () => {
    const getList = vi.fn(
      async (_page: number, _perPage: number, opts: { filter?: string }) => {
        expect(opts.filter).toBe('WorkspaceRef = ws1');
        return listResult([dir('d1', 'hawaii')]);
      }
    );
    const pb = fakePb({ Directories: { getList } });

    const result = await listDirectories(pb, 'ws1');

    expect(getList).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(1);
  });
});

describe('resolveDirectoryIn', () => {
  const hawaii = dir('d1', 'hawaii');
  const costaRica = dir('d2', 'costa-rica');

  it('resolves by record id', () => {
    expect(resolveDirectoryIn([hawaii, costaRica], 'd2')).toBe(costaRica);
  });

  it('resolves a name case-insensitively, with or without slashes', () => {
    expect(resolveDirectoryIn([hawaii], 'HAWAII')).toBe(hawaii);
    expect(resolveDirectoryIn([hawaii], '/hawaii')).toBe(hawaii);
    expect(resolveDirectoryIn([hawaii], 'hawaii/')).toBe(hawaii);
  });

  it('rejects a nested path outright — directories are flat', () => {
    expect(() => resolveDirectoryIn([hawaii], 'trips/hawaii')).toThrow(
      /flat.*not a nested path.*"hawaii"/is
    );
  });

  it('falls back to a unique substring match', () => {
    expect(resolveDirectoryIn([hawaii, costaRica], 'haw')).toBe(hawaii);
  });

  it('rejects an ambiguous substring match with the candidates', () => {
    const maui = dir('d3', 'hawaii-maui');
    expect(() => resolveDirectoryIn([hawaii, maui], 'haw')).toThrow(
      /ambiguous.*hawaii \(d1\).*hawaii-maui \(d3\)/is
    );
  });

  it('rejects an unknown ref with a hint', () => {
    expect(() => resolveDirectoryIn([hawaii], 'fiji')).toThrow(
      /no directory matching "fiji".*vw dir list/is
    );
  });
});

describe('resolveDirectory', () => {
  it('loads the workspace list and resolves against it', async () => {
    const getList = vi.fn(async () => listResult([dir('d1', 'hawaii')]));
    const pb = fakePb({ Directories: { getList } });

    const found = await resolveDirectory(pb, 'ws1', 'hawaii');

    expect(found.id).toBe('d1');
    expect(getList).toHaveBeenCalledOnce();
  });

  it('does not resolve an id from another workspace (not in the list)', async () => {
    const pb = fakePb({
      Directories: { getList: vi.fn(async () => listResult([])) },
    });

    await expect(resolveDirectory(pb, 'ws1', 'foreign-id')).rejects.toThrow(
      /no directory matching/i
    );
  });
});

describe('assertValidDirectoryName', () => {
  it('accepts path-safe names and trims/strips slashes', () => {
    expect(assertValidDirectoryName('hawaii')).toBe('hawaii');
    expect(assertValidDirectoryName(' /hawaii-2024_b ')).toBe('hawaii-2024_b');
    expect(assertValidDirectoryName('B2')).toBe('B2');
  });

  it('rejects spaces, symbols, and leading dashes', () => {
    for (const bad of ['costa rica', 'trip#2', 'a/b', '-hawaii', 'ha!', '']) {
      expect(() => assertValidDirectoryName(bad)).toThrow(/invalid|flat/i);
    }
  });

  it('rejects names over the max length', () => {
    expect(() => assertValidDirectoryName('x'.repeat(61))).toThrow(
      /at most 60/i
    );
  });
});

describe('createDirectory', () => {
  it('creates a directory with the validated name', async () => {
    const create = vi.fn(async (data: Record<string, unknown>) => ({
      id: 'd9',
      ...data,
    }));
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () => listResult([])),
        create,
      },
    });

    const result = await createDirectory(pb, 'ws1', '/hawaii');

    expect(create.mock.calls[0][0]).toMatchObject({
      WorkspaceRef: 'ws1',
      name: 'hawaii',
    });
    expect(result.existed).toBe(false);
    expect(result.directory.id).toBe('d9');
  });

  it('is idempotent: an existing name (case-insensitive) creates nothing', async () => {
    const create = vi.fn();
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () => listResult([dir('d1', 'Hawaii')])),
        create,
      },
    });

    const result = await createDirectory(pb, 'ws1', 'HAWAII');

    expect(create).not.toHaveBeenCalled();
    expect(result.existed).toBe(true);
    expect(result.directory.id).toBe('d1');
  });

  it('rejects an invalid name before touching the server', async () => {
    const pb = fakePb({});
    await expect(createDirectory(pb, 'ws1', 'costa rica')).rejects.toThrow(
      /invalid directory name/i
    );
  });
});

describe('renameDirectory', () => {
  it('renames and reports the previous name', async () => {
    const update = vi.fn(async (id: string, data: object) => ({
      id,
      WorkspaceRef: 'ws1',
      ...data,
    }));
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () => listResult([dir('d1', 'hawaii')])),
        update,
      },
    });

    const result = await renameDirectory(pb, 'ws1', 'hawaii', 'maui');

    expect(update.mock.calls[0].slice(0, 2)).toEqual(['d1', { name: 'maui' }]);
    expect(result.previousName).toBe('hawaii');
    expect(result.directory.name).toBe('maui');
  });

  it('rejects a rename that collides with another directory', async () => {
    const update = vi.fn();
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () =>
          listResult([dir('d1', 'hawaii'), dir('d2', 'maui')])
        ),
        update,
      },
    });

    await expect(renameDirectory(pb, 'ws1', 'hawaii', 'Maui')).rejects.toThrow(
      /already exists.*unique per workspace/is
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an invalid new name', async () => {
    const pb = fakePb({});
    await expect(
      renameDirectory(pb, 'ws1', 'hawaii', 'ha waii')
    ).rejects.toThrow(/invalid directory name/i);
  });
});

describe('deleteDirectory', () => {
  it('deletes an empty directory', async () => {
    const del = vi.fn(async () => true);
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () => listResult([dir('d1', 'hawaii')])),
        delete: del,
      },
      Media: { getFullList: vi.fn(async () => []) },
    });

    const result = await deleteDirectory(pb, 'ws1', 'hawaii');

    expect(del).toHaveBeenCalledWith('d1');
    expect(result.unfiledMediaIds).toHaveLength(0);
  });

  it('refuses a non-empty directory without --force', async () => {
    const del = vi.fn();
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () => listResult([dir('d1', 'hawaii')])),
        delete: del,
      },
      Media: { getFullList: vi.fn(async () => [{ id: 'm1' }, { id: 'm2' }]) },
    });

    await expect(deleteDirectory(pb, 'ws1', 'hawaii')).rejects.toThrow(
      /still contains 2 media.*--force.*never deleted/is
    );
    expect(del).not.toHaveBeenCalled();
  });

  it('--force unfiles the media back to the workspace root, then deletes', async () => {
    const mediaUpdate = vi.fn(async (id: string, data: object) => ({
      id,
      ...data,
    }));
    const del = vi.fn(async () => true);
    const pb = fakePb({
      Directories: {
        getList: vi.fn(async () => listResult([dir('d1', 'hawaii')])),
        delete: del,
      },
      Media: {
        getFullList: vi.fn(async () => [{ id: 'm1' }, { id: 'm2' }]),
        update: mediaUpdate,
      },
    });

    const result = await deleteDirectory(pb, 'ws1', 'hawaii', { force: true });

    expect(mediaUpdate).toHaveBeenCalledTimes(2);
    expect(mediaUpdate.mock.calls[0].slice(0, 2)).toEqual([
      'm1',
      { DirectoryRef: '' },
    ]);
    expect(del).toHaveBeenCalledWith('d1');
    expect(result.unfiledMediaIds).toEqual(['m1', 'm2']);
  });
});

describe('mediaCountsByDirectory', () => {
  it('counts media per directory and unfiled media at the root', async () => {
    const getFullList = vi.fn(async (opts: { filter?: string }) => {
      expect(opts.filter).toBe('WorkspaceRef = ws1');
      return [
        { id: 'm1', DirectoryRef: 'd1' },
        { id: 'm2', DirectoryRef: 'd1' },
        { id: 'm3', DirectoryRef: '' },
        { id: 'm4' },
      ];
    });
    const pb = fakePb({ Media: { getFullList } });

    const counts = await mediaCountsByDirectory(pb, 'ws1');

    expect(counts.byDirectory.get('d1')).toBe(2);
    expect(counts.root).toBe(2);
    expect(counts.total).toBe(4);
  });
});
