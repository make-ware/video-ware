import { describe, expect, it, vi } from 'vitest';
import {
  WatchFolderImportMutator,
  watchFolderPairKey,
} from '../watch-folder-import';
import { WatchFolderImportStatus } from '../../enums';
import type { TypedPocketBase } from '../../types';

type Stub = Record<string, any>;

function fakePb(collection: Stub): TypedPocketBase {
  return {
    authStore: { record: { id: 'user1' }, token: 'tok' },
    autoCancellation: () => {},
    filter: (expr: string, params?: Record<string, unknown>) =>
      // Cheap stand-in for PB's param binding: good enough to assert the
      // built expressions and to keep values visible to the stubs.
      expr.replace(/\{:(\w+)\}/g, (_, name) => JSON.stringify(params?.[name])),
    collection: (name: string) => {
      if (name !== 'WatchFolderImports') {
        throw new Error(`unexpected collection: ${name}`);
      }
      return collection;
    },
  } as unknown as TypedPocketBase;
}

const uniqueViolation = () =>
  Object.assign(new Error('validation_not_unique'), { status: 400 });

describe('WatchFolderImportMutator.claim', () => {
  const input = { key: 'import/ws1/a.mp4', etag: 'e1', WorkspaceRef: 'ws1' };

  it('creates the row with status=importing', async () => {
    const collection = {
      collectionIdOrName: 'WatchFolderImports',
      create: vi.fn(async (data: object) => ({ id: 'r1', ...data })),
    };
    const mutator = new WatchFolderImportMutator(fakePb(collection));

    const row = await mutator.claim(input);

    expect(row).toMatchObject({
      key: input.key,
      etag: input.etag,
      status: WatchFolderImportStatus.IMPORTING,
    });
  });

  it('returns null when the pair is already burned (lost race)', async () => {
    const collection = {
      collectionIdOrName: 'WatchFolderImports',
      create: vi.fn(async () => {
        throw uniqueViolation();
      }),
      getFirstListItem: vi.fn(async () => ({ id: 'winner' })),
    };
    const mutator = new WatchFolderImportMutator(fakePb(collection));

    expect(await mutator.claim(input)).toBeNull();
    expect(collection.getFirstListItem).toHaveBeenCalledOnce();
  });

  it('rethrows create errors that are not explained by an existing row', async () => {
    const boom = new Error('pb is down');
    const collection = {
      collectionIdOrName: 'WatchFolderImports',
      create: vi.fn(async () => {
        throw boom;
      }),
      getFirstListItem: vi.fn(async () => {
        throw Object.assign(new Error('not found'), { status: 404 });
      }),
    };
    const mutator = new WatchFolderImportMutator(fakePb(collection));

    await expect(mutator.claim(input)).rejects.toThrow('pb is down');
  });
});

describe('WatchFolderImportMutator.findBurnedPairs', () => {
  it('chunks lookups and returns pair identities', async () => {
    const pairs = Array.from({ length: 45 }, (_, i) => ({
      key: `import/ws1/f${i}.mp4`,
      etag: `e${i}`,
    }));
    const getList = vi.fn(async (..._args: any[]) => ({
      items: [{ key: pairs[0].key, etag: pairs[0].etag }],
      totalItems: 1,
      totalPages: 1,
      page: 1,
      perPage: 20,
    }));
    const collection = {
      collectionIdOrName: 'WatchFolderImports',
      getList,
    };
    const mutator = new WatchFolderImportMutator(fakePb(collection));

    const burned = await mutator.findBurnedPairs(pairs);

    // 45 pairs at 20 per chunk => 3 requests.
    expect(getList).toHaveBeenCalledTimes(3);
    const firstFilter = getList.mock.calls[0]![2].filter as string;
    expect(firstFilter).toContain('(key = "import/ws1/f0.mp4" && etag = "e0")');
    expect(firstFilter).toContain(' || ');
    expect(burned).toEqual(
      new Set([watchFolderPairKey(pairs[0].key, pairs[0].etag)])
    );
  });

  it('makes no requests for an empty pair list', async () => {
    const getList = vi.fn();
    const mutator = new WatchFolderImportMutator(
      fakePb({ collectionIdOrName: 'WatchFolderImports', getList })
    );

    expect(await mutator.findBurnedPairs([])).toEqual(new Set());
    expect(getList).not.toHaveBeenCalled();
  });
});

describe('WatchFolderImportMutator terminal updates', () => {
  it('markImported links the Upload', async () => {
    const update = vi.fn(async (id: string, data: object, ..._rest: any[]) => ({
      id,
      ...data,
    }));
    const mutator = new WatchFolderImportMutator(
      fakePb({ collectionIdOrName: 'WatchFolderImports', update })
    );

    await mutator.markImported('r1', 'up1');

    expect(update).toHaveBeenCalledWith(
      'r1',
      { status: WatchFolderImportStatus.IMPORTED, UploadRef: 'up1' },
      expect.anything()
    );
  });

  it('markFailed truncates long errors to 500 chars', async () => {
    const update = vi.fn(async (id: string, data: object) => ({ id, ...data }));
    const mutator = new WatchFolderImportMutator(
      fakePb({ collectionIdOrName: 'WatchFolderImports', update })
    );

    await mutator.markFailed('r1', 'x'.repeat(600));

    const written = update.mock.calls[0]![1] as { error: string };
    expect(written.error).toHaveLength(500);
    expect(written.error.endsWith('...')).toBe(true);
  });
});
