'use client';

/**
 * Prev/next navigation neighbors for the media detail page, resolved by
 * `created`-cursor queries against the workspace — deliberately independent
 * of the media list page's transient filters/sort, and of how many list
 * pages happen to be loaded. Order matches the list's default: newest
 * first, so "prev" is the immediately newer record and "next" the
 * immediately older one.
 *
 * Known approximation: records sharing an identical millisecond `created`
 * stamp may be skipped or revisited (PB's internal tiebreak is not
 * expressible in a filter) — acceptable for navigation.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MediaMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/hooks/use-auth';

export interface MediaNeighborsResult {
  /** Immediately newer record (appears before this one), or null at start. */
  prevId: string | null;
  /** Immediately older record (appears after this one), or null at end. */
  nextId: string | null;
  /** 1-based ordinal in newest-first order; 0 while unknown. */
  position: number;
  /** Workspace media count. */
  totalItems: number;
  isLoading: boolean;
}

export function useMediaNeighbors(
  workspaceId: string | undefined,
  mediaId: string
): MediaNeighborsResult {
  const { isAuthenticated } = useAuth();
  const mediaMutator = useMemo(() => new MediaMutator(pb), []);

  const query = useQuery({
    queryKey: qk.media.neighbors(workspaceId ?? '', mediaId),
    enabled: !!workspaceId && !!mediaId && isAuthenticated,
    queryFn: async () => {
      const current = await mediaMutator.getById(mediaId);
      if (!current) {
        return { prevId: null, nextId: null, position: 0, totalItems: 0 };
      }

      const newerFilter = pb.filter(
        'WorkspaceRef = {:ws} && created > {:created}',
        { ws: workspaceId, created: current.created }
      );
      const olderFilter = pb.filter(
        'WorkspaceRef = {:ws} && created < {:created}',
        { ws: workspaceId, created: current.created }
      );
      const workspaceFilter = pb.filter('WorkspaceRef = {:ws}', {
        ws: workspaceId,
      });

      const [prev, next, newer, total] = await Promise.all([
        // Closest newer record: the oldest among the newer ones.
        mediaMutator.getFirstByFilter(newerFilter, undefined, 'created'),
        // Closest older record: the newest among the older ones.
        mediaMutator.getFirstByFilter(olderFilter, undefined, '-created'),
        // Count-of-newer trick: position = newer count + 1 (perPage 1 keeps
        // both count queries cheap).
        mediaMutator.getList(1, 1, newerFilter),
        mediaMutator.getList(1, 1, workspaceFilter),
      ]);

      return {
        prevId: prev?.id ?? null,
        nextId: next?.id ?? null,
        position: newer.totalItems + 1,
        totalItems: total.totalItems,
      };
    },
  });

  return {
    prevId: query.data?.prevId ?? null,
    nextId: query.data?.nextId ?? null,
    position: query.data?.position ?? 0,
    totalItems: query.data?.totalItems ?? 0,
    // isPending so the auth-gated disabled query still reads as loading.
    isLoading: query.isPending,
  };
}
