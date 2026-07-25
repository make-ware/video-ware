/**
 * Declarative list specs — the shape every `vw … list` / `… search` command
 * is built from.
 *
 * A spec says WHAT a list can be narrowed and ordered by; the runner
 * (`run.ts`) owns HOW that becomes a PocketBase query, a table, and a
 * pagination footer. One spec therefore replaces the per-command boilerplate
 * of registering flags, branching over filter combinations to pick a mutator
 * method, and hand-calling `printList`.
 *
 * This mirrors the webapp's split (`hooks/use-live-infinite-list.ts`): a
 * generic runner over a per-command `fetchPage(page)` callback, plus a
 * declarative filter/sort descriptor. Sort option *names* are deliberately
 * shared with the webapp's registries (e.g. `recent`, `name`, `duration`) so
 * `--sort recent` means the same thing in both surfaces.
 *
 * Guiding principle: being specific beats paging. Filters live in the spec so
 * `--help` can list them and the footer can suggest the ones the caller did
 * not use, and a few lists require one up front rather than offering to page
 * through a whole workspace.
 */
import type { TypedPocketBase } from '@project/shared';
import type { Column } from '../output.js';

/** Default rows per page for a record list. */
export const DEFAULT_LIST_LIMIT = 100;

/**
 * Hard ceiling on `--limit`. Matches the bounds already used elsewhere in the
 * CLI (`listDirectories`, `mediaByUpload`); `--all` is the way to exceed it.
 */
export const MAX_LIST_LIMIT = 500;

/** A PocketBase filter fragment plus the values to bind into it. */
export interface FilterClause {
  /** Filter expression with `{:name}` placeholders, e.g. `start >= {:from}`. */
  expr: string;
  /** Values bound via `pb.filter`, never interpolated by hand. */
  params?: Record<string, string | number>;
}

/** What a filter's `clause`/`pick` callbacks get to work with. */
export interface ListContext {
  pb: TypedPocketBase;
  /** Present for workspace-scoped specs (the default). */
  workspaceId?: string;
}

/**
 * One filter flag on a list command. The key it is registered under must
 * match the attribute name commander derives from `flags` (validated at
 * startup, like `applyOptions`).
 */
export interface ListFilter<V = string> {
  /** commander flags, e.g. `-d, --directory <dir>`. */
  flags: string;
  description: string;
  /** Parse/validate the raw string; the value stays a string when omitted. */
  parse?: (raw: string) => V;
  /**
   * The filter contribution for a given value. Async so a name→id lookup
   * (directory, entity) can happen here. Returning null means "flag was
   * passed but contributes no clause".
   */
  clause: (
    value: V,
    ctx: ListContext
  ) => FilterClause | null | Promise<FilterClause | null>;
  /**
   * Interactive fallback for a *required* filter, used only when stdin is a
   * TTY. Without one — or off a TTY — a missing required filter fails naming
   * the flag, so an agent gets an error instead of a hanging prompt.
   */
  pick?: (ctx: ListContext) => Promise<V>;
}

/**
 * A filter as a spec stores it, with its value type erased.
 *
 * A spec's filters have differing value types (string, number, an enum), and
 * TypeScript has no existential type to express "some V" — `unknown` breaks
 * `clause`'s parameter, `never` breaks `parse`'s return. So specs hold erased
 * filters and `listFilter` does the erasing, which also keeps `V` inferred
 * *inside* each filter where it is useful.
 */
export type AnyListFilter = ListFilter<never>;

/**
 * Declare a filter for a spec. `V` comes from `parse`'s return type, or
 * defaults to string, so `clause`'s value parameter is typed without any
 * annotation at the call site:
 *
 *   type: listFilter({
 *     flags: '--type <mediaType>',
 *     description: 'only this media type',
 *     parse: parseMediaType,
 *     clause: (t) => ({ expr: 'mediaType = {:t}', params: { t } }),  // t: MediaType
 *   }),
 */
export function listFilter<V = string>(filter: ListFilter<V>): AnyListFilter {
  return filter as unknown as AnyListFilter;
}

/** A `--sort` choice: a stable name paired with its PocketBase sort string. */
export interface SortOption {
  /** Stable name used on the command line, e.g. `recent`. */
  value: string;
  description: string;
  /** PocketBase sort string, e.g. `-duration,-created`. */
  pbSort: string;
}

/** Sort choices for a list; the first entry is the default. */
export type SortRegistry = readonly SortOption[];

/**
 * A list command's declarative description. `T` is the record type the
 * fetcher returns, `TRow` the display row (they differ when `toRows` derives
 * columns, e.g. attaching a track layer).
 */
export interface ListSpec<T, TRow = T> {
  /** Command path used in footers and errors, e.g. `media list`. */
  command: string;
  /**
   * Register `-w, --workspace` and scope the filter to it. Default true;
   * false for lists scoped by something else (a timeline).
   */
  workspaceScoped?: boolean;
  /** Filter flags, keyed by their commander attribute name. */
  filters?: Record<string, AnyListFilter>;
  /**
   * The list's default narrowing, applied after the workspace scope and
   * before any filter. Receives the raw options so a flag can *widen* it —
   * `caption list` hides media transcript captions unless
   * `--include-transcripts` asks for them, which no per-flag clause can
   * express (the clause would have to fire when the flag is absent).
   */
  baseFilter?: (
    opts: Record<string, unknown>,
    ctx: ListContext
  ) => FilterClause | null;
  /** Filter keys that must be provided (or resolved through their `pick`). */
  required?: readonly string[];
  /** At least one of these filter keys must be provided. */
  requireOneOf?: readonly string[];
  sorts?: SortRegistry;
  /** Rows per page when `--limit` is absent. Defaults to 100. */
  defaultLimit?: number;
  /**
   * Structure lists (a timeline's tracks/clips) that callers read whole:
   * every page is fetched unless `--limit`/`--page` asks for a window.
   */
  unpaged?: boolean;
  columns: Column<TRow>[] | ((rows: TRow[]) => Column<TRow>[]);
  /** Records → display rows. May query (e.g. `upload list`'s MEDIA column). */
  toRows?: (items: T[], ctx: ListContext) => TRow[] | Promise<TRow[]>;
  /** Command-specific footer hint, e.g. `vw media show <id> for one record`. */
  hint?: string;
}

/** A spec's filters as a plain record (never undefined). */
export function filtersOf<T, TRow>(
  spec: ListSpec<T, TRow>
): Record<string, AnyListFilter> {
  return spec.filters ?? {};
}

/** Resolve a spec's columns for a set of rows. */
export function columnsOf<T, TRow>(
  spec: ListSpec<T, TRow>,
  rows: TRow[]
): Column<TRow>[] {
  return typeof spec.columns === 'function' ? spec.columns(rows) : spec.columns;
}

/** The long flag of a filter, e.g. `--directory` — used in messages. */
export function longFlagOf(filter: AnyListFilter): string {
  const long = filter.flags
    .split(/[,\s]+/)
    .find((part) => part.startsWith('--'));
  return long ?? filter.flags;
}

/**
 * A filter's flags without its value placeholder, e.g. `-d/--directory` —
 * the compact form used in the "narrow instead" footer.
 */
export function flagSummaryOf(filter: AnyListFilter): string {
  return filter.flags
    .split(/[,\s]+/)
    .filter((part) => part.startsWith('-'))
    .join('/');
}
