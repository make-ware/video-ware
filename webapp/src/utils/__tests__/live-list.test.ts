import { describe, it, expect } from 'vitest';
import type { ListResult } from 'pocketbase';
import {
  applyListEvent,
  dedupeById,
  removeManyFromList,
  type LiveListData,
  type LiveListRecord,
  type LiveListSpec,
} from '../live-list';

const T0 = '2026-07-18 10:00:00.000Z';
const T1 = '2026-07-18 10:00:01.000Z';
const T2 = '2026-07-18 10:00:02.000Z';

// created stamps, newest first: C9 > C8 > ... > C1
const created = (n: number) => `2026-07-18 09:00:0${n}.000Z`;

interface Item extends LiveListRecord {
  id: string;
  created: string;
  updated: string;
  group: string;
  name?: string;
}

function makeItem(
  id: string,
  createdAt: string,
  overrides: Partial<Item> = {}
): Item {
  return {
    id,
    created: createdAt,
    updated: T0,
    group: 'g1',
    ...overrides,
  };
}

/**
 * Build InfiniteData pages from item arrays. Totals default to the loaded
 * count (a complete window); pass totalItems to simulate unloaded pages.
 */
function makeData(
  pageItems: Item[][],
  opts: { perPage?: number; totalItems?: number } = {}
): LiveListData<Item> {
  const perPage = opts.perPage ?? 2;
  const loaded = pageItems.reduce((n, items) => n + items.length, 0);
  const totalItems = opts.totalItems ?? loaded;
  const totalPages = perPage > 0 ? Math.ceil(totalItems / perPage) : 0;
  const pages: ListResult<Item>[] = pageItems.map((items, i) => ({
    page: i + 1,
    perPage,
    totalItems,
    totalPages,
    items,
  }));
  return { pages, pageParams: pages.map((p) => p.page) };
}

/** created desc, id asc tiebreak — mirrors the default media sort. */
const byRecency = (a: Item, b: Item): number => {
  if (a.created !== b.created) return a.created < b.created ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const spec: LiveListSpec<Item> = {
  matches: (r) => r.group === 'g1',
  compare: byRecency,
};

const flatten = (data: LiveListData<Item>) =>
  data.pages.flatMap((p) => p.items.map((i) => i.id));

describe('applyListEvent — same-reference no-ops', () => {
  it('ignores a delete for an absent, non-matching record', () => {
    const data = makeData([[makeItem('a', created(9))]]);
    const record = makeItem('zz', created(1), { group: 'other' });
    expect(applyListEvent(data, 'delete', record, spec)).toBe(data);
  });

  it('ignores a create that fails matches', () => {
    const data = makeData([[makeItem('a', created(9))]]);
    const record = makeItem('b', created(8), { group: 'other' });
    expect(applyListEvent(data, 'create', record, spec)).toBe(data);
  });

  it('drops the echo of a local write (equal updated stamp)', () => {
    const data = makeData([[makeItem('a', created(9), { updated: T1 })]]);
    const echo = makeItem('a', created(9), { updated: T1 });
    expect(applyListEvent(data, 'update', echo, spec)).toBe(data);
  });

  it('drops a stale out-of-order update (older stamp)', () => {
    const data = makeData([[makeItem('a', created(9), { updated: T2 })]]);
    const stale = makeItem('a', created(9), { updated: T1 });
    expect(applyListEvent(data, 'update', stale, spec)).toBe(data);
  });

  it('ignores an unknown update sorting beyond an incomplete window', () => {
    const data = makeData(
      [[makeItem('a', created(9)), makeItem('b', created(8))]],
      { totalItems: 10 }
    );
    // Older than everything loaded → belongs on an unloaded page.
    const record = makeItem('zz', created(1), { updated: T1 });
    expect(applyListEvent(data, 'update', record, spec)).toBe(data);
  });

  it('ignores unknown actions', () => {
    const data = makeData([[makeItem('a', created(9))]]);
    const record = makeItem('b', created(8));
    expect(applyListEvent(data, 'noop', record, spec)).toBe(data);
  });
});

describe('applyListEvent — creates', () => {
  it('prepends a newest record under the recency sort and bumps totals', () => {
    const data = makeData(
      [
        [makeItem('a', created(9)), makeItem('b', created(8))],
        [makeItem('c', created(7)), makeItem('d', created(6))],
      ],
      { totalItems: 4 }
    );
    const record = makeItem('new', created(9).replace('09:00:09', '09:00:10'), {
      updated: T1,
    });
    const result = applyListEvent(data, 'create', record, spec);

    expect(flatten(result)).toEqual(['new', 'a', 'b', 'c', 'd']);
    for (const page of result.pages) {
      expect(page.totalItems).toBe(5);
      expect(page.totalPages).toBe(3); // ceil(5 / 2)
    }
    // Untouched page keeps its items reference.
    expect(result.pages[1].items).toBe(data.pages[1].items);
  });

  it('inserts mid-window at the sorted position', () => {
    const data = makeData([
      [makeItem('a', created(9)), makeItem('c', created(5))],
    ]);
    const record = makeItem('b', created(7), { updated: T1 });
    const result = applyListEvent(data, 'create', record, spec);
    expect(flatten(result)).toEqual(['a', 'b', 'c']);
    expect(result.pages[0].totalItems).toBe(3);
  });

  it('bumps totals without inserting when the record sorts beyond an incomplete window', () => {
    const data = makeData(
      [[makeItem('a', created(9)), makeItem('b', created(8))]],
      { totalItems: 10 }
    );
    const record = makeItem('old', created(1), { updated: T1 });
    const result = applyListEvent(data, 'create', record, spec);

    expect(result).not.toBe(data);
    expect(flatten(result)).toEqual(['a', 'b']);
    expect(result.pages[0].totalItems).toBe(11);
    expect(result.pages[0].items).toBe(data.pages[0].items);
  });

  it('appends when the window is the complete result set', () => {
    const data = makeData([
      [makeItem('a', created(9)), makeItem('b', created(8))],
    ]);
    const record = makeItem('old', created(1), { updated: T1 });
    const result = applyListEvent(data, 'create', record, spec);
    expect(flatten(result)).toEqual(['a', 'b', 'old']);
    expect(result.pages[0].totalItems).toBe(3);
  });

  it('inserts into an empty first page', () => {
    const data = makeData([[]], { totalItems: 0 });
    const record = makeItem('first', created(5), { updated: T1 });
    const result = applyListEvent(data, 'create', record, spec);
    expect(flatten(result)).toEqual(['first']);
    expect(result.pages[0].totalItems).toBe(1);
    expect(result.pages[0].totalPages).toBe(1);
  });
});

describe('applyListEvent — updates', () => {
  it('replaces in place when the sort key is unchanged', () => {
    const a = makeItem('a', created(9));
    const b = makeItem('b', created(8));
    const data = makeData([[a, b]]);
    const record = makeItem('a', created(9), { updated: T1, name: 'renamed' });
    const result = applyListEvent(data, 'update', record, spec);

    expect(flatten(result)).toEqual(['a', 'b']);
    expect(result.pages[0].items[0]).toBe(record);
    expect(result.pages[0].totalItems).toBe(2);
  });

  it('repositions within the window when the sort key changed', () => {
    const data = makeData([
      [makeItem('a', created(9)), makeItem('b', created(8))],
      [makeItem('c', created(7)), makeItem('d', created(6))],
    ]);
    // 'c' becomes the newest record.
    const record = makeItem('c', created(9).replace('09:00:09', '09:00:10'), {
      updated: T1,
    });
    const result = applyListEvent(data, 'update', record, spec);
    expect(flatten(result)).toEqual(['c', 'a', 'b', 'd']);
    expect(result.pages[0].totalItems).toBe(4); // totals unchanged
  });

  it('drops a record whose new sort position falls beyond an incomplete window, totals unchanged', () => {
    const data = makeData(
      [[makeItem('a', created(9)), makeItem('b', created(8))]],
      { totalItems: 10 }
    );
    // 'a' becomes older than everything loaded.
    const record = makeItem('a', created(1), { updated: T1 });
    const result = applyListEvent(data, 'update', record, spec);
    expect(flatten(result)).toEqual(['b']);
    expect(result.pages[0].totalItems).toBe(10);
  });

  it('removes a loaded record that stopped matching and decrements totals', () => {
    const data = makeData([
      [makeItem('a', created(9)), makeItem('b', created(8))],
    ]);
    const record = makeItem('a', created(9), { updated: T1, group: 'other' });
    const result = applyListEvent(data, 'update', record, spec);
    expect(flatten(result)).toEqual(['b']);
    expect(result.pages[0].totalItems).toBe(1);
  });

  it('inserts an unknown update that sorts within the window (missed create)', () => {
    const data = makeData(
      [[makeItem('a', created(9)), makeItem('c', created(5))]],
      { totalItems: 10 }
    );
    const record = makeItem('b', created(7), { updated: T1 });
    const result = applyListEvent(data, 'update', record, spec);
    expect(flatten(result)).toEqual(['a', 'b', 'c']);
    // Already counted server-side — no totals bump.
    expect(result.pages[0].totalItems).toBe(10);
  });
});

describe('applyListEvent — deletes', () => {
  it('removes a loaded record and decrements totals everywhere', () => {
    const data = makeData(
      [
        [makeItem('a', created(9)), makeItem('b', created(8))],
        [makeItem('c', created(7))],
      ],
      { totalItems: 3 }
    );
    const result = applyListEvent(
      data,
      'delete',
      makeItem('c', created(7)),
      spec
    );
    expect(flatten(result)).toEqual(['a', 'b']);
    for (const page of result.pages) {
      expect(page.totalItems).toBe(2);
    }
    expect(result.pages[0].items).toBe(data.pages[0].items);
  });

  it('decrements totals only for a matching record on an unloaded page', () => {
    const data = makeData(
      [[makeItem('a', created(9)), makeItem('b', created(8))]],
      { totalItems: 10 }
    );
    const result = applyListEvent(
      data,
      'delete',
      makeItem('zz', created(1)),
      spec
    );
    expect(flatten(result)).toEqual(['a', 'b']);
    expect(result.pages[0].totalItems).toBe(9);
    expect(result.pages[0].items).toBe(data.pages[0].items);
  });
});

describe('applyListEvent — canCompare', () => {
  const guardedSpec: LiveListSpec<Item> = {
    ...spec,
    canCompare: (r) => r.name !== undefined,
  };

  it('replaces a known record in place when it cannot be compared', () => {
    const data = makeData([
      [
        makeItem('a', created(9), { name: 'a' }),
        makeItem('b', created(8), { name: 'b' }),
      ],
    ]);
    // Newer stamp, no sort key — keep position.
    const record = makeItem('b', created(9).replace('09:00:09', '09:00:10'), {
      updated: T1,
    });
    const result = applyListEvent(data, 'update', record, guardedSpec);
    expect(flatten(result)).toEqual(['a', 'b']);
    expect(result.pages[0].items[1]).toBe(record);
  });

  it('bumps totals without inserting an uncomparable unknown create', () => {
    const data = makeData([[makeItem('a', created(9), { name: 'a' })]]);
    const record = makeItem('new', created(8), { updated: T1 });
    const result = applyListEvent(data, 'create', record, guardedSpec);
    expect(flatten(result)).toEqual(['a']);
    expect(result.pages[0].totalItems).toBe(2);
  });

  it('ignores an uncomparable unknown update entirely', () => {
    const data = makeData([[makeItem('a', created(9), { name: 'a' })]]);
    const record = makeItem('mystery', created(8), { updated: T1 });
    expect(applyListEvent(data, 'update', record, guardedSpec)).toBe(data);
  });
});

describe('removeManyFromList', () => {
  it('removes records across pages and drops totals by the removed count', () => {
    const data = makeData(
      [
        [makeItem('a', created(9)), makeItem('b', created(8))],
        [makeItem('c', created(7)), makeItem('d', created(6))],
      ],
      { totalItems: 4 }
    );
    const result = removeManyFromList(data, ['b', 'd', 'not-loaded']);
    expect(flatten(result)).toEqual(['a', 'c']);
    for (const page of result.pages) {
      expect(page.totalItems).toBe(2);
      expect(page.totalPages).toBe(1);
    }
  });

  it('returns the same reference when nothing is present', () => {
    const data = makeData([[makeItem('a', created(9))]]);
    expect(removeManyFromList(data, ['x', 'y'])).toBe(data);
    expect(removeManyFromList(data, [])).toBe(data);
  });
});

describe('dedupeById', () => {
  it('keeps the first occurrence of a duplicated id', () => {
    const first = makeItem('a', created(9), { name: 'first' });
    const dup = makeItem('a', created(9), { name: 'second' });
    const b = makeItem('b', created(8));
    expect(dedupeById([first, b, dup])).toEqual([first, b]);
  });

  it('returns the same reference when there are no duplicates', () => {
    const items = [makeItem('a', created(9)), makeItem('b', created(8))];
    expect(dedupeById(items)).toBe(items);
  });
});
