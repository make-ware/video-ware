/**
 * The list pattern: one declarative spec per `vw … list` command, a generic
 * runner, and pure helpers for the footer/JSON envelope.
 *
 * Start at `spec.ts` for the shape a command declares, `run.ts` for how it is
 * executed, and `paginate.ts` for why fan-out lists are depth-bounded.
 */
export {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  columnsOf,
  filtersOf,
  flagSummaryOf,
  listFilter,
  longFlagOf,
  type AnyListFilter,
  type FilterClause,
  type ListContext,
  type ListFilter,
  type ListSpec,
  type SortOption,
  type SortRegistry,
} from './spec.js';

export {
  resolveListQuery,
  sortNamesOf,
  type ResolveListEnv,
  type ResolvedListQuery,
} from './query.js';

export {
  parseCount,
  withListOptions,
  type ListOptionsConfig,
} from './options.js';

export {
  hasMore,
  hintLine,
  listEnvelope,
  listFooter,
  narrowHint,
  nextPageCommand,
  paginationLine,
  type ListEnvelope,
  type ListView,
} from './footer.js';

export {
  DEFAULT_MAX_MERGE_DEPTH,
  PB_MAX_PER_PAGE,
  fetchAll,
  fetchAllPages,
  fetchMergedAll,
  fetchMergedPage,
  maxMergedPage,
  windowItems,
  type MergeSource,
  type MergedPage,
  type PageRequest,
} from './paginate.js';

export {
  mergeSource,
  runList,
  runMergedList,
  type ListRefinement,
  type RunListArgs,
  type RunMergedListArgs,
} from './run.js';

export * from './sorts.js';
