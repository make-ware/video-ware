/**
 * Turn parsed commander options into a resolved PocketBase query.
 *
 * This is the deterministic core of the list pattern: given a spec and an
 * options bag it validates paging flags, resolves the sort name, enforces
 * required filters, and composes the filter string. Everything that can go
 * wrong with a caller's flags surfaces here as a thrown `Error`, so commands
 * keep their single `catch (err) { handleError(err) }`.
 *
 * Filter values are bound one clause at a time through `pb.filter`, then
 * joined with `&&`. Binding per clause (rather than composing one big
 * template) means two filters can both use a `{:q}` placeholder without
 * colliding, and no filter author can accidentally interpolate a raw value.
 */
import { warn } from '../output.js';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  filtersOf,
  flagSummaryOf,
  type FilterClause,
  type ListContext,
  type ListSpec,
} from './spec.js';

export interface ResolvedListQuery {
  /** 1-based page number. */
  page: number;
  perPage: number;
  /** Composed, fully bound filter string; '' when nothing narrows the list. */
  filter: string;
  /** Resolved PocketBase sort string; '' when the spec declares no sorts. */
  sort: string;
  /** Walk every page (`--all`, or an unpaged spec with no window flags). */
  all: boolean;
  /** Filter keys actually applied — drives the "narrow instead" footer. */
  applied: readonly string[];
}

/** Environment the resolver needs but shouldn't read globally (testability). */
export interface ResolveListEnv {
  /** Whether an interactive `pick` fallback may run. Defaults to stdin's TTY. */
  isTTY?: boolean;
}

function positiveInt(
  value: unknown,
  flag: string,
  command: string
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `${command}: ${flag} expects a positive integer (got "${String(value)}")`
    );
  }
  return n;
}

/** The `--sort` names a spec accepts, for help and error text. */
export function sortNamesOf<T, TRow>(spec: ListSpec<T, TRow>): string[] {
  return (spec.sorts ?? []).map((option) => option.value);
}

function resolveSort<T, TRow>(spec: ListSpec<T, TRow>, raw: unknown): string {
  const sorts = spec.sorts ?? [];
  if (raw === undefined) return sorts[0]?.pbSort ?? '';
  if (sorts.length === 0) {
    throw new Error(`${spec.command} does not support --sort.`);
  }
  const wanted = String(raw);
  const found = sorts.find((option) => option.value === wanted);
  if (!found) {
    throw new Error(
      `${spec.command}: unknown --sort "${wanted}". ` +
        `Valid values: ${sortNamesOf(spec).join(', ')}`
    );
  }
  return found.pbSort;
}

/** Every filter flag a spec exposes, compactly — used in error messages. */
function availableFilterFlags<T, TRow>(spec: ListSpec<T, TRow>): string {
  const flags = Object.values(filtersOf(spec)).map(flagSummaryOf);
  return flags.length > 0 ? flags.join(', ') : '(none)';
}

/**
 * Collect the filter values to apply, running an interactive `pick` for a
 * missing required filter when (and only when) stdin is a TTY.
 */
async function resolveFilterValues<T, TRow>(
  spec: ListSpec<T, TRow>,
  opts: Record<string, unknown>,
  ctx: ListContext,
  env: ResolveListEnv
): Promise<Map<string, unknown>> {
  const filters = filtersOf(spec);
  const values = new Map<string, unknown>();
  for (const key of Object.keys(filters)) {
    if (opts[key] !== undefined) values.set(key, opts[key]);
  }

  const isTTY = env.isTTY ?? Boolean(process.stdin.isTTY);

  for (const key of spec.required ?? []) {
    if (values.has(key)) continue;
    const filter = filters[key];
    if (!filter) {
      throw new Error(
        `${spec.command}: required filter "${key}" is not declared in the spec.`
      );
    }
    if (filter.pick && isTTY) {
      values.set(key, await filter.pick(ctx));
      continue;
    }
    throw new Error(
      `${spec.command} needs ${filter.flags} — ${filter.description}.\n` +
        `  Available filters: ${availableFilterFlags(spec)}`
    );
  }

  const oneOf = spec.requireOneOf ?? [];
  if (oneOf.length > 0 && !oneOf.some((key) => values.has(key))) {
    const alternatives = oneOf
      .map((key) => (filters[key] ? flagSummaryOf(filters[key]) : key))
      .join(', ');
    throw new Error(
      `${spec.command} needs at least one of: ${alternatives}.\n` +
        `  Available filters: ${availableFilterFlags(spec)}`
    );
  }

  return values;
}

/** Bind one clause's params, leaving a literal PocketBase filter string. */
function bindClause(ctx: ListContext, clause: FilterClause): string {
  const expr = clause.expr.trim();
  if (!expr) return '';
  return clause.params ? ctx.pb.filter(expr, clause.params) : expr;
}

/** Join bound clauses, parenthesizing each when more than one applies. */
function joinClauses(clauses: string[]): string {
  const parts = clauses.filter((clause) => clause.length > 0);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.map((part) => `(${part})`).join(' && ');
}

/**
 * Resolve a list command's options into a query. Throws on any invalid or
 * missing flag, with a message naming the command and the way out.
 */
export async function resolveListQuery<T, TRow>(
  spec: ListSpec<T, TRow>,
  opts: Record<string, unknown>,
  ctx: ListContext,
  env: ResolveListEnv = {}
): Promise<ResolvedListQuery> {
  const requestedLimit = positiveInt(opts.limit, '-n, --limit', spec.command);
  const requestedPage = positiveInt(opts.page, '--page', spec.command);

  let perPage = requestedLimit ?? spec.defaultLimit ?? DEFAULT_LIST_LIMIT;
  if (perPage > MAX_LIST_LIMIT) {
    warn(
      `--limit ${perPage} exceeds the ${MAX_LIST_LIMIT}-row ceiling — ` +
        `using ${MAX_LIST_LIMIT}. Pass --all to fetch every page instead.`
    );
    perPage = MAX_LIST_LIMIT;
  }

  // An unpaged spec (a timeline's tracks/clips) is read whole by default;
  // asking for a window with --limit/--page opts back into normal paging.
  const windowed = requestedLimit !== undefined || requestedPage !== undefined;
  const all = Boolean(opts.all) || (Boolean(spec.unpaged) && !windowed);

  const values = await resolveFilterValues(spec, opts, ctx, env);
  const filters = filtersOf(spec);

  const clauses: string[] = [];
  if (spec.workspaceScoped !== false) {
    if (!ctx.workspaceId) {
      throw new Error(
        `${spec.command}: no active workspace — pass -w <id> or run \`vw workspace use\`.`
      );
    }
    clauses.push(
      bindClause(ctx, {
        expr: 'WorkspaceRef = {:ws}',
        params: { ws: ctx.workspaceId },
      })
    );
  }

  const base = spec.baseFilter?.(opts, ctx);
  if (base) clauses.push(bindClause(ctx, base));

  const applied: string[] = [];
  // Spec key order, not caller order, so the same flags always compose the
  // same filter string (stable assertions, stable PB query cache keys).
  for (const [key, filter] of Object.entries(filters)) {
    if (!values.has(key)) continue;
    const raw = values.get(key);
    const value = (
      filter.parse && typeof raw === 'string' ? filter.parse(raw) : raw
    ) as never;
    const clause = await filter.clause(value, ctx);
    applied.push(key);
    if (!clause) continue;
    clauses.push(bindClause(ctx, clause));
  }

  return {
    page: requestedPage ?? 1,
    perPage,
    filter: joinClauses(clauses),
    sort: resolveSort(spec, opts.sort),
    all,
    applied,
  };
}
