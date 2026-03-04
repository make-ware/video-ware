import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaService } from '../media';
import type { TypedPocketBase } from '@project/shared/types';
import type { Media } from '@project/shared';
import { createGenericMockCollection } from '@/test/__tests__/fixtures/pocketbase';

function createMockPocketBase() {
  const mediaCollection = createGenericMockCollection<Media>(
    'Media',
    () => `media-${Math.random().toString(36).substring(7)}`
  );

  // Stub collections that MediaService constructor also creates mutators for
  const stubCollection = createGenericMockCollection<any>('Stub');

  const pb = {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'Media') return mediaCollection;
      return stubCollection;
    },
  } as unknown as TypedPocketBase;

  return { pb, mediaCollection };
}

describe('MediaService.bulkDeleteMedia', () => {
  let service: MediaService;
  let pb: TypedPocketBase;
  let mediaCollection: ReturnType<typeof createGenericMockCollection<Media>>;

  beforeEach(() => {
    const mock = createMockPocketBase();
    pb = mock.pb;
    mediaCollection = mock.mediaCollection;
    service = new MediaService(pb);
  });

  async function seedMedia(id: string) {
    await mediaCollection.create({
      id,
      WorkspaceRef: 'ws-1',
      UploadRef: 'up-1',
      duration: 10,
      mediaType: 'video',
      width: 1920,
      height: 1080,
      hasAudio: true,
      mediaData: {},
    } as any);
  }

  it('deletes a single item successfully', async () => {
    await seedMedia('m1');
    const result = await service.bulkDeleteMedia(['m1']);
    expect(result.succeeded).toEqual(['m1']);
    expect(result.failed).toEqual([]);
  });

  it('deletes multiple items successfully', async () => {
    await seedMedia('m1');
    await seedMedia('m2');
    await seedMedia('m3');
    const result = await service.bulkDeleteMedia(['m1', 'm2', 'm3']);
    expect(result.succeeded).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
  });

  it('returns empty arrays for empty input', async () => {
    const result = await service.bulkDeleteMedia([]);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('records are actually removed from the collection after delete', async () => {
    await seedMedia('m1');
    await seedMedia('m2');
    await service.bulkDeleteMedia(['m1']);
    expect(mediaCollection._storage.has('m1')).toBe(false);
    expect(mediaCollection._storage.has('m2')).toBe(true);
  });

  // The mutator's delete() catches errors internally and returns false,
  // so bulkDeleteMedia's Promise.allSettled always sees fulfilled promises.
  // Non-existent IDs still appear as "succeeded" at the service level.
  // The tests below verify the failure path by directly mocking the
  // mediaMutator to throw, simulating a raw PocketBase error.

  it('reports failure when mutator throws on delete', async () => {
    await seedMedia('m1');
    // Access private mediaMutator and make its delete throw for a specific ID
    const mutator = (service as any).mediaMutator;
    const realDelete = mutator.delete.bind(mutator);
    vi.spyOn(mutator, 'delete').mockImplementation(
      async (...args: unknown[]) => {
        const id = args[0] as string;
        if (id === 'bad-id') throw new Error('Not found');
        return realDelete(id);
      }
    );

    const result = await service.bulkDeleteMedia(['m1', 'bad-id']);
    expect(result.succeeded).toContain('m1');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('bad-id');
    expect(result.failed[0].error).toBe('Not found');
  });

  it('all IDs fail when mutator throws for all', async () => {
    const mutator = (service as any).mediaMutator;
    vi.spyOn(mutator, 'delete').mockRejectedValue(new Error('Server error'));

    const result = await service.bulkDeleteMedia(['x1', 'x2']);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(2);
  });

  it('handles partial failure with correct split', async () => {
    await seedMedia('m1');
    await seedMedia('m2');
    const mutator = (service as any).mediaMutator;
    const realDelete = mutator.delete.bind(mutator);
    vi.spyOn(mutator, 'delete').mockImplementation(
      async (...args: unknown[]) => {
        const deleteId = args[0] as string;
        if (deleteId === 'm3') throw new Error('Not found');
        return realDelete(deleteId);
      }
    );

    const result = await service.bulkDeleteMedia(['m1', 'm3', 'm2']);
    expect(result.succeeded).toContain('m1');
    expect(result.succeeded).toContain('m2');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('m3');
  });
});
