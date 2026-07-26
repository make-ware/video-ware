import { useQuery } from '@tanstack/react-query';
import { LabelTrackMutator } from '@project/shared/mutator';
import type { LabelType } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

/**
 * A media's label tracks of one kind, keyed by provider trackId.
 *
 * Tracks carry the EntityRef link, so this is what entity-assignment UIs read
 * and write. It is deliberately narrow: LabelTrack holds every label kind in
 * one collection and object tracking alone emits hundreds of rows per media,
 * so an unfiltered page silently drops the handful of speaker or face tracks
 * a caller is after — which is what made speakers untaggable on busy media.
 * The (MediaRef, labelType) filter is index-served and returns single digits.
 *
 * Only `id`, `trackId` and `EntityRef` are fetched. Skipping `keyframes`
 * matters: it is a JSON column with a 10 MB per-record cap.
 *
 * Prefer reading a track off an already-expanded relation where one exists —
 * speaker utterances carry theirs via LabelTrackRef — and reach for this only
 * to heal rows written before that FK, hence the `enabled` gate.
 */
export function useMediaTracksByType(
  mediaId: string,
  labelType: LabelType,
  options: { enabled?: boolean } = {}
) {
  const { isAuthenticated } = useAuth();
  const enabled = options.enabled ?? true;

  const query = useQuery({
    queryKey: qk.labelTracks.byMediaAndType(mediaId, labelType),
    enabled: !!mediaId && isAuthenticated && enabled,
    queryFn: async () => {
      const mutator = new LabelTrackMutator(pb, {
        expand: [],
        fields: ['id', 'trackId', 'EntityRef'],
      });
      const result = await mutator.getByMediaAndType(mediaId, labelType);
      return result.items;
    },
  });

  const byTrackId = new Map((query.data ?? []).map((t) => [t.trackId, t]));

  return {
    tracks: query.data ?? [],
    byTrackId,
    isLoading: query.isLoading,
    // `isPending` (not isLoading) so an auth-gated, still-disabled query reads
    // as "unknown" rather than "no tracks" — an empty byTrackId otherwise
    // looks identical to a media that genuinely has none.
    isPending: query.isPending,
    error: query.error,
  };
}
