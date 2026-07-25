import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_MERGE_DEPTH,
  fetchAll,
  fetchAllPages,
  fetchMergedAll,
  fetchMergedPage,
  maxMergedPage,
  type MergeSource,
} from '../lib/list/index.js';
import { listResult } from './fake-pb.js';

interface Row {
  id: string;
  score: number;
}

const byScore = (a: Row, b: Row) =>
  b.score - a.score || a.id.localeCompare(b.id);

/**
 * A source over a fixed, pre-sorted row set. Records the page requests it
 * received so tests can assert the over-fetch depth.
 */
function source(key: string, rows: Row[]) {
  const sorted = [...rows].sort(byScore);
  const requests: { page: number; perPage: number }[] = [];
  const merge: MergeSource<Row> = {
    key,
    fetchPage: async ({ page, perPage }) => {
      requests.push({ page, perPage });
      const start = (page - 1) * perPage;
      return listResult(sorted.slice(start, start + perPage), {
        page,
        perPage,
        totalItems: sorted.length,
      });
    },
  };
  return { merge, requests };
}

/** Deterministic rows: `key` prefixed ids with spread-out scores. */
function rows(key: string, count: number, offset: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${key}${i}`,
    score: (i * 7 + offset) % 100,
  }));
}

describe('fetchAll / fetchAllPages', () => {
  it('walks every page in order', async () => {
    const pages = [
      listResult([{ id: 'a' }], { page: 1, perPage: 1, totalItems: 3 }),
      listResult([{ id: 'b' }], { page: 2, perPage: 1, totalItems: 3 }),
      listResult([{ id: 'c' }], { page: 3, perPage: 1, totalItems: 3 }),
    ];
    const getPage = vi.fn(async (page: number) => pages[page - 1]);

    expect(await fetchAll(getPage)).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(getPage.mock.calls.map(([p]) => p)).toEqual([1, 2, 3]);
  });

  it('makes a single request for a single-page result', async () => {
    const getPage = vi.fn(async () => listResult([{ id: 'a' }]));
    expect(await fetchAll(getPage)).toHaveLength(1);
    expect(getPage).toHaveBeenCalledOnce();
  });

  it('collapses every page into one envelope, keeping the server total', async () => {
    const pages = [
      listResult([{ id: 'a' }, { id: 'b' }], {
        page: 1,
        perPage: 2,
        totalItems: 3,
      }),
      listResult([{ id: 'c' }], { page: 2, perPage: 2, totalItems: 3 }),
    ];
    const result = await fetchAllPages(async (page) => pages[page - 1]);

    expect(result.items).toHaveLength(3);
    expect(result.totalItems).toBe(3);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});

describe('maxMergedPage', () => {
  it('derives the page ceiling from the depth bound', () => {
    expect(maxMergedPage(100)).toBe(5);
    expect(maxMergedPage(10)).toBe(50);
    expect(maxMergedPage(500)).toBe(1);
  });

  it('never returns less than one page', () => {
    expect(maxMergedPage(5000)).toBe(1);
  });

  it('respects a custom depth', () => {
    expect(maxMergedPage(100, 1000)).toBe(10);
  });
});

describe('fetchMergedPage', () => {
  const a = rows('a', 30, 0);
  const b = rows('b', 25, 3);
  const c = rows('c', 40, 5);
  const everything = [...a, ...b, ...c].sort(byScore);

  it('returns exactly the brute-force window, page after page', async () => {
    const perPage = 7;
    for (let page = 1; page <= 5; page++) {
      const sources = [source('a', a), source('b', b), source('c', c)];
      const merged = await fetchMergedPage({
        sources: sources.map((s) => s.merge),
        compare: byScore,
        page,
        perPage,
      });
      expect(merged.items).toEqual(
        everything.slice((page - 1) * perPage, page * perPage)
      );
    }
  });

  it('covers every row exactly once across consecutive pages', async () => {
    const perPage = 10;
    const seen: Row[] = [];
    for (let page = 1; page <= 10; page++) {
      const sources = [source('a', a), source('b', b), source('c', c)];
      const merged = await fetchMergedPage({
        sources: sources.map((s) => s.merge),
        compare: byScore,
        page,
        perPage,
      });
      seen.push(...merged.items);
    }
    expect(seen).toEqual(everything);
    expect(new Set(seen.map((r) => r.id)).size).toBe(everything.length);
  });

  it('sums the sources totals and derives total pages from them', async () => {
    const sources = [source('a', a), source('b', b), source('c', c)];
    const merged = await fetchMergedPage({
      sources: sources.map((s) => s.merge),
      compare: byScore,
      page: 1,
      perPage: 10,
    });
    expect(merged.totalItems).toBe(95);
    expect(merged.totalPages).toBe(10);
  });

  it('over-fetches page × perPage from every source', async () => {
    const sources = [source('a', a), source('b', b), source('c', c)];
    const merged = await fetchMergedPage({
      sources: sources.map((s) => s.merge),
      compare: byScore,
      page: 3,
      perPage: 10,
    });
    expect(merged.depth).toBe(30);
    for (const s of sources) {
      expect(s.requests).toEqual([{ page: 1, perPage: 30 }]);
    }
  });

  it('refuses a window past the depth bound, naming the way out', async () => {
    const sources = [source('a', a), source('b', b)];
    await expect(
      fetchMergedPage({
        sources: sources.map((s) => s.merge),
        compare: byScore,
        page: 6,
        perPage: 100,
        narrowWith: '-t <type>',
      })
    ).rejects.toThrow(
      /Page 6 needs 600 rows from each of 2 collections, past the 500-row merge depth \(max page 5 at --limit 100\)\. Narrow the query \(-t <type>\) to page without a bound/
    );
  });

  it('lets a single source page past the bound (no merge needed)', async () => {
    const many = rows('a', 2000, 0);
    const only = source('a', many);
    const merged = await fetchMergedPage({
      sources: [only.merge],
      compare: byScore,
      page: 12,
      perPage: 100,
    });
    expect(merged.items).toHaveLength(100);
    expect(merged.items).toEqual([...many].sort(byScore).slice(1100, 1200));
  });

  it('honours a raised depth bound', async () => {
    const sources = [source('a', a), source('b', b)];
    await expect(
      fetchMergedPage({
        sources: sources.map((s) => s.merge),
        compare: byScore,
        page: 6,
        perPage: 100,
        maxDepth: 1000,
      })
    ).resolves.toMatchObject({ depth: 600 });
  });

  it('returns an empty window past the end of the data', async () => {
    const sources = [source('a', a)];
    const merged = await fetchMergedPage({
      sources: sources.map((s) => s.merge),
      compare: byScore,
      page: 4,
      perPage: 100,
    });
    expect(merged.items).toEqual([]);
    expect(merged.totalItems).toBe(30);
  });

  it('defaults the depth bound to 500 rows', () => {
    expect(DEFAULT_MAX_MERGE_DEPTH).toBe(500);
  });
});

describe('fetchMergedAll', () => {
  it('merges every row from every source', async () => {
    const a = rows('a', 12, 0);
    const b = rows('b', 9, 4);
    const sources = [source('a', a), source('b', b)];
    const merged = await fetchMergedAll({
      sources: sources.map((s) => s.merge),
      compare: byScore,
      batchSize: 5,
    });

    expect(merged.items).toEqual([...a, ...b].sort(byScore));
    expect(merged.totalItems).toBe(21);
    expect(merged.totalPages).toBe(1);
  });

  it('walks each source in batches', async () => {
    const sources = [source('a', rows('a', 12, 0))];
    await fetchMergedAll({
      sources: sources.map((s) => s.merge),
      compare: byScore,
      batchSize: 5,
    });
    expect(sources[0].requests).toEqual([
      { page: 1, perPage: 5 },
      { page: 2, perPage: 5 },
      { page: 3, perPage: 5 },
    ]);
  });
});
