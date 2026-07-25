import { vi } from 'vitest';
import type { ListResult } from 'pocketbase';
import {
  runList,
  runMergedList,
  type ListContext,
  type ListSpec,
  type MergeSource,
  type ResolvedListQuery,
} from '../lib/list/index.js';

/** What a captured list run printed, split by stream. */
export interface CapturedList {
  /** stdout lines — the table, footer, or JSON document. */
  stdout: string[];
  /** stderr lines — warnings only; stdout must stay parseable. */
  stderr: string[];
  /** stdout as one string, for JSON.parse. */
  text: string;
  /** The parsed `--json` envelope (throws when stdout wasn't JSON). */
  json: () => unknown;
}

function capture<T>(run: () => Promise<T>): Promise<CapturedList> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outSpy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(' '));
    });
  const errSpy = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

  return run()
    .then(() => {
      const text = stdout.join('\n');
      return { stdout, stderr, text, json: () => JSON.parse(text) as unknown };
    })
    .finally(() => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    });
}

/**
 * Run a single-collection list command and capture what it printed.
 *
 * Command tests use this to assert the rendered output — table, footer, and
 * `--json` envelope — in a few lines each, instead of re-stubbing the runner's
 * plumbing per command. `isTTY` defaults to false so a required filter fails
 * with its error rather than reaching for an interactive prompt.
 */
export function captureList<T, TRow = T>(args: {
  spec: ListSpec<T, TRow>;
  opts?: Record<string, unknown>;
  ctx: ListContext;
  fetchPage: (query: ResolvedListQuery) => Promise<ListResult<T>>;
  argv?: readonly string[];
  isTTY?: boolean;
}): Promise<CapturedList> {
  return capture(() =>
    runList({
      spec: args.spec,
      opts: args.opts ?? {},
      ctx: args.ctx,
      fetchPage: args.fetchPage,
      argv: args.argv ?? ['test', 'list'],
      isTTY: args.isTTY ?? false,
    })
  );
}

/** The fan-out equivalent of `captureList`. */
export function captureMergedList<T, TRow = T>(args: {
  spec: ListSpec<T, TRow>;
  opts?: Record<string, unknown>;
  ctx: ListContext;
  sources: (
    query: ResolvedListQuery
  ) => readonly MergeSource<T>[] | Promise<readonly MergeSource<T>[]>;
  compare: (query: ResolvedListQuery) => (a: T, b: T) => number;
  narrowWith?: string;
  argv?: readonly string[];
  isTTY?: boolean;
}): Promise<CapturedList> {
  return capture(() =>
    runMergedList({
      spec: args.spec,
      opts: args.opts ?? {},
      ctx: args.ctx,
      sources: args.sources,
      compare: args.compare,
      narrowWith: args.narrowWith,
      argv: args.argv ?? ['test', 'list'],
      isTTY: args.isTTY ?? false,
    })
  );
}
