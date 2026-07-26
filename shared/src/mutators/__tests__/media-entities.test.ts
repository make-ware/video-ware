import { describe, expect, it, vi } from 'vitest';
import { MediaEntitiesMutator } from '../media-entities';
import { mediaEntityLinksOf } from '../../schema/media-entities';
import type { TypedPocketBase } from '../../types';

type Stub = Record<string, any>;

function fakePb(collections: Record<string, Stub>): TypedPocketBase {
  return {
    authStore: { record: { id: 'user1' }, token: 'tok' },
    autoCancellation: () => {},
    filter: (expr: string, params: Record<string, string>) =>
      expr.replace(/\{:(\w+)\}/g, (_m, key: string) => `"${params[key]}"`),
    collection: (name: string) => {
      const c = collections[name];
      if (!c) throw new Error(`unexpected collection: ${name}`);
      return c;
    },
  } as unknown as TypedPocketBase;
}

const link = {
  id: 'e1',
  name: 'Micheal',
  kind: 'person',
  tagged: 1,
  links: 2,
};

function listOf(items: unknown[]) {
  return {
    page: 1,
    perPage: items.length,
    totalItems: items.length,
    totalPages: 1,
    items,
  };
}

describe('MediaEntitiesMutator.getByMediaIds', () => {
  it('ORs the media ids into one request and returns parsed links', async () => {
    const getList = vi.fn(
      async (
        _page: number,
        _perPage: number,
        _options: Record<string, unknown>
      ) => listOf([{ id: 'm1', WorkspaceRef: 'ws1', entities: [link] }])
    );
    const rows = await new MediaEntitiesMutator(
      fakePb({ MediaEntities: { getList } })
    ).getByMediaIds(['m1', 'm2']);

    expect(getList.mock.calls[0][2]).toMatchObject({
      filter: 'id = "m1" || id = "m2"',
    });
    expect(rows[0].entities).toEqual([link]);
  });

  it('normalizes the JSON column when PocketBase returns it as text', async () => {
    const getList = vi.fn(async () =>
      listOf([
        { id: 'm1', WorkspaceRef: 'ws1', entities: JSON.stringify([link]) },
      ])
    );
    const rows = await new MediaEntitiesMutator(
      fakePb({ MediaEntities: { getList } })
    ).getByMediaIds(['m1']);

    expect(rows[0].entities).toEqual([link]);
  });

  it('chunks large id sets so the filter stays proxy-safe', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `m${i}`);
    const getList = vi.fn(
      async (
        _page: number,
        _perPage: number,
        _options: Record<string, unknown>
      ) => listOf([{ id: 'm1', WorkspaceRef: 'ws1', entities: [link] }])
    );
    const rows = await new MediaEntitiesMutator(
      fakePb({ MediaEntities: { getList } })
    ).getByMediaIds(ids);

    expect(getList).toHaveBeenCalledTimes(3);
    expect(getList.mock.calls.map((call) => call[1])).toEqual([100, 100, 50]);
    // Rows from every chunk are merged into one list.
    expect(rows).toHaveLength(3);
  });

  it('skips the request entirely for an empty id list', async () => {
    const getList = vi.fn();
    const rows = await new MediaEntitiesMutator(
      fakePb({ MediaEntities: { getList } })
    ).getByMediaIds([]);

    expect(rows).toEqual([]);
    expect(getList).not.toHaveBeenCalled();
  });
});

describe('mediaEntityLinksOf', () => {
  it('drops unparseable text and non-array values', () => {
    expect(mediaEntityLinksOf('not json')).toEqual([]);
    expect(mediaEntityLinksOf(null)).toEqual([]);
    expect(mediaEntityLinksOf('{}')).toEqual([]);
  });

  it('drops malformed items but keeps the valid ones', () => {
    expect(mediaEntityLinksOf([link, { id: 'e2' }])).toEqual([link]);
  });
});
