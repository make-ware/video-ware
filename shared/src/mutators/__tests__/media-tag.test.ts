import { describe, expect, it, vi } from 'vitest';
import { MediaTagMutator } from '../media-tag';
import type { TypedPocketBase } from '../../types';

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

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const input = { WorkspaceRef: 'ws1', MediaRef: 'm1', EntityRef: 'e1' };
const existing = { ...input, id: 'tag1' };

describe('MediaTagMutator.tag', () => {
  it('creates the (media, entity) edge', async () => {
    const collections = {
      MediaTags: {
        create: vi.fn(async (data: object) => ({ ...data, id: 'tag1' })),
      },
    };
    const tag = await new MediaTagMutator(fakePb(collections)).tag(input);
    expect(tag.id).toBe('tag1');
    expect(collections.MediaTags.create.mock.calls[0][0]).toMatchObject(input);
  });

  it('returns the existing edge when the unique index rejects the create', async () => {
    const collections = {
      MediaTags: {
        create: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('unique constraint'), { status: 400 })
          ),
        getFirstListItem: vi.fn(async () => existing),
      },
    };
    const tag = await new MediaTagMutator(fakePb(collections)).tag(input);
    expect(tag).toMatchObject(existing);
  });

  it('rethrows when the create fails and no edge exists', async () => {
    const collections = {
      MediaTags: {
        create: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('boom'), { status: 500 })),
        getFirstListItem: vi.fn().mockRejectedValue(notFound()),
      },
    };
    await expect(
      new MediaTagMutator(fakePb(collections)).tag(input)
    ).rejects.toThrow('boom');
  });
});

describe('MediaTagMutator.untag', () => {
  it('deletes the edge when present', async () => {
    const collections = {
      MediaTags: {
        getFirstListItem: vi.fn(async () => existing),
        delete: vi.fn(async () => true),
      },
    };
    const removed = await new MediaTagMutator(fakePb(collections)).untag(
      'm1',
      'e1'
    );
    expect(removed).toBe(true);
    expect(collections.MediaTags.delete).toHaveBeenCalledWith('tag1');
  });

  it('is a no-op when the edge is absent', async () => {
    const collections = {
      MediaTags: {
        getFirstListItem: vi.fn().mockRejectedValue(notFound()),
        delete: vi.fn(),
      },
    };
    const removed = await new MediaTagMutator(fakePb(collections)).untag(
      'm1',
      'e1'
    );
    expect(removed).toBe(false);
    expect(collections.MediaTags.delete).not.toHaveBeenCalled();
  });
});
