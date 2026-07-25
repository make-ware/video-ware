/**
 * Sort descriptors for the media list: each option pairs the PocketBase
 * sort string sent to the server with a client-side comparator that mirrors
 * it, so realtime merges can position SSE records inside the loaded window
 * (see utils/live-list.ts).
 *
 * Every comparator embeds a total tiebreak (created desc, then id) so
 * distinct records never compare equal — live-list relies on 0 meaning
 * "same record, sort key unchanged". Client comparators approximate server
 * collation (e.g. localeCompare vs SQLite BINARY on names); refetches true
 * up any divergence.
 */
import type { MediaListItem } from '@/services/media';

export type MediaSortValue = 'recent' | 'name' | 'duration' | 'media_time';

export interface MediaSortOption {
  value: MediaSortValue;
  label: string;
  /** PocketBase sort string (server-side ordering). */
  pbSort: string;
  /** Client mirror of pbSort, total-ordered via created/id tiebreak. */
  compare: (a: MediaListItem, b: MediaListItem) => number;
  /** False when the sort key is missing off a record (e.g. no expand). */
  canCompare?: (record: MediaListItem) => boolean;
}

export const DEFAULT_MEDIA_SORT: MediaSortValue = 'recent';

/** created desc, then id asc — the shared total tiebreak. */
function byRecency(a: MediaListItem, b: MediaListItem): number {
  if (a.created !== b.created) return a.created < b.created ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const MEDIA_SORT_OPTIONS: readonly MediaSortOption[] = [
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
    pbSort: 'UploadRef.name,-created',
    compare: (a, b) => {
      const nameA = a.expand?.UploadRef?.name ?? '';
      const nameB = b.expand?.UploadRef?.name ?? '';
      const byName = nameA.localeCompare(nameB);
      if (byName !== 0) return byName;
      return byRecency(a, b);
    },
    // An SSE record that arrived without its UploadRef expand has no name
    // to sort by; live-list keeps/places it conservatively instead.
    canCompare: (record) => record.expand?.UploadRef !== undefined,
  },
  {
    value: 'media_time',
    label: 'Creation Time',
    // Missing mediaDate ('' in PB) sorts last under desc, matching SQLite.
    pbSort: '-mediaDate,-created',
    compare: (a, b) => {
      const dateA = String(a.mediaDate ?? '');
      const dateB = String(b.mediaDate ?? '');
      if (dateA !== dateB) return dateA < dateB ? 1 : -1;
      return byRecency(a, b);
    },
  },
];

/** Resolve a (URL-sourced) sort value, falling back to the default. */
export function getMediaSortOption(value: string | null): MediaSortOption {
  return (
    MEDIA_SORT_OPTIONS.find((option) => option.value === value) ??
    MEDIA_SORT_OPTIONS[0]
  );
}
