import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LabelSpeakerMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';
import type { SpeakerUtterance } from '@/components/labels/speakers/speaker-utils';

/**
 * Diarized speaker utterances for a media, sorted by start time. Expands the
 * per-speaker LabelEntity (display names survive entity renames) and the
 * track's linked Entity (LabelTrackRef.EntityRef) so transcript labels can
 * resolve the matched identity live without a second query.
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
      // getList (not getByMedia) so we can pass the dotted expand path.
      const result = await mutator.getList(
        1,
        500,
        `MediaRef = "${mediaId}"`,
        'start',
        ['LabelEntityRef', 'LabelTrackRef.EntityRef']
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
