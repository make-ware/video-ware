import { describe, expect, it } from 'vitest';
import {
  hasMore,
  hintLine,
  listEnvelope,
  listFooter,
  narrowHint,
  nextPageCommand,
  paginationLine,
  type ListSpec,
  type ListView,
} from '../lib/list/index.js';

const spec: ListSpec<{ id: string }> = {
  command: 'media list',
  hint: 'vw media show <id> for one record',
  filters: {
    directory: {
      flags: '-d, --directory <dir>',
      description: 'one directory',
      clause: () => null,
    },
    type: {
      flags: '--type <mediaType>',
      description: 'one media type',
      clause: () => null,
    },
  },
  columns: [{ header: 'ID', value: (r) => r.id }],
};

/** A rendered page; override only what a case cares about. */
function view(overrides: Partial<ListView> = {}): ListView {
  return {
    command: 'media list',
    argv: ['media', 'list'],
    page: 1,
    perPage: 100,
    shown: 100,
    totalItems: 3412,
    totalPages: 35,
    all: false,
    ...overrides,
  };
}

describe('nextPageCommand', () => {
  it('appends --page to the invoking argv', () => {
    expect(nextPageCommand(['media', 'list'], 2)).toBe(
      'vw media list --page 2'
    );
  });

  it('preserves the other flags', () => {
    expect(
      nextPageCommand(['media', 'list', '--type', 'video', '--sort', 'name'], 4)
    ).toBe('vw media list --type video --sort name --page 4');
  });

  it('replaces a space-separated --page instead of accumulating one', () => {
    expect(nextPageCommand(['media', 'list', '--page', '7'], 8)).toBe(
      'vw media list --page 8'
    );
  });

  it('replaces an --page=N form too', () => {
    expect(nextPageCommand(['media', 'list', '--page=7', '--json'], 8)).toBe(
      'vw media list --json --page 8'
    );
  });

  it('quotes an argument that would re-split', () => {
    expect(
      nextPageCommand(['media', 'list', '--search', 'blue beach'], 2)
    ).toBe("vw media list --search 'blue beach' --page 2");
  });

  it('escapes an embedded single quote', () => {
    expect(nextPageCommand(['media', 'list', '--search', "erik's"], 2)).toBe(
      "vw media list --search 'erik'\\''s' --page 2"
    );
  });
});

describe('hasMore', () => {
  it('is true while pages remain', () => {
    expect(hasMore(view())).toBe(true);
  });

  it('is false on the last page', () => {
    expect(hasMore(view({ page: 35 }))).toBe(false);
  });

  it('is false when every page was fetched', () => {
    expect(hasMore(view({ all: true }))).toBe(false);
  });
});

describe('paginationLine', () => {
  it('shows the window and the next-page command', () => {
    expect(paginationLine(view())).toBe(
      '(1–100 of 3412 — next page: vw media list --page 2)'
    );
  });

  it('offsets the range by the page', () => {
    expect(paginationLine(view({ page: 3 }))).toBe(
      '(201–300 of 3412 — next page: vw media list --page 4)'
    );
  });

  it('says end of results on a final partial page', () => {
    expect(
      paginationLine(view({ page: 35, shown: 12, totalItems: 3412 }))
    ).toBe('(3401–3412 of 3412 — end of results)');
  });

  it('says all results shown when one page holds everything', () => {
    expect(
      paginationLine(view({ shown: 7, totalItems: 7, totalPages: 1 }))
    ).toBe('(7 of 7 — all results shown)');
  });

  it('says all results shown for --all, without a range', () => {
    expect(
      paginationLine(view({ all: true, shown: 3412, totalItems: 3412 }))
    ).toBe('(3412 of 3412 — all results shown)');
  });
});

describe('narrowHint', () => {
  it('lists the filters the caller did not use', () => {
    expect(narrowHint(spec, view(), [])).toBe(
      '(narrow instead: -d/--directory <dir>, --type <mediaType>)'
    );
  });

  it('drops the filters already applied', () => {
    expect(narrowHint(spec, view(), ['directory'])).toBe(
      '(narrow instead: --type <mediaType>)'
    );
  });

  it('is absent once every filter is applied', () => {
    expect(narrowHint(spec, view(), ['directory', 'type'])).toBeNull();
  });

  it('is absent when there are no more pages to avoid', () => {
    expect(narrowHint(spec, view({ page: 35 }), [])).toBeNull();
  });

  it('is absent for a spec with no filters', () => {
    expect(narrowHint({ ...spec, filters: undefined }, view(), [])).toBeNull();
  });
});

describe('listFooter', () => {
  it('emits pagination, narrowing, and hint lines in order', () => {
    expect(listFooter(spec, view(), [])).toEqual([
      '(1–100 of 3412 — next page: vw media list --page 2)',
      '(narrow instead: -d/--directory <dir>, --type <mediaType>)',
      '(add --json for full records; vw media show <id> for one record)',
    ]);
  });

  it('drops the narrowing line on the last page', () => {
    expect(listFooter(spec, view({ page: 35, shown: 12 }), [])).toEqual([
      '(3401–3412 of 3412 — end of results)',
      '(add --json for full records; vw media show <id> for one record)',
    ]);
  });

  it('emits nothing when no rows printed', () => {
    expect(listFooter(spec, view({ shown: 0, totalItems: 0 }), [])).toEqual([]);
  });

  it('omits the command hint when the spec has none', () => {
    expect(hintLine({ ...spec, hint: undefined })).toBe(
      '(add --json for full records)'
    );
  });
});

describe('listEnvelope', () => {
  it('carries the paging cursor and both filter lists', () => {
    const rows = [{ id: 'm1' }];
    expect(listEnvelope(spec, rows, view({ shown: 1 }), ['directory'])).toEqual(
      {
        items: rows,
        totalItems: 3412,
        page: 1,
        perPage: 100,
        totalPages: 35,
        hasMore: true,
        nextPage: 2,
        nextCommand: 'vw media list --page 2',
        appliedFilters: ['directory'],
        availableFilters: ['directory', 'type'],
      }
    );
  });

  it('nulls the cursor on the last page', () => {
    const envelope = listEnvelope(spec, [], view({ page: 35 }), []);
    expect(envelope.hasMore).toBe(false);
    expect(envelope.nextPage).toBeNull();
    expect(envelope.nextCommand).toBeNull();
  });

  it('keeps items and totalItems for pre-pagination consumers', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const envelope = listEnvelope(
      spec,
      rows,
      view({ shown: 2, totalItems: 2, totalPages: 1 }),
      []
    );
    expect(envelope.items).toBe(rows);
    expect(envelope.totalItems).toBe(2);
  });
});
