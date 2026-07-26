import { useQuery, useQueryClient } from '@tanstack/react-query';
import pb from '@/lib/pocketbase-client';
import type { Media, MediaRelations, Expanded } from '@project/shared';
import { MediaMutator } from '@project/shared/mutator';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

type MediaWithExpands = Expanded<
  Media,
  MediaRelations,
  | 'thumbnailFileRef'
  | 'spriteFileRef'
  | 'proxyFileRef'
  | 'audioFileRef'
  | 'filmstripFileRefs'
  | 'UploadRef'
>;

/**
 * Clips deliberately do NOT live here. They are a paged, filterable, realtime
 * list of their own (`useClipList` with a `mediaId` scope) — bundling them into
 * this query capped them at 200 rows and made every route that only needs the
 * media record re-fetch them.
 */
interface UseMediaDetailsResult {
  media: MediaWithExpands | null;
  isLoading: boolean;
  error: Error | null;
  hasActiveLabelTask: boolean;
  refresh: () => Promise<void>;
}

export function useMediaDetails(mediaId: string): UseMediaDetailsResult {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.media.detail(mediaId),
    enabled: !!mediaId && isAuthenticated,
    queryFn: async () => {
      const mediaMutator = new MediaMutator(pb);
      const [media, activeTasks] = await Promise.all([
        mediaMutator.getById(mediaId, [
          'thumbnailFileRef',
          'spriteFileRef',
          'proxyFileRef',
          'audioFileRef',
          'filmstripFileRefs',
          'UploadRef',
        ]),
        pb.collection('Tasks').getList(1, 1, {
          filter: `sourceId = "${mediaId}" && type = "detect_labels" && (status = "queued" || status = "running")`,
        }),
      ]);

      return {
        media,
        hasActiveLabelTask: activeTasks.totalItems > 0,
      };
    },
  });

  return {
    media: query.data?.media ?? null,
    hasActiveLabelTask: query.data?.hasActiveLabelTask ?? false,
    // isPending, not isLoading: a disabled query (auth still hydrating) must
    // read as "loading", or consumers flash their not-found state before the
    // first fetch ever starts.
    isLoading: query.isPending,
    error: query.error,
    refresh: async () => {
      await queryClient.invalidateQueries({
        queryKey: qk.media.detail(mediaId),
      });
    },
  };
}
