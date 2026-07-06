import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LabelSpeakerMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';
import type { SpeakerUtterance } from '@/components/labels/speakers/speaker-utils';

/**
 * Diarized speaker utterances for a media, sorted by start time, with the
 * per-speaker LabelEntity expanded so display names survive entity renames.
 */
export function useMediaSpeakers(mediaId: string) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = qk.speakers.byMedia(mediaId);

  const query = useQuery({
    queryKey,
    enabled: !!mediaId && isAuthenticated,
    queryFn: async () => {
      const mutator = new LabelSpeakerMutator(pb);
      // Fetching up to 500 items for now (matches useMediaTranscripts).
      const result = await mutator.getByMedia(
        mediaId,
        1,
        500,
        'LabelEntityRef'
      );
      return result.items.sort((a, b) => a.start - b.start);
    },
  });

  return {
    utterances: (query.data ?? []) as SpeakerUtterance[],
    isLoading: query.isLoading,
    error: query.error,
    refresh: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  };
}
