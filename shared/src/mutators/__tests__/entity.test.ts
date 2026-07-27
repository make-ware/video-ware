import { describe, expect, it, vi } from 'vitest';
import { EntityMutator } from '../entity';
import { EntityKind } from '../../enums';
import type { TypedPocketBase } from '../../types';

type Stub = Record<string, any>;

function fakePb(collections: Record<string, Stub>): TypedPocketBase {
  return {
    authStore: { record: { id: 'user1' }, token: 'tok' },
    autoCancellation: () => {},
    filter: (expr: string) => expr,
    collection: (name: string) => {
      const c = collections[name];
      if (!c) throw new Error(`unexpected collection: ${name}`);
      return c;
    },
  } as unknown as TypedPocketBase;
}

const stored = {
  id: 'e1',
  WorkspaceRef: 'ws1',
  name: 'Erik',
  kind: EntityKind.PERSON,
  aliases: ['Eric'],
  description: 'Host',
};

function entityCollections() {
  const update = vi.fn(async (_id: string, patch: object) => ({
    ...stored,
    ...patch,
  }));
  return {
    update,
    collections: {
      Entities: {
        collectionIdOrName: 'Entities',
        update,
        getOne: vi.fn(async () => stored),
        getList: vi.fn(
          async (_page: number, _perPage: number, _options?: Stub) => ({
            items: [],
            page: 1,
            perPage: 12,
            totalItems: 0,
            totalPages: 0,
          })
        ),
      },
    },
  };
}

describe('EntityMutator.updateEntity', () => {
  it('applies a partial patch and returns the updated record', async () => {
    const { update, collections } = entityCollections();
    const mutator = new EntityMutator(fakePb(collections));

    const result = await mutator.updateEntity('e1', { name: 'Erik B.' });

    // PB's update takes a trailing options arg; assert on id + patch only.
    expect(update.mock.calls[0][0]).toBe('e1');
    expect(update.mock.calls[0][1]).toEqual({ name: 'Erik B.' });
    expect(result.name).toBe('Erik B.');
  });

  it('rejects an empty name rather than clearing it', async () => {
    const { update, collections } = entityCollections();
    const mutator = new EntityMutator(fakePb(collections));

    await expect(mutator.updateEntity('e1', { name: '' })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind', async () => {
    const { update, collections } = entityCollections();
    const mutator = new EntityMutator(fakePb(collections));

    await expect(
      mutator.updateEntity('e1', { kind: 'alien' as never })
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('strips WorkspaceRef — an entity never moves workspaces', async () => {
    const { update, collections } = entityCollections();
    const mutator = new EntityMutator(fakePb(collections));

    await mutator.updateEntity('e1', {
      name: 'Erik',
      WorkspaceRef: 'ws2',
    } as never);

    expect(update.mock.calls[0][1]).toEqual({ name: 'Erik' });
  });

  it('accepts cleared optional fields', async () => {
    const { update, collections } = entityCollections();
    const mutator = new EntityMutator(fakePb(collections));

    await mutator.updateEntity('e1', { description: '', aliases: [] });

    expect(update.mock.calls[0][1]).toEqual({ description: '', aliases: [] });
  });

  it('sends an empty patch through untouched when nothing changed', async () => {
    const { update, collections } = entityCollections();
    const mutator = new EntityMutator(fakePb(collections));

    await mutator.updateEntity('e1', {});

    expect(update.mock.calls[0][1]).toEqual({});
  });
});

describe('entity list ordering', () => {
  it('sorts by name with an id tiebreak so load-more paging is stable', async () => {
    const { collections } = entityCollections();
    const mutator = new EntityMutator(fakePb(collections));

    await mutator.getByWorkspace('ws1', EntityKind.PERSON, 1, 12);
    await mutator.search('ws1', 'eri', 1, 12, EntityKind.PERSON);

    expect(collections.Entities.getList).toHaveBeenCalledTimes(2);
    for (const call of collections.Entities.getList.mock.calls) {
      // PocketBase's RecordService.getList(page, perPage, options).
      expect(call[2]?.sort).toBe('name,id');
    }
  });
});
