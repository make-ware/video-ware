'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MediaClipMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { MediaService, type MediaWithPreviews } from '@/services/media';
import { clipTypeFilterPredicate } from '@/components/clip/clip-type-filter';
import type { ExpandedMediaClip } from '@/types/expanded-types';
import type { LibraryItem, LibrarySortBy } from './types';

type ClipSource =
  | { kind: 'workspace-clips'; workspaceId: string; directoryId?: string }
  | { kind: 'workspace-media'; workspaceId: string; directoryId?: string };

interface UseClipLibraryArgs {
  source: ClipSource | null;
  searchQuery?: string;
  typeFilter?: string;
  sortBy?: LibrarySortBy;
}

interface UseClipLibraryReturn {
  items: LibraryItem[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useClipLibrary({
  source,
  searchQuery = '',
  typeFilter = 'all',
  sortBy = 'recent',
}: UseClipLibraryArgs): UseClipLibraryReturn {
  const mediaClipMutator = useMemo(() => new MediaClipMutator(pb), []);
  const mediaService = useMemo(() => new MediaService(pb), []);

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const load = useCallback(async () => {
    if (!source) {
      setItems([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (source.kind === 'workspace-clips') {
        const isGroupedFilter =
          typeFilter === 'media' || typeFilter === 'clips';
        const result = await mediaClipMutator.getByWorkspace(
          source.workspaceId,
          1,
          100,
          {
            type:
              typeFilter !== 'all' && !isGroupedFilter ? typeFilter : undefined,
            searchQuery: debouncedQuery || undefined,
            directoryId: source.directoryId,
          }
        );

        let clips = result.items as ExpandedMediaClip[];

        if (isGroupedFilter) {
          const predicate = clipTypeFilterPredicate(typeFilter);
          clips = clips.filter((clip) => predicate(clip.type));
        }

        clips = sortClips(clips, sortBy);

        setItems(
          clips.map((clip) => ({ kind: 'clip', id: clip.id, clip }) as const)
        );
      } else {
        const mediaList = source.directoryId
          ? await mediaService.getMediaByDirectory(source.directoryId, 1, 100)
          : await mediaService.getMediaByWorkspace(source.workspaceId, 1, 100);

        let filtered = filterMedia(mediaList, debouncedQuery);
        filtered = sortMedia(filtered, sortBy);

        setItems(
          filtered.map(
            (media) => ({ kind: 'media', id: media.id, media }) as const
          )
        );
      }
    } catch (err) {
      console.error('Failed to load library items:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to load library items'
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    source,
    mediaClipMutator,
    mediaService,
    debouncedQuery,
    typeFilter,
    sortBy,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, isLoading, error, reload: load };
}

function sortClips(
  clips: ExpandedMediaClip[],
  sortBy: LibrarySortBy
): ExpandedMediaClip[] {
  const sorted = [...clips];
  if (sortBy === 'name') {
    sorted.sort((a, b) => {
      const nameA = a.expand?.MediaRef?.expand?.UploadRef?.name || '';
      const nameB = b.expand?.MediaRef?.expand?.UploadRef?.name || '';
      return nameA.localeCompare(nameB);
    });
  } else if (sortBy === 'duration') {
    sorted.sort((a, b) => b.end - b.start - (a.end - a.start));
  } else if (sortBy === 'media_time') {
    sorted.sort((a, b) => {
      const dateA = a.expand?.MediaRef?.mediaDate
        ? new Date(a.expand.MediaRef.mediaDate).getTime()
        : 0;
      const dateB = b.expand?.MediaRef?.mediaDate
        ? new Date(b.expand.MediaRef.mediaDate).getTime()
        : 0;
      return dateA + a.start * 1000 - (dateB + b.start * 1000);
    });
  } else {
    sorted.sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
    );
  }
  return sorted;
}

function filterMedia(
  media: MediaWithPreviews[],
  query: string
): MediaWithPreviews[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return media;
  return media.filter((m) => {
    const name = m.expand?.UploadRef?.name?.toLowerCase() || '';
    return name.includes(trimmed);
  });
}

function sortMedia(
  media: MediaWithPreviews[],
  sortBy: LibrarySortBy
): MediaWithPreviews[] {
  const sorted = [...media];
  if (sortBy === 'name') {
    sorted.sort((a, b) => {
      const nameA = a.expand?.UploadRef?.name || '';
      const nameB = b.expand?.UploadRef?.name || '';
      return nameA.localeCompare(nameB);
    });
  } else if (sortBy === 'duration') {
    sorted.sort((a, b) => b.duration - a.duration);
  } else if (sortBy === 'media_time') {
    sorted.sort((a, b) => {
      const dateA = a.mediaDate ? new Date(a.mediaDate).getTime() : 0;
      const dateB = b.mediaDate ? new Date(b.mediaDate).getTime() : 0;
      return dateA - dateB;
    });
  } else {
    sorted.sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
    );
  }
  return sorted;
}
