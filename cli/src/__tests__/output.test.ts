import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  printList,
  printRecord,
  truncate,
  type Column,
} from '../lib/output.js';

const columns: Column<{ id: string; name: string }>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'NAME', value: (r) => r.name },
];

function captureLog() {
  return vi.spyOn(console, 'log').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printList', () => {
  it('emits exactly one { items, totalItems } JSON document in json mode', () => {
    const log = captureLog();
    const rows = [{ id: 'a', name: 'Alpha' }];

    printList(rows, columns, { json: true, totalItems: 5 });

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      items: rows,
      totalItems: 5,
    });
  });

  it('prints a table plus an --json hint in concise mode', () => {
    const log = captureLog();

    printList(
      [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ],
      columns,
      { totalItems: 7, hint: 'see vw label show' }
    );

    const output = log.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('ID');
    expect(output).toContain('Alpha');
    expect(output).toContain(
      '(2 of 7 shown — add --json for full records; see vw label show)'
    );
  });

  it('prints (none) and no hint for empty rows', () => {
    const log = captureLog();

    printList([], columns, {});

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toBe('(none)');
  });
});

describe('printRecord', () => {
  it('emits the raw record in json mode', () => {
    const log = captureLog();
    printRecord({ id: 'a' }, ['line'], true);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ id: 'a' });
  });

  it('emits the concise lines otherwise', () => {
    const log = captureLog();
    printRecord({ id: 'a' }, ['first', 'second']);
    expect(log.mock.calls.map((c) => c[0])).toEqual(['first', 'second']);
  });
});

describe('truncate', () => {
  it('leaves short text alone and ellipsizes long text', () => {
    expect(truncate('short')).toBe('short');
    expect(truncate('x'.repeat(70))).toBe(`${'x'.repeat(59)}…`);
  });
});
