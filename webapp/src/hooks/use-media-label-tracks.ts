import { useQuery } from '@tanstack/react-query';
import { LabelTrackMutator } from '@project/shared/mutator';
import type { LabelTrack } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

/**
 * A media's label tracks, keyed by provider trackId. Tracks are the
 * per-media label clusters (one face track, one diarized speaker) and carry
 * the EntityRef link, so this is what entity-assignment UIs read and write.
 */
export function useMediaLabelTracks(mediaId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.labelTracks.byMedia(mediaId),
    enabled: !!mediaId && isAuthenticated,
    queryFn: async () => {
      const result = await new LabelTrackMutator(pb).getByMedia(
        mediaId,
        1,
        500
      );
      return result.items;
    },
  });

  const byTrackId = new Map<string, LabelTrack>();
  for (const track of query.data ?? []) {
    byTrackId.set(track.trackId, track);
  }

  return {
    tracks: query.data ?? [],
    byTrackId,
    isLoading: query.isLoading,
    error: query.error,
  };
}
