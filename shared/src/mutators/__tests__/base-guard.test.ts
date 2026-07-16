import { describe, expect, it, vi } from 'vitest';
import { TimelineClipMutator } from '../timeline-clip';
import { TimelineMutator } from '../timeline';
import {
  RecordConflictError,
  RecordGoneError,
  diffTopLevelFields,
} from '../../utils/record-conflict';
import type { TypedPocketBase } from '../../types';

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

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const storedClip = {
  id: 'tc1',
  updated: '2026-07-16 10:00:00.000Z',
  start: 0,
  end: 5,
  duration: 5,
  meta: { gain: 0.5 },
};

function clipCollections(current: object = storedClip) {
  return {
    TimelineClips: {
      collectionIdOrName: 'TimelineClips',
      getOne: vi.fn(async () => current),
      update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
    },
  };
}

describe('BaseMutator.updateWithGuard', () => {
  it('writes when the stored `updated` matches the guard', async () => {
    const collections = clipCollections();
    const mutator = new TimelineClipMutator(fakePb(collections));

    await mutator.updateWithGuard(
      'tc1',
      { start: 1 },
      { expectedUpdated: storedClip.updated, snapshot: storedClip }
    );

    expect(collections.TimelineClips.getOne).toHaveBeenCalledOnce();
    expect(collections.TimelineClips.update).toHaveBeenCalledOnce();
  });

  it('throws RecordConflictError with changed fields on a stale read', async () => {
    const remote = {
      ...storedClip,
      updated: '2026-07-16 10:00:05.000Z',
      end: 9,
      meta: { gain: 0.8 },
    };
    const collections = clipCollections(remote);
    const mutator = new TimelineClipMutator(fakePb(collections));

    const attempt = mutator.updateWithGuard(
      'tc1',
      { start: 1 },
      { expectedUpdated: storedClip.updated, snapshot: storedClip }
    );

    await expect(attempt).rejects.toThrow(RecordConflictError);
    await expect(attempt).rejects.toMatchObject({
      info: {
        recordId: 'tc1',
        expectedUpdated: storedClip.updated,
        actualUpdated: remote.updated,
        changedFields: ['end', 'meta'],
      },
    });
    expect(collections.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('throws RecordGoneError when the record was deleted in between', async () => {
    const collections = clipCollections();
    collections.TimelineClips.getOne = vi.fn().mockRejectedValue(notFound());
    const mutator = new TimelineClipMutator(fakePb(collections));

    await expect(
      mutator.updateWithGuard(
        'tc1',
        { start: 1 },
        { expectedUpdated: storedClip.updated }
      )
    ).rejects.toThrow(RecordGoneError);
    expect(collections.TimelineClips.update).not.toHaveBeenCalled();
  });

  it('is a plain update without a guard (no pre-read)', async () => {
    const collections = clipCollections();
    const mutator = new TimelineClipMutator(fakePb(collections));

    await mutator.updateWithGuard('tc1', { start: 1 });

    expect(collections.TimelineClips.getOne).not.toHaveBeenCalled();
    expect(collections.TimelineClips.update).toHaveBeenCalledOnce();
  });
});

describe('diffTopLevelFields', () => {
  it('reports differing fields, skipping bookkeeping ones', () => {
    expect(
      diffTopLevelFields(
        { start: 0, end: 5, meta: { gain: 0.5 }, updated: 'a', expand: {} },
        { start: 0, end: 9, meta: { gain: 0.5 }, updated: 'b' }
      )
    ).toEqual(['end']);
  });

  it('treats nested JSON (meta) as one field', () => {
    expect(
      diffTopLevelFields(
        { meta: { gain: 0.5, segments: [{ start: 0, end: 1 }] } },
        { meta: { gain: 0.5, segments: [{ start: 0, end: 2 }] } }
      )
    ).toEqual(['meta']);
  });
});

describe('TimelineMutator.incrementVersion', () => {
  it("sends PocketBase's atomic `version+` modifier without reading first", async () => {
    const collections = {
      Timelines: {
        collectionIdOrName: 'Timelines',
        getOne: vi.fn(),
        update: vi.fn(async (id: string, data: object) => ({
          id,
          version: 3,
          ...data,
        })),
      },
    };
    const mutator = new TimelineMutator(fakePb(collections));

    await mutator.incrementVersion('tl1');

    expect(collections.Timelines.getOne).not.toHaveBeenCalled();
    expect(collections.Timelines.update.mock.calls[0][1]).toEqual({
      'version+': 1,
    });
  });
});

describe('TimelineClipMutator.reorderClips', () => {
  it('writes sequentially, one clip at a time, in the given order', async () => {
    const active: string[] = [];
    let maxConcurrent = 0;
    const collections = {
      TimelineClips: {
        collectionIdOrName: 'TimelineClips',
        update: vi.fn(async (id: string, data: object) => {
          active.push(id);
          maxConcurrent = Math.max(maxConcurrent, active.length);
          await new Promise((resolve) => setTimeout(resolve, 0));
          active.pop();
          return { id, ...data };
        }),
      },
    };
    const mutator = new TimelineClipMutator(fakePb(collections));

    await mutator.reorderClips('tl1', [
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
    ]);

    expect(maxConcurrent).toBe(1);
    expect(
      collections.TimelineClips.update.mock.calls.map((c) => c[0])
    ).toEqual(['a', 'b', 'c']);
  });
});
