import { describe, expect, it, vi } from 'vitest';
import { TimelineClipMutator } from '../timeline-clip';
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

function clip(id: string, order: number) {
  return { id, order, TimelineRef: 'tl1', start: 0, end: 1, duration: 1 };
}

/** A getList stub paging over `items` at `perPage` rows a page. */
function pagedClips(items: unknown[], perPage: number) {
  return vi.fn(async (page: number) => ({
    page,
    perPage,
    totalItems: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / perPage)),
    items: items.slice((page - 1) * perPage, page * perPage),
  }));
}

describe('TimelineClipMutator.getByTimeline', () => {
  it('returns a single page as-is', async () => {
    const items = [clip('c1', 0), clip('c2', 1)];
    const getList = pagedClips(items, 500);
    const clips = await new TimelineClipMutator(
      fakePb({ TimelineClips: { getList } })
    ).getByTimeline('tl1');

    expect(clips.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(getList).toHaveBeenCalledOnce();
  });

  it('walks every page so a long timeline is never silently truncated', async () => {
    // 1200 clips at 500 a page: the old single-page bound dropped 700 of
    // them, which read as a shorter timeline rather than an error.
    const items = Array.from({ length: 1200 }, (_, i) => clip(`c${i}`, i));
    const getList = pagedClips(items, 500);
    const clips = await new TimelineClipMutator(
      fakePb({ TimelineClips: { getList } })
    ).getByTimeline('tl1');

    expect(clips).toHaveLength(1200);
    expect(getList).toHaveBeenCalledTimes(3);
    expect(clips[1199].id).toBe('c1199');
  });

  it('keeps the clips in order across page boundaries', async () => {
    const items = Array.from({ length: 7 }, (_, i) => clip(`c${i}`, i));
    const getList = pagedClips(items, 500);
    // Force multi-page paging by reporting a smaller page size.
    getList.mockImplementation(async (page: number) => ({
      page,
      perPage: 3,
      totalItems: 7,
      totalPages: 3,
      items: items.slice((page - 1) * 3, page * 3),
    }));

    const clips = await new TimelineClipMutator(
      fakePb({ TimelineClips: { getList } })
    ).getByTimeline('tl1');

    expect(clips.map((c) => c.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('sorts by order and filters to the timeline on every page', async () => {
    const items = Array.from({ length: 4 }, (_, i) => clip(`c${i}`, i));
    const getList = vi.fn(
      async (
        page: number,
        _perPage: number,
        _options: { filter?: string; sort?: string }
      ) => ({
        page,
        perPage: 2,
        totalItems: 4,
        totalPages: 2,
        items: items.slice((page - 1) * 2, page * 2),
      })
    );

    await new TimelineClipMutator(
      fakePb({ TimelineClips: { getList } })
    ).getByTimeline('tl1');

    expect(getList).toHaveBeenCalledTimes(2);
    for (const [, , options] of getList.mock.calls) {
      expect(options.filter).toContain('TimelineRef = "tl1"');
      expect(options.sort).toBe('order');
    }
  });
});
