import { describe, expect, it, vi } from 'vitest';
import { fakePb } from './fake-pb.js';
import {
  MAX_LIST_LIMIT,
  listFilter,
  resolveListQuery,
  sortNamesOf,
  type ListSpec,
} from '../lib/list/index.js';

const pb = fakePb({});
const ctx = { pb, workspaceId: 'ws1' };

/** A spec exercising every knob: two filters, a sort registry, a hint. */
const spec: ListSpec<{ id: string }> = {
  command: 'media list',
  sorts: [
    { value: 'recent', description: 'newest first', pbSort: '-created' },
    { value: 'name', description: 'A→Z', pbSort: 'name,-created' },
  ],
  filters: {
    directory: {
      flags: '-d, --directory <dir>',
      description: 'only media in this directory',
      clause: (dir) => ({ expr: 'DirectoryRef = {:dir}', params: { dir } }),
    },
    search: {
      flags: '--search <text>',
      description: 'match label or filename',
      clause: (q) => ({
        expr: '(label ~ {:q} || UploadRef.name ~ {:q})',
        params: { q },
      }),
    },
  },
  columns: [{ header: 'ID', value: (r) => r.id }],
};

describe('resolveListQuery — paging', () => {
  it('defaults to page 1 at the 100-row page size', async () => {
    const query = await resolveListQuery(spec, {}, ctx);
    expect(query.page).toBe(1);
    expect(query.perPage).toBe(100);
    expect(query.all).toBe(false);
  });

  it('honours the spec default limit over the global one', async () => {
    const query = await resolveListQuery(
      { ...spec, defaultLimit: 25 },
      {},
      ctx
    );
    expect(query.perPage).toBe(25);
  });

  it('takes --limit and --page from the options bag', async () => {
    const query = await resolveListQuery(spec, { limit: 5, page: 3 }, ctx);
    expect(query.perPage).toBe(5);
    expect(query.page).toBe(3);
  });

  it('clamps --limit at the ceiling and warns', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = await resolveListQuery(spec, { limit: 5000 }, ctx);
    expect(query.perPage).toBe(MAX_LIST_LIMIT);
    expect(stderr.mock.calls[0][0]).toContain('exceeds the 500-row ceiling');
    stderr.mockRestore();
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
    ['non-numeric', 'lots'],
  ])('rejects a %s --limit', async (_label, limit) => {
    await expect(resolveListQuery(spec, { limit }, ctx)).rejects.toThrow(
      /--limit expects a positive integer/
    );
  });

  it('rejects a zero --page', async () => {
    await expect(resolveListQuery(spec, { page: 0 }, ctx)).rejects.toThrow(
      /--page expects a positive integer/
    );
  });

  it('sets all for --all', async () => {
    const query = await resolveListQuery(spec, { all: true }, ctx);
    expect(query.all).toBe(true);
  });
});

describe('resolveListQuery — unpaged specs', () => {
  const structure: ListSpec<{ id: string }> = {
    ...spec,
    command: 'timeline clips list',
    unpaged: true,
  };

  it('fetches everything by default', async () => {
    const query = await resolveListQuery(structure, {}, ctx);
    expect(query.all).toBe(true);
  });

  it('opts back into paging when a window is requested', async () => {
    expect((await resolveListQuery(structure, { limit: 5 }, ctx)).all).toBe(
      false
    );
    expect((await resolveListQuery(structure, { page: 2 }, ctx)).all).toBe(
      false
    );
  });
});

describe('resolveListQuery — sorting', () => {
  it('defaults to the registry head', async () => {
    expect((await resolveListQuery(spec, {}, ctx)).sort).toBe('-created');
  });

  it('resolves a named sort to its pbSort', async () => {
    expect((await resolveListQuery(spec, { sort: 'name' }, ctx)).sort).toBe(
      'name,-created'
    );
  });

  it('rejects an unknown sort, listing the valid names', async () => {
    await expect(
      resolveListQuery(spec, { sort: 'sideways' }, ctx)
    ).rejects.toThrow(/unknown --sort "sideways". Valid values: recent, name/);
  });

  it('rejects --sort on a spec that declares none', async () => {
    const unsorted: ListSpec<{ id: string }> = { ...spec, sorts: undefined };
    await expect(
      resolveListQuery(unsorted, { sort: 'recent' }, ctx)
    ).rejects.toThrow(/does not support --sort/);
    expect((await resolveListQuery(unsorted, {}, ctx)).sort).toBe('');
  });

  it('exposes its sort names for help text', () => {
    expect(sortNamesOf(spec)).toEqual(['recent', 'name']);
  });
});

describe('resolveListQuery — filter composition', () => {
  it('scopes to the workspace when nothing else applies', async () => {
    const query = await resolveListQuery(spec, {}, ctx);
    expect(query.filter).toBe('WorkspaceRef = ws1');
    expect(query.applied).toEqual([]);
  });

  it('parenthesises and ands every applied clause', async () => {
    const query = await resolveListQuery(
      spec,
      { directory: 'dir1', search: 'beach' },
      ctx
    );
    expect(query.filter).toBe(
      '(WorkspaceRef = ws1) && (DirectoryRef = dir1) && ' +
        '((label ~ beach || UploadRef.name ~ beach))'
    );
    expect(query.applied).toEqual(['directory', 'search']);
  });

  it('composes in spec order regardless of option order', async () => {
    const a = await resolveListQuery(
      spec,
      { search: 'beach', directory: 'dir1' },
      ctx
    );
    const b = await resolveListQuery(
      spec,
      { directory: 'dir1', search: 'beach' },
      ctx
    );
    expect(a.filter).toBe(b.filter);
  });

  it('binds each clause separately so placeholders cannot collide', async () => {
    const colliding: ListSpec<{ id: string }> = {
      command: 'x list',
      filters: {
        one: {
          flags: '--one <v>',
          description: '',
          clause: (v) => ({ expr: 'a = {:q}', params: { q: v } }),
        },
        two: {
          flags: '--two <v>',
          description: '',
          clause: (v) => ({ expr: 'b = {:q}', params: { q: v } }),
        },
      },
      columns: [],
    };
    const query = await resolveListQuery(
      colliding,
      { one: 'first', two: 'second' },
      ctx
    );
    expect(query.filter).toBe(
      '(WorkspaceRef = ws1) && (a = first) && (b = second)'
    );
  });

  it('runs a filter parse function before its clause', async () => {
    const parsed: ListSpec<{ id: string }> = {
      command: 'x list',
      workspaceScoped: false,
      filters: {
        min: listFilter({
          flags: '--min <n>',
          description: '',
          parse: (raw) => Number(raw) * 2,
          // `n` is inferred as number from `parse` — no annotation needed.
          clause: (n) => ({ expr: 'v >= {:n}', params: { n } }),
        }),
      },
      columns: [],
    };
    const query = await resolveListQuery(parsed, { min: '21' }, ctx);
    expect(query.filter).toBe('v >= 42');
    // `values` carries the parsed value, keyed like `applied`.
    expect(query.values.min).toBe(42);
  });

  it('awaits an async clause (name → id lookups)', async () => {
    const async_: ListSpec<{ id: string }> = {
      command: 'x list',
      workspaceScoped: false,
      filters: {
        dir: {
          flags: '--dir <name>',
          description: '',
          clause: async (name) => {
            await Promise.resolve();
            return { expr: 'DirectoryRef = {:d}', params: { d: `id-${name}` } };
          },
        },
      },
      columns: [],
    };
    expect(
      (await resolveListQuery(async_, { dir: 'hawaii' }, ctx)).filter
    ).toBe('DirectoryRef = id-hawaii');
  });

  it('counts a null clause as applied but adds no filter', async () => {
    const nullable: ListSpec<{ id: string }> = {
      command: 'x list',
      workspaceScoped: false,
      filters: {
        flagOnly: {
          flags: '--flag-only <v>',
          description: '',
          clause: () => null,
        },
      },
      columns: [],
    };
    const query = await resolveListQuery(nullable, { flagOnly: 'x' }, ctx);
    expect(query.filter).toBe('');
    expect(query.applied).toEqual(['flagOnly']);
  });

  it('skips the workspace clause when the spec is not workspace-scoped', async () => {
    const query = await resolveListQuery(
      { ...spec, workspaceScoped: false },
      {},
      ctx
    );
    expect(query.filter).toBe('');
  });

  it('fails when a workspace-scoped spec has no workspace', async () => {
    await expect(resolveListQuery(spec, {}, { pb })).rejects.toThrow(
      /no active workspace/
    );
  });
});

describe('resolveListQuery — required filters', () => {
  const requiring: ListSpec<{ id: string }> = {
    command: 'label list',
    required: ['media'],
    filters: {
      media: listFilter({
        flags: '-m, --media <id>',
        description: 'the media to list labels for',
        clause: (id) => ({ expr: 'MediaRef = {:m}', params: { m: id } }),
        pick: async () => 'picked1',
      }),
      types: listFilter({
        flags: '-t, --types <types>',
        description: 'label types',
        clause: () => null,
      }),
    },
    columns: [],
  };

  it('accepts the required filter when passed', async () => {
    const query = await resolveListQuery(requiring, { media: 'm1' }, ctx);
    expect(query.filter).toContain('MediaRef = m1');
  });

  it('fails off a TTY, naming the flag and the alternatives', async () => {
    await expect(
      resolveListQuery(requiring, {}, ctx, { isTTY: false })
    ).rejects.toThrow(
      /label list needs -m, --media <id> — the media to list labels for\.\n {2}Available filters: -m\/--media, -t\/--types/
    );
  });

  it('runs the interactive picker on a TTY instead of failing', async () => {
    const query = await resolveListQuery(requiring, {}, ctx, { isTTY: true });
    expect(query.filter).toContain('MediaRef = picked1');
  });

  it('exposes the picked value on query.values — opts never learns it', async () => {
    // Fetchers that read a required id directly (timeline track/clips lists)
    // must find a picker-resolved value here; commander's opts bag is never
    // written back to.
    const opts: Record<string, unknown> = {};
    const query = await resolveListQuery(requiring, opts, ctx, {
      isTTY: true,
    });
    expect(query.values.media).toBe('picked1');
    expect(opts.media).toBeUndefined();
  });

  it('fails on a TTY when the filter has no picker', async () => {
    const noPick: ListSpec<{ id: string }> = {
      ...requiring,
      filters: {
        ...requiring.filters,
        media: { ...requiring.filters!.media, pick: undefined },
      },
    };
    await expect(
      resolveListQuery(noPick, {}, ctx, { isTTY: true })
    ).rejects.toThrow(/needs -m, --media/);
  });

  it('fails loudly when a required key is not a declared filter', async () => {
    await expect(
      resolveListQuery({ ...requiring, required: ['nope'] }, {}, ctx)
    ).rejects.toThrow(/required filter "nope" is not declared/);
  });
});

describe('resolveListQuery — requireOneOf', () => {
  const oneOf: ListSpec<{ id: string }> = {
    command: 'label search',
    requireOneOf: ['search', 'entity'],
    filters: {
      search: listFilter({
        flags: '--search <text>',
        description: 'free text',
        clause: (q) => ({ expr: 'text ~ {:q}', params: { q } }),
      }),
      entity: listFilter({
        flags: '--entity <nameOrId>',
        description: 'attributed entity',
        clause: (e) => ({ expr: 'EntityRef = {:e}', params: { e } }),
      }),
    },
    columns: [],
  };

  it('passes when any one is provided', async () => {
    await expect(
      resolveListQuery(oneOf, { entity: 'erik' }, ctx)
    ).resolves.toMatchObject({ applied: ['entity'] });
  });

  it('fails listing the alternatives when none is', async () => {
    await expect(resolveListQuery(oneOf, {}, ctx)).rejects.toThrow(
      /needs at least one of: --search, --entity/
    );
  });
});
