import { describe, expect, it, vi } from 'vitest';
import { fakePb, listResult } from './fake-pb.js';
import { captureList, captureMergedList } from './list-harness.js';
import type {
  ListSpec,
  MergeSource,
  ResolvedListQuery,
} from '../lib/list/index.js';

interface Row {
  id: string;
  name: string;
  score?: number;
}

const ctx = { pb: fakePb({}), workspaceId: 'ws1' };

const spec: ListSpec<Row> = {
  command: 'media list',
  hint: 'vw media show <id> for one record',
  sorts: [{ value: 'recent', description: 'newest', pbSort: '-created' }],
  filters: {
    directory: {
      flags: '-d, --directory <dir>',
      description: 'one directory',
      clause: (dir) => ({ expr: 'DirectoryRef = {:d}', params: { d: dir } }),
    },
  },
  columns: [
    { header: 'ID', value: (r) => r.id },
    { header: 'NAME', value: (r) => r.name },
  ],
};

const page = (rows: Row[], totalItems: number, perPage = 2) =>
  listResult(rows, { perPage, totalItems });

describe('runList — table output', () => {
  it('prints the table then the pagination, narrowing, and hint lines', async () => {
    const out = await captureList({
      spec,
      opts: { limit: 2 },
      ctx,
      argv: ['media', 'list', '--limit', '2'],
      fetchPage: async () =>
        page(
          [
            { id: 'm1', name: 'a.mp4' },
            { id: 'm2', name: 'b.mp4' },
          ],
          7
        ),
    });

    expect(out.stdout).toEqual([
      'ID  NAME ',
      '--  -----',
      'm1  a.mp4',
      'm2  b.mp4',
      '(1–2 of 7 — next page: vw media list --limit 2 --page 2)',
      '(narrow instead: -d/--directory <dir>)',
      '(add --json for full records; vw media show <id> for one record)',
    ]);
  });

  it('offsets the range and drops the narrowing line on the last page', async () => {
    const out = await captureList({
      spec,
      opts: { limit: 2, page: 4 },
      ctx,
      argv: ['media', 'list', '--limit', '2', '--page', '4'],
      fetchPage: async () => page([{ id: 'm7', name: 'g.mp4' }], 7),
    });

    expect(out.stdout.slice(-2)).toEqual([
      '(7–7 of 7 — end of results)',
      '(add --json for full records; vw media show <id> for one record)',
    ]);
  });

  it('prints (none) and no footer for an empty result', async () => {
    const out = await captureList({
      spec,
      ctx,
      fetchPage: async () => page([], 0),
    });
    expect(out.stdout).toEqual(['(none)']);
  });

  it('drops the narrowing line once the filter is applied', async () => {
    const out = await captureList({
      spec,
      opts: { limit: 1, directory: 'dir1' },
      ctx,
      fetchPage: async () => page([{ id: 'm1', name: 'a.mp4' }], 9),
    });
    expect(out.stdout.some((line) => line.includes('narrow instead'))).toBe(
      false
    );
  });
});

describe('runList — query plumbing', () => {
  it('hands the resolved filter, sort, and page to the fetcher', async () => {
    const fetchPage = vi.fn(async (_query: ResolvedListQuery) =>
      page([{ id: 'm1', name: 'a' }], 1)
    );
    await captureList({
      spec,
      opts: { directory: 'dir1', page: 2, limit: 25, sort: 'recent' },
      ctx,
      fetchPage,
    });

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchPage.mock.calls[0][0]).toMatchObject({
      page: 2,
      perPage: 25,
      sort: '-created',
      filter: '(WorkspaceRef = ws1) && (DirectoryRef = dir1)',
      applied: ['directory'],
    });
  });

  it('walks every page for --all and reports one collapsed result', async () => {
    const pages = [
      listResult([{ id: 'm1', name: 'a' }], {
        page: 1,
        perPage: 1,
        totalItems: 3,
      }),
      listResult([{ id: 'm2', name: 'b' }], {
        page: 2,
        perPage: 1,
        totalItems: 3,
      }),
      listResult([{ id: 'm3', name: 'c' }], {
        page: 3,
        perPage: 1,
        totalItems: 3,
      }),
    ];
    const fetchPage = vi.fn(async (q: { page: number }) => pages[q.page - 1]);

    const out = await captureList({
      spec,
      opts: { all: true, limit: 1 },
      ctx,
      fetchPage,
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(out.stdout).toContain('(3 of 3 — all results shown)');
  });

  it('surfaces a resolver error instead of querying', async () => {
    const fetchPage = vi.fn();
    await expect(
      captureList({ spec, opts: { sort: 'nope' }, ctx, fetchPage })
    ).rejects.toThrow(/unknown --sort/);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('applies toRows before rendering columns', async () => {
    const derived: ListSpec<Row, Row & { upper: string }> = {
      command: 'x list',
      workspaceScoped: false,
      toRows: (items) =>
        items.map((r) => ({ ...r, upper: r.name.toUpperCase() })),
      columns: [{ header: 'UPPER', value: (r) => r.upper }],
    };
    const out = await captureList({
      spec: derived,
      ctx,
      fetchPage: async () => page([{ id: 'm1', name: 'a.mp4' }], 1),
    });
    expect(out.stdout).toContain('A.MP4');
  });
});

describe('runList — JSON output', () => {
  it('prints only the envelope, with the next-page cursor', async () => {
    const out = await captureList({
      spec,
      opts: { json: true, limit: 2 },
      ctx,
      argv: ['media', 'list', '--json', '--limit', '2'],
      fetchPage: async () =>
        page(
          [
            { id: 'm1', name: 'a' },
            { id: 'm2', name: 'b' },
          ],
          7
        ),
    });

    expect(out.json()).toEqual({
      items: [
        { id: 'm1', name: 'a' },
        { id: 'm2', name: 'b' },
      ],
      totalItems: 7,
      page: 1,
      perPage: 2,
      totalPages: 4,
      hasMore: true,
      nextPage: 2,
      nextCommand: 'vw media list --json --limit 2 --page 2',
      appliedFilters: [],
      availableFilters: ['directory'],
    });
  });

  it('keeps the clamp warning off stdout so the JSON stays parseable', async () => {
    const out = await captureList({
      spec,
      opts: { json: true, limit: 5000 },
      ctx,
      fetchPage: async () => page([{ id: 'm1', name: 'a' }], 1),
    });

    expect(() => out.json()).not.toThrow();
    expect(out.stderr.join('\n')).toContain('exceeds the 500-row ceiling');
  });
});

describe('runMergedList', () => {
  const byScore = (a: Row, b: Row) => (b.score ?? 0) - (a.score ?? 0);

  const mergedSpec: ListSpec<Row> = {
    command: 'label search',
    workspaceScoped: false,
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'SCORE', value: (r) => String(r.score) },
    ],
  };

  function src(key: string, rows: Row[]): MergeSource<Row> {
    return {
      key,
      fetchPage: async ({ page: p, perPage }) =>
        listResult(rows.slice((p - 1) * perPage, p * perPage), {
          page: p,
          perPage,
          totalItems: rows.length,
        }),
    };
  }

  it('merges the sources into one window and totals them', async () => {
    const out = await captureMergedList({
      spec: mergedSpec,
      opts: { json: true, limit: 3 },
      ctx,
      sources: () => [
        src('face', [
          { id: 'f1', name: '', score: 90 },
          { id: 'f2', name: '', score: 40 },
        ]),
        src('speech', [
          { id: 's1', name: '', score: 70 },
          { id: 's2', name: '', score: 20 },
        ]),
      ],
      compare: () => byScore,
    });

    const envelope = out.json() as { items: Row[]; totalItems: number };
    expect(envelope.items.map((r) => r.id)).toEqual(['f1', 's1', 'f2']);
    expect(envelope.totalItems).toBe(4);
  });

  it('refuses a window past the merge depth, naming how to narrow', async () => {
    await expect(
      captureMergedList({
        spec: mergedSpec,
        opts: { limit: 100, page: 6 },
        ctx,
        sources: () => [src('a', []), src('b', [])],
        compare: () => byScore,
        narrowWith: '-t <type>',
      })
    ).rejects.toThrow(/past the 500-row merge depth.*-t <type>/s);
  });

  it('honours --max-depth from the options bag', async () => {
    await expect(
      captureMergedList({
        spec: mergedSpec,
        opts: { limit: 100, page: 6, maxDepth: 1000 },
        ctx,
        sources: () => [src('a', []), src('b', [])],
        compare: () => byScore,
      })
    ).resolves.toBeDefined();
  });
});
