import { useQuery, useQueryClient } from '@tanstack/react-query';
import pb from '@/lib/pocketbase-client';
import type {
  Media,
  MediaClip,
  MediaRelations,
  Expanded,
} from '@project/shared';
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

interface UseMediaDetailsResult {
  media: MediaWithExpands | null;
  clips: MediaClip[];
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
      // Fetch media details using mutator with expand
      const mediaMutator = new MediaMutator(pb);
      const media = await mediaMutator.getById(mediaId, [
        'thumbnailFileRef',
        'spriteFileRef',
        'proxyFileRef',
        'audioFileRef',
        'filmstripFileRefs',
        'UploadRef',
      ]);

      // Fetch associated clips
      const clipsList = await pb
        .collection('MediaClips')
        .getList<MediaClip>(1, 200, {
          filter: `MediaRef = "${mediaId}"`,
          sort: 'start',
        });

      // Fetch active label detection tasks
      const activeTasks = await pb.collection('Tasks').getList(1, 1, {
        filter: `sourceId = "${mediaId}" && type = "detect_labels" && (status = "queued" || status = "running")`,
      });

      return {
        media,
        clips: clipsList.items,
        hasActiveLabelTask: activeTasks.totalItems > 0,
      };
    },
  });

  return {
    media: query.data?.media ?? null,
    clips: query.data?.clips ?? [],
    hasActiveLabelTask: query.data?.hasActiveLabelTask ?? false,
    isLoading: query.isLoading,
    error: query.error,
    refresh: async () => {
      await queryClient.invalidateQueries({
        queryKey: qk.media.detail(mediaId),
      });
    },
  };
}
