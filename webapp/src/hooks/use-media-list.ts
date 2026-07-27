'use client';

/**
 * The media application of the generic live infinite list (see
 * use-live-infinite-list.ts): server-side workspace/directory/type/search
 * filters and sort, a workspace-scoped Media realtime subscription, and
 * synchronous preview enrichment of SSE records.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useLiveInfiniteList,
  type LiveListSubscription,
  type UseLiveInfiniteListResult,
} from '@/hooks/use-live-infinite-list';
import type { LiveListSpec } from '@/utils/live-list';
import { MediaService, type MediaListItem } from '@/services/media';
import { mediaTypeFilterPredicate } from '@/components/media/media-type-filter';
import { mediaEntityFilterPredicate } from '@/components/media/media-entity-filter';
import {
  getMediaSortOption,
  type MediaSortValue,
} from '@/components/media/media-sort';

export const MEDIA_PAGE_SIZE = 24;

export interface UseMediaListArgs {
  workspaceId: string | undefined;
  /** null = all directories, '' = workspace root, id = one directory. */
  directoryFilter: string | null;
  /** 'all' | 'video' | 'audio' | 'image'. */
  mediaTypeFilter: string;
  /** null = all entities; id = tagged with or appearing as that entity. */
  entityFilter: string | null;
  /** Raw input; debounced 300ms internally. */
  searchQuery: string;
  sort: MediaSortValue;
}

/**
 * Client-side mirror of the server filter `listMedia` builds. Search is a
 * case-insensitive substring test over label, description, and
 * UploadRef.name — an approximation of PB's `~` operator, close enough for
 * realtime merge decisions (refetches true up any divergence).
 */
export function buildMediaMatches(args: {
  workspaceId: string;
  directoryId: string | null;
  mediaType: string;
  entityId: string | null;
  /** Media linked to `entityId`; undefined while it loads (clause passes). */
  entityLinkedIds?: Set<string>;
  search: string;
}): (record: MediaListItem) => boolean {
  const typePredicate = mediaTypeFilterPredicate(args.mediaType);
  const entityPredicate = mediaEntityFilterPredicate(
    args.entityId,
    args.entityLinkedIds
  );
  const search = args.search.trim().toLowerCase();
  return (record) => {
    if (record.WorkspaceRef !== args.workspaceId) return false;
    if (
      args.directoryId !== null &&
      (record.DirectoryRef ?? '') !== args.directoryId
    ) {
      return false;
    }
    if (!typePredicate(record.mediaType)) return false;
    if (!entityPredicate(record.id)) return false;
    if (search) {
      const haystacks = [
        record.label,
        record.description,
        record.expand?.UploadRef?.name,
      ];
      if (!haystacks.some((text) => text?.toLowerCase().includes(search))) {
        return false;
      }
    }
    return true;
  };
}

export function useMediaList(
  args: UseMediaListArgs
): UseLiveInfiniteListResult<MediaListItem> {
  const {
    workspaceId,
    directoryFilter,
    mediaTypeFilter,
    entityFilter,
    searchQuery,
    sort,
  } = args;
  const { isAuthenticated } = useAuth();
  const mediaService = useMemo(() => new MediaService(pb), []);

  const debouncedSearch = useDebouncedValue(searchQuery);

  const sortOption = getMediaSortOption(sort);

  // The entity clause lives on other collections, so a Media SSE record can't
  // be tested against it — mirror it with the entity's linked-media id set.
  const { data: entityLinkedIds } = useQuery({
    queryKey: qk.media.entityLinkedIds(entityFilter ?? ''),
    enabled: !!entityFilter && isAuthenticated,
    queryFn: () => mediaService.listMediaIdsLinkedToEntity(entityFilter ?? ''),
  });

  const spec = useMemo<LiveListSpec<MediaListItem>>(
    () => ({
      matches: buildMediaMatches({
        workspaceId: workspaceId ?? '',
        directoryId: directoryFilter,
        mediaType: mediaTypeFilter,
        entityId: entityFilter,
        entityLinkedIds,
        search: debouncedSearch,
      }),
      compare: sortOption.compare,
      canCompare: sortOption.canCompare,
    }),
    [
      workspaceId,
      directoryFilter,
      mediaTypeFilter,
      entityFilter,
      entityLinkedIds,
      debouncedSearch,
      sortOption,
    ]
  );

  // Server-side filter stays coarse and stable (the workspace) so filter /
  // search / sort changes never resubscribe; fine-grained relevance is
  // spec.matches' job. Expand mirrors the list fetch so SSE records can be
  // enriched without extra requests.
  const subscription = useMemo<LiveListSubscription | null>(
    () =>
      workspaceId
        ? {
            collection: 'Media',
            topic: '*',
            key: `Media:${workspaceId}`,
            options: {
              filter: pb.filter('WorkspaceRef = {:ws}', { ws: workspaceId }),
              expand: 'UploadRef,thumbnailFileRef,spriteFileRef,proxyFileRef',
            },
            gapHealKey: qk.media.lists,
          }
        : null,
    [workspaceId]
  );

  return useLiveInfiniteList<MediaListItem>({
    queryKey: qk.media.list({
      workspaceId: workspaceId ?? '',
      directoryId: directoryFilter,
      mediaType: mediaTypeFilter,
      entityId: entityFilter,
      sort: sortOption.value,
      search: debouncedSearch,
    }),
    enabled: !!workspaceId && isAuthenticated,
    fetchPage: (page) =>
      mediaService.listMedia(
        {
          workspaceId: workspaceId ?? '',
          directoryId: directoryFilter,
          mediaType: mediaTypeFilter,
          entityId: entityFilter,
          search: debouncedSearch,
        },
        page,
        MEDIA_PAGE_SIZE,
        sortOption.pbSort
      ),
    spec,
    mapEvent: (record) => mediaService.enrichMedia(record),
    subscription,
  });
}
