'use client';

/**
 * The media-clip application of the generic live infinite list (see
 * use-live-infinite-list.ts): server-side workspace/directory/clip-type/
 * media-type/search filters and sort, plus a workspace-scoped MediaClips
 * realtime subscription.
 */
import { useEffect, useMemo, useState } from 'react';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/hooks/use-auth';
import {
  useLiveInfiniteList,
  type LiveListSubscription,
  type UseLiveInfiniteListResult,
} from '@/hooks/use-live-infinite-list';
import type { LiveListSpec } from '@/utils/live-list';
import {
  MediaClipService,
  CLIP_LIST_EXPAND,
  type ClipListItem,
} from '@/services/media-clip';
import { mediaTypeFilterPredicate } from '@/components/media/media-type-filter';
import {
  getClipSortOption,
  type ClipSortValue,
} from '@/components/clip/clip-sort';

export const CLIP_PAGE_SIZE = 24;

export interface UseClipListArgs {
  workspaceId: string | undefined;
  /** null = all directories, '' = workspace root, id = one directory. */
  directoryFilter: string | null;
  /** 'all' | one ClipType. */
  clipTypeFilter: string;
  /** 'all' | 'video' | 'audio' | 'image'. */
  mediaTypeFilter: string;
  /** Raw input; debounced 300ms internally. */
  searchQuery: string;
  sort: ClipSortValue;
}

/**
 * Client-side mirror of the server filter `listClips` builds. Search is a
 * case-insensitive substring test over the same six fields — an approximation
 * of PB's `~` operator, close enough for realtime merge decisions (refetches
 * true up any divergence).
 *
 * The directory and media-type tests read through the `MediaRef` expand. A
 * `delete` event can arrive without it, in which case the record reads as
 * non-matching and live-list skips the `totalItems` decrement; the next
 * refetch trues the count up.
 */
export function buildClipMatches(args: {
  workspaceId: string;
  directoryId: string | null;
  clipType: string;
  mediaType: string;
  search: string;
}): (record: ClipListItem) => boolean {
  const typePredicate = mediaTypeFilterPredicate(args.mediaType);
  const search = args.search.trim().toLowerCase();
  return (record) => {
    if (record.WorkspaceRef !== args.workspaceId) return false;
    const media = record.expand?.MediaRef;
    if (
      args.directoryId !== null &&
      (media?.DirectoryRef ?? '') !== args.directoryId
    ) {
      return false;
    }
    if (args.clipType !== 'all' && record.type !== args.clipType) return false;
    if (!typePredicate(media?.mediaType)) return false;
    if (search) {
      const haystacks = [
        record.label,
        record.description,
        record.type,
        media?.label,
        media?.description,
        media?.expand?.UploadRef?.name,
      ];
      if (!haystacks.some((text) => text?.toLowerCase().includes(search))) {
        return false;
      }
    }
    return true;
  };
}

export function useClipList(
  args: UseClipListArgs
): UseLiveInfiniteListResult<ClipListItem> {
  const {
    workspaceId,
    directoryFilter,
    clipTypeFilter,
    mediaTypeFilter,
    searchQuery,
    sort,
  } = args;
  const { isAuthenticated } = useAuth();
  const clipService = useMemo(() => new MediaClipService(pb), []);

  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const sortOption = getClipSortOption(sort);

  const spec = useMemo<LiveListSpec<ClipListItem>>(
    () => ({
      matches: buildClipMatches({
        workspaceId: workspaceId ?? '',
        directoryId: directoryFilter,
        clipType: clipTypeFilter,
        mediaType: mediaTypeFilter,
        search: debouncedSearch,
      }),
      compare: sortOption.compare,
      canCompare: sortOption.canCompare,
    }),
    [
      workspaceId,
      directoryFilter,
      clipTypeFilter,
      mediaTypeFilter,
      debouncedSearch,
      sortOption,
    ]
  );

  // Server-side filter stays coarse and stable (the workspace) so filter /
  // search / sort changes never resubscribe; fine-grained relevance is
  // spec.matches' job. Expand mirrors the list fetch exactly so live-inserted
  // cards render identically to fetched ones.
  const subscription = useMemo<LiveListSubscription | null>(
    () =>
      workspaceId
        ? {
            collection: 'MediaClips',
            topic: '*',
            key: `MediaClips:${workspaceId}`,
            options: {
              filter: pb.filter('WorkspaceRef = {:ws}', { ws: workspaceId }),
              expand: CLIP_LIST_EXPAND.join(','),
            },
            gapHealKey: qk.clips.lists,
          }
        : null,
    [workspaceId]
  );

  return useLiveInfiniteList<ClipListItem>({
    queryKey: qk.clips.list({
      workspaceId: workspaceId ?? '',
      directoryId: directoryFilter,
      clipType: clipTypeFilter,
      mediaType: mediaTypeFilter,
      sort: sortOption.value,
      search: debouncedSearch,
    }),
    enabled: !!workspaceId && isAuthenticated,
    fetchPage: (page) =>
      clipService.listClips(
        {
          workspaceId: workspaceId ?? '',
          directoryId: directoryFilter,
          clipType: clipTypeFilter,
          mediaType: mediaTypeFilter,
          search: debouncedSearch,
        },
        page,
        CLIP_PAGE_SIZE,
        sortOption.pbSort
      ),
    spec,
    subscription,
  });
}
