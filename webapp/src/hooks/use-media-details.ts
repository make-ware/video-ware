import { useState, useEffect, useCallback } from 'react';
import pb from '@/lib/pocketbase-client';
import type {
  Media,
  MediaClip,
  MediaRelations,
  Expanded,
} from '@project/shared';
import { MediaMutator } from '@project/shared/mutator';
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
  const [media, setMedia] = useState<MediaWithExpands | null>(null);
  const [clips, setClips] = useState<MediaClip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasActiveLabelTask, setHasActiveLabelTask] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { isAuthenticated } = useAuth();

  const fetchData = useCallback(async () => {
    if (!mediaId || !isAuthenticated) return;

    try {
      setIsLoading(true);
      setError(null);

      // Fetch media details using mutator with expand
      const mediaMutator = new MediaMutator(pb);
      const mediaRecord = await mediaMutator.getById(mediaId, [
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

      setMedia(mediaRecord);
      setClips(clipsList.items);

      // Fetch active label detection tasks
      const activeTasks = await pb.collection('Tasks').getList(1, 1, {
        filter: `sourceId = "${mediaId}" && type = "detect_labels" && (status = "queued" || status = "running")`,
      });
      setHasActiveLabelTask(activeTasks.totalItems > 0);
    } catch (err) {
      console.error('Error fetching media details:', err);
      setError(
        err instanceof Error ? err : new Error('Failed to fetch media details')
      );
    } finally {
      setIsLoading(false);
    }
  }, [mediaId, isAuthenticated]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    media,
    clips,
    isLoading,
    error,
    hasActiveLabelTask,
    refresh: fetchData,
  };
}
