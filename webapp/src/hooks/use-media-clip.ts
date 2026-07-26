'use client';

/**
 * Resolves one clip by id, independently of any list window.
 *
 * The media viewer's `?clip=<id>` deep link has to work even when that clip is
 * not among the loaded pages — it may sit past the current page, or be excluded
 * by the active type/search filters. The list can't answer "does this id
 * exist", so this does.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import pb from '@/lib/pocketbase-client';
import { MediaClipService, type ClipListItem } from '@/services/media-clip';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

export interface UseMediaClipResult {
  clip: ClipListItem | null;
  isLoading: boolean;
}

export function useMediaClip(
  clipId: string | null,
  options?: {
    /** Skip the fetch — e.g. the record is already in a loaded list page. */
    enabled?: boolean;
    /**
     * Reject a clip that doesn't belong to this media. The old code got this
     * invariant for free (its fetch was MediaRef-filtered); a by-id fetch
     * doesn't, and a stale or hand-edited `?clip=` would otherwise drive the
     * player to another media's in/out points.
     */
    mediaId?: string;
  }
): UseMediaClipResult {
  const { isAuthenticated } = useAuth();
  const clipService = useMemo(() => new MediaClipService(pb), []);

  const enabled = !!clipId && isAuthenticated && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: qk.clips.detail(clipId ?? ''),
    enabled,
    // Nothing subscribes to this key, so the global 30s staleTime would let a
    // deleted or retrimmed clip keep driving the player.
    staleTime: 0,
    // A stale or hand-edited ?clip= id 404s; retrying it just burns requests.
    // (BaseMutator.getById resolves 404 to null rather than throwing.)
    retry: false,
    queryFn: () => clipService.getClip(clipId as string),
  });

  const clip = query.data ?? null;
  const belongsToMedia =
    !options?.mediaId || clip?.MediaRef === options.mediaId;

  return {
    clip: clip && belongsToMedia ? clip : null,
    // A disabled query stays isPending forever, so gate on `enabled` — the
    // usual isPending-as-loading convention would pin a spinner in the common
    // (already-resolved-from-the-list) case.
    isLoading: enabled && query.isPending,
  };
}
