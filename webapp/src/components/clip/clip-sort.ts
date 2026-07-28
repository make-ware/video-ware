/**
 * Sort descriptors for the clip list — the clip twin of
 * `components/media/media-sort.ts`: each option pairs the PocketBase sort
 * string sent to the server with a client-side comparator that mirrors it, so
 * realtime merges can position SSE records inside the loaded window (see
 * utils/live-list.ts).
 *
 * Every comparator embeds a total tiebreak (created desc, then id) so distinct
 * records never compare equal — live-list relies on 0 meaning "same record,
 * sort key unchanged". Client comparators approximate server collation (e.g.
 * localeCompare vs SQLite BINARY on names); refetches true up any divergence.
 *
 * Two deliberate differences from the old client-only `sortClips`, both so the
 * server can express the ordering over the whole workspace rather than one
 * page: `duration` uses the clip's `duration` field (required on
 * MediaClipSchema) instead of `end - start`, and `media_time` sorts
 * newest-media-first — matching the media page — with clips ordered by `start`
 * within a media, instead of the old ascending `mediaDate + start` sum.
 */
import type { ClipListItem } from '@/services/media-clip';

export type ClipSortValue =
  'recent' | 'name' | 'duration' | 'media_time' | 'timeline';

export interface ClipSortOption {
  value: ClipSortValue;
  label: string;
  /** PocketBase sort string (server-side ordering). */
  pbSort: string;
  /** Client mirror of pbSort, total-ordered via created/id tiebreak. */
  compare: (a: ClipListItem, b: ClipListItem) => number;
  /** False when the sort key is missing off a record (e.g. no expand). */
  canCompare?: (record: ClipListItem) => boolean;
}

export const DEFAULT_CLIP_SORT: ClipSortValue = 'recent';

/** created desc, then id asc — the shared total tiebreak. */
function byRecency(a: ClipListItem, b: ClipListItem): number {
  if (a.created !== b.created) return a.created < b.created ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const CLIP_SORT_OPTIONS: readonly ClipSortOption[] = [
  {
    value: 'recent',
    label: 'Recent',
    pbSort: '-created',
    compare: byRecency,
  },
  {
    value: 'duration',
    label: 'Duration',
    pbSort: '-duration,-created',
    compare: (a, b) => {
      const durationA = a.duration ?? 0;
      const durationB = b.duration ?? 0;
      if (durationA !== durationB) return durationB - durationA;
      return byRecency(a, b);
    },
  },
  {
    value: 'name',
    label: 'Name',
    pbSort: 'MediaRef.UploadRef.name,-created',
    compare: (a, b) => {
      const nameA = a.expand?.MediaRef?.expand?.UploadRef?.name ?? '';
      const nameB = b.expand?.MediaRef?.expand?.UploadRef?.name ?? '';
      const byName = nameA.localeCompare(nameB);
      if (byName !== 0) return byName;
      return byRecency(a, b);
    },
    // An SSE record that arrived without its MediaRef/UploadRef expand has no
    // name to sort by; live-list keeps/places it conservatively instead.
    canCompare: (record) =>
      record.expand?.MediaRef?.expand?.UploadRef !== undefined,
  },
  {
    value: 'media_time',
    label: 'Creation Time',
    // Missing mediaDate ('' in PB) sorts last under desc, matching SQLite.
    pbSort: '-MediaRef.mediaDate,start,-created',
    compare: (a, b) => {
      const dateA = String(a.expand?.MediaRef?.mediaDate ?? '');
      const dateB = String(b.expand?.MediaRef?.mediaDate ?? '');
      if (dateA !== dateB) return dateA < dateB ? 1 : -1;
      if (a.start !== b.start) return a.start - b.start;
      return byRecency(a, b);
    },
    canCompare: (record) => record.expand?.MediaRef !== undefined,
  },
  // Appended deliberately: getClipSortOption falls back to CLIP_SORT_OPTIONS[0],
  // which must stay 'recent' for the workspace library.
  {
    value: 'timeline',
    label: 'Timeline',
    pbSort: 'start,-created',
    // No canCompare: `start` lives on the record itself, so an SSE event that
    // arrived without expands still positions correctly.
    compare: (a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return byRecency(a, b);
    },
  },
];

/**
 * The subset offered when the list is scoped to a single media (the media
 * viewer's Clips tab). `name` and `media_time` are degenerate there — every
 * clip shares the same media — so only position/recency/length are useful.
 */
export const MEDIA_SCOPED_CLIP_SORT_VALUES: readonly ClipSortValue[] = [
  'timeline',
  'recent',
  'duration',
];

/** Module-level (stable identity) so consumers can read it unmemoized. */
export const MEDIA_SCOPED_CLIP_SORT_OPTIONS: readonly ClipSortOption[] =
  MEDIA_SCOPED_CLIP_SORT_VALUES.map(
    (value) =>
      CLIP_SORT_OPTIONS.find(
        (option) => option.value === value
      ) as ClipSortOption
  );

export const DEFAULT_MEDIA_CLIP_SORT: ClipSortValue = 'timeline';

/** Resolve a sort value, falling back to the default. */
export function getClipSortOption(value: string | null): ClipSortOption {
  return (
    CLIP_SORT_OPTIONS.find((option) => option.value === value) ??
    CLIP_SORT_OPTIONS[0]
  );
}
