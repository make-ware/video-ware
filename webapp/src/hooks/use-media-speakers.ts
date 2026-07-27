import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LabelSpeakerMutator,
  SPEAKER_PANEL_FIELDS,
} from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';
import type { SpeakerUtterance } from '@/components/labels/speakers/speaker-utils';

/**
 * Diarized speaker utterances for a media, sorted by start time.
 *
 * Expands the per-speaker LabelEntity and, through it, the linked Entity.
 * That one expand is the panel's whole identity story: LabelEntity carries
 * both the display name (which survives entity renames) and the "this speaker
 * is Erik" link, so identifying a speaker needs no second query.
 *
 * Fetched as a batched full list, not a single oversized page — a long
 * recording runs to thousands of utterances, and a capped page would drop the
 * tail silently while the "N found" count reported the truncated total as
 * fact. The `fields` projection drops the per-word timings, which no speaker
 * surface reads and which dominate the payload.
 */
export function useMediaSpeakers(mediaId: string) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = qk.speakers.byMedia(mediaId);

  const query = useQuery({
    queryKey,
    enabled: !!mediaId && isAuthenticated,
    queryFn: async () => {
      const mutator = new LabelSpeakerMutator(pb, {
        fields: [...SPEAKER_PANEL_FIELDS],
      });
      // getAllByMedia takes the dotted expand path directly.
      const items = await mutator.getAllByMedia(mediaId, [
        'LabelEntityRef.EntityRef',
      ]);
      return items.sort((a, b) => a.start - b.start);
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
